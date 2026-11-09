import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as WorkTracking from "./WorkTrackingService.ts";

/**
 * One rule: a Ticket whose Thread started a run is no longer `todo`. It reads
 * current thread state, so a reapplied event is a no-op and the sweep is a full
 * recovery; no cursor to keep past the log's retention window. A transition that
 * must be rejected against live state belongs in orchestration as a command.
 */
export class TicketStatusReactor extends Context.Service<
  TicketStatusReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Re-derives every `todo` Ticket from its Threads. Runs at startup and is safe to repeat. */
    readonly sweep: () => Effect.Effect<void>;
  }
>()("t3/workTracking/TicketStatusReactor") {}

const make = Effect.gen(function* () {
  const events = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const work = yield* WorkTracking.WorkTrackingService;

  const sweep = Effect.fn("TicketStatusReactor.sweep")(
    function* () {
      const pending = yield* work.pendingTicketThreads();
      const started = new Set<string>();
      for (const { threadId } of pending) {
        if (started.has(threadId)) continue;
        const records = yield* projections.getThreadRecords(threadId, ["runs"]);
        if (records.runs.length === 0) continue;
        started.add(threadId);
        yield* work.advanceTicketsForStartedThread(threadId);
      }
    },
    (effect) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Re-deriving ticket status from threads failed.", { cause }),
        ),
      ),
  );

  const start: TicketStatusReactor["Service"]["start"] = () =>
    forkParked(
      Effect.gen(function* () {
        // The sweep covers everything up to here, so the stream starts after it
        // rather than replaying the retained log.
        const afterSequence = yield* events.latestSequence();
        yield* sweep();
        yield* Stream.runForEach(
          events.stream({ eventType: "run.created", afterSequence, bounded: false }),
          (stored) =>
            work.advanceTicketsForStartedThread(stored.event.threadId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Advancing ticket status for a started run failed.", {
                  threadId: stored.event.threadId,
                  cause,
                }),
              ),
            ),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("The ticket status event stream failed.", { cause }),
        ),
      ),
    );

  return { start, sweep } satisfies TicketStatusReactor["Service"];
});

export const layer = Layer.effect(TicketStatusReactor, make);
