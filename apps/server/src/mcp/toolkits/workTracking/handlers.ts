import {
  OrchestratorMcpFailure,
  type ThreadTodoError,
  type ThreadTodoWriteRow,
  type WorkTrackingError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ThreadTodos from "../../../threadTodos/ThreadTodoService.ts";
import * as TicketLaunch from "../../../workTracking/TicketLaunchService.ts";
import * as WorkTracking from "../../../workTracking/WorkTrackingService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WorkTrackingToolkit } from "./tools.ts";

/** Every failure here is a rejected request, not an outage: the store is local. */
function failure(error: WorkTrackingError | ThreadTodoError) {
  return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
}

const service = WorkTracking.WorkTrackingService;

const writes = <P, A, R>(handle: (params: P) => Effect.Effect<A, WorkTrackingError, R>) =>
  McpToolAccess.writes((params: P) => handle(params).pipe(Effect.mapError(failure)), {
    subject: "change this environment's initiatives and tickets",
  });

export const layer = McpToolAccess.toLayer(WorkTrackingToolkit, {
  t3_initiative_list: McpToolAccess.reads((_input) =>
    service.pipe(
      Effect.flatMap((work) => work.listInitiatives()),
      Effect.mapError(failure),
    ),
  ),
  t3_initiative_write: writes((input) =>
    service.pipe(
      Effect.flatMap((work) =>
        work.upsertInitiative({ ...input, createdBy: "agent", creationSource: "mcp" }),
      ),
    ),
  ),
  t3_initiative_delete: writes((input) =>
    service.pipe(Effect.flatMap((work) => work.deleteInitiative(input))),
  ),
  t3_ticket_list: McpToolAccess.reads((input) =>
    service.pipe(
      Effect.flatMap((work) => work.listTickets(input)),
      Effect.mapError(failure),
    ),
  ),
  t3_ticket_write: writes((input) =>
    service.pipe(
      Effect.flatMap((work) =>
        work.upsertTicket({ ...input, createdBy: "agent", creationSource: "mcp" }),
      ),
    ),
  ),
  t3_ticket_delete: writes((input) =>
    service.pipe(Effect.flatMap((work) => work.deleteTicket(input))),
  ),
  t3_ticket_link_thread: writes((input) =>
    service.pipe(Effect.flatMap((work) => work.linkTicketThread(input))),
  ),
  t3_ticket_unlink_thread: writes((input) =>
    service.pipe(Effect.flatMap((work) => work.unlinkTicketThread(input))),
  ),
  t3_ticket_start: writes((input) =>
    TicketLaunch.TicketLaunchService.pipe(
      Effect.flatMap((launches) => launches.startTicket(input)),
    ),
  ),
  t3_artifact_list: McpToolAccess.reads((input) =>
    service.pipe(
      Effect.flatMap((work) => work.listArtifacts(input)),
      Effect.mapError(failure),
    ),
  ),
  t3_artifact_write: writes((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const work = yield* service;
      return yield* work.writeArtifact({
        // The Artifact records which Thread produced it, and outlives it.
        threadId: scope.thread?.threadId ?? null,
        ...input,
        createdBy: "agent",
        creationSource: "mcp",
      });
    }),
  ),
  t3_artifact_delete: writes((input) =>
    service.pipe(Effect.flatMap((work) => work.deleteArtifact(input))),
  ),
  t3_todo_write: McpToolAccess.writes(
    (input: { readonly todos: ReadonlyArray<ThreadTodoWriteRow> }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const threadId = scope.thread?.threadId;
        if (threadId === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "Todos belong to a thread, and this call came from outside one.",
          });
        }
        const todos = yield* ThreadTodos.ThreadTodoService;
        return yield* todos
          .write({ threadId, todos: input.todos }, { createdBy: "agent", creationSource: "mcp" })
          .pipe(Effect.mapError(failure));
      }),
    { subject: "change this thread's todos" },
  ),
});
