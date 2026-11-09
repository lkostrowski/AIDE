import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId, WorkTrackingError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkTrackingService from "./WorkTrackingService.ts";

const isWorkTrackingError = Schema.is(WorkTrackingError);

const testLayer = WorkTrackingService.layer.pipe(
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-work-tracking-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(NodeCrypto.layer, NodeServices.layer, SqlitePersistence.layerMemory),
  ),
);

const run = <A, E>(
  effect: Effect.Effect<A, E, WorkTrackingService.WorkTrackingService | FileSystem.FileSystem>,
) => Effect.provide(effect, testLayer);

const withInitiative = Effect.fn("test.withInitiative")(function* () {
  const work = yield* WorkTrackingService.WorkTrackingService;
  const { initiative } = yield* work.upsertInitiative({ title: "Custom taxes" });
  return { work, initiative };
});

it.effect("keeps an edit to one ticket field from clearing the others", () =>
  run(
    Effect.gen(function* () {
      const { work, initiative } = yield* withInitiative();
      const created = yield* work.upsertTicket({
        initiativeId: initiative.id,
        title: "Ship taxes in core",
        description: "Rates table plus migration.",
        reviewLinks: ["https://example.test/pr/1"],
      });
      const renamed = yield* work.upsertTicket({ id: created.ticket.id, title: "Ship taxes" });
      assert.strictEqual(renamed.ticket.title, "Ship taxes");
      assert.strictEqual(renamed.ticket.description, "Rates table plus migration.");
      assert.deepStrictEqual(renamed.ticket.reviewLinks, ["https://example.test/pr/1"]);
      assert.strictEqual(renamed.ticket.status, "todo");
    }),
  ),
);

it.effect("refuses a blocked ticket without a reason and drops the reason when unblocked", () =>
  run(
    Effect.gen(function* () {
      const { work, initiative } = yield* withInitiative();
      const { ticket } = yield* work.upsertTicket({
        initiativeId: initiative.id,
        title: "Ship taxes",
      });
      const refused = yield* work
        .upsertTicket({ id: ticket.id, status: "blocked" })
        .pipe(Effect.flip);
      assert.isTrue(isWorkTrackingError(refused));
      assert.match(refused.message, /blockedReason/u);

      const blocked = yield* work.upsertTicket({
        id: ticket.id,
        status: "blocked",
        blockedReason: "Waiting on finance",
      });
      assert.strictEqual(blocked.ticket.blockedReason, "Waiting on finance");

      const unblocked = yield* work.upsertTicket({ id: ticket.id, status: "doing" });
      assert.strictEqual(unblocked.ticket.blockedReason, null);
    }),
  ),
);

it.effect("moves only the started thread's waiting tickets, and only the first time", () =>
  run(
    Effect.gen(function* () {
      const { work, initiative } = yield* withInitiative();
      const threadId = ThreadId.make("thread-core");
      const waiting = yield* work.upsertTicket({
        initiativeId: initiative.id,
        title: "Ship taxes in core",
      });
      const reviewing = yield* work.upsertTicket({
        initiativeId: initiative.id,
        title: "Document taxes",
        status: "review",
      });
      const untouched = yield* work.upsertTicket({
        initiativeId: initiative.id,
        title: "Ship taxes in dashboard",
      });
      yield* work.linkTicketThread({ ticketId: waiting.ticket.id, threadId });
      yield* work.linkTicketThread({ ticketId: reviewing.ticket.id, threadId });

      assert.isTrue(yield* work.advanceTicketsForStartedThread(threadId));
      // Applying the same thread state again is a no-op, so a replayed event is harmless.
      assert.isFalse(yield* work.advanceTicketsForStartedThread(threadId));

      const { tickets } = yield* work.listTickets({ initiativeId: initiative.id });
      const statusOf = (id: string) => tickets.find((ticket) => ticket.id === id)?.status;
      assert.strictEqual(statusOf(waiting.ticket.id), "doing");
      assert.strictEqual(statusOf(reviewing.ticket.id), "review");
      assert.strictEqual(statusOf(untouched.ticket.id), "todo");
    }),
  ),
);

it.effect("keeps an initiative with tickets until the delete is forced", () =>
  run(
    Effect.gen(function* () {
      const { work, initiative } = yield* withInitiative();
      yield* work.upsertTicket({ initiativeId: initiative.id, title: "Ship taxes" });

      const refused = yield* work.deleteInitiative({ id: initiative.id }).pipe(Effect.flip);
      assert.isTrue(isWorkTrackingError(refused));

      yield* work.deleteInitiative({ id: initiative.id, force: true });
      const board = yield* work.board();
      assert.deepStrictEqual(board.initiatives, []);
      assert.deepStrictEqual(board.tickets, []);
    }),
  ),
);

it.effect("writes an artifact into the initiative's directory and replaces it by file name", () =>
  run(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { work, initiative } = yield* withInitiative();
      const first = yield* work.writeArtifact({
        initiativeId: initiative.id,
        title: "Plan",
        fileName: "plan.md",
        content: "# Plan",
      });
      assert.isTrue(first.artifact.path.startsWith(initiative.initiativeRoot));
      assert.strictEqual(yield* fileSystem.readFileString(first.artifact.path), "# Plan");

      const second = yield* work.writeArtifact({
        initiativeId: initiative.id,
        title: "Plan v2",
        fileName: "plan.md",
        content: "# Plan v2",
      });
      assert.strictEqual(second.artifact.id, first.artifact.id);
      assert.strictEqual(yield* fileSystem.readFileString(second.artifact.path), "# Plan v2");

      const { artifacts } = yield* work.listArtifacts({ initiativeId: initiative.id });
      assert.strictEqual(artifacts.length, 1);

      yield* work.deleteArtifact({ id: first.artifact.id, deleteFile: true });
      assert.isFalse(yield* fileSystem.exists(first.artifact.path));
    }),
  ),
);
