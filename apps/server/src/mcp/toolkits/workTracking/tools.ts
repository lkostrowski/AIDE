import {
  Artifact,
  ArtifactDeleteInput,
  ArtifactListInput,
  ArtifactWriteInput,
  Initiative,
  InitiativeDeleteInput,
  InitiativeUpsertInput,
  OrchestratorMcpFailure,
  ProjectId,
  ThreadId,
  Ticket,
  TicketDeleteInput,
  TicketListInput,
  TicketStartInput,
  TicketThreadInput,
  TicketUpsertInput,
  ThreadTodo,
  ThreadTodoWriteRow,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadTodos from "../../../threadTodos/ThreadTodoService.ts";
import * as TicketLaunch from "../../../workTracking/TicketLaunchService.ts";
import * as WorkTracking from "../../../workTracking/WorkTrackingService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    WorkTracking.WorkTrackingService,
  ],
};

/** The actor is the calling agent, so the tools never take it. */
const {
  createdBy: _createdBy,
  creationSource: _creationSource,
  ...initiativeFields
} = InitiativeUpsertInput.fields;
const {
  createdBy: _ticketCreatedBy,
  creationSource: _ticketCreationSource,
  ...ticketFields
} = TicketUpsertInput.fields;
const {
  createdBy: _artifactCreatedBy,
  creationSource: _artifactCreationSource,
  ...artifactFields
} = ArtifactWriteInput.fields;

const InitiativeListTool = Tool.make("t3_initiative_list", {
  ...shared,
  description: "List initiatives: goals spanning one or more projects, each owning tickets.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({ initiatives: Schema.Array(Initiative) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const InitiativeWriteTool = Tool.make("t3_initiative_write", {
  ...shared,
  description:
    "Create or update an initiative. Omit `id` to create. Its directory is where its artifacts land.",
  parameters: Schema.Struct(initiativeFields),
  success: Schema.Struct({ initiative: Initiative }),
}).annotate(Tool.Destructive, true);

const InitiativeDeleteTool = Tool.make("t3_initiative_delete", {
  ...shared,
  description: "Delete an initiative. One with tickets needs `force`. Its directory stays.",
  parameters: Schema.Struct(InitiativeDeleteInput.fields),
  success: Schema.Struct({ id: Schema.String }),
}).annotate(Tool.Destructive, true);

const TicketListTool = Tool.make("t3_ticket_list", {
  ...shared,
  description:
    "List tickets: the units of work, each with a status and the threads doing it. Filter by initiative, status, or thread.",
  parameters: Schema.Struct(TicketListInput.fields),
  success: Schema.Struct({ tickets: Schema.Array(Ticket) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const TicketWriteTool = Tool.make("t3_ticket_write", {
  ...shared,
  description:
    "Create or update a ticket. Omit `id` to create, with `initiativeId` and `title`. `blocked` needs a `blockedReason`. Status is the ticket's own, so work spanning projects is blocked once.",
  parameters: Schema.Struct(ticketFields),
  success: Schema.Struct({ ticket: Ticket }),
}).annotate(Tool.Destructive, true);

const TicketDeleteTool = Tool.make("t3_ticket_delete", {
  ...shared,
  description: "Delete a ticket and its thread links. The threads themselves stay.",
  parameters: Schema.Struct(TicketDeleteInput.fields),
  success: Schema.Struct({ id: Schema.String }),
}).annotate(Tool.Destructive, true);

const TicketLinkThreadTool = Tool.make("t3_ticket_link_thread", {
  ...shared,
  description:
    "Record that a thread does a ticket's work. A change across projects is one ticket with one thread per project.",
  parameters: Schema.Struct(TicketThreadInput.fields),
  success: Schema.Struct({ ticket: Ticket }),
}).annotate(Tool.Destructive, true);

const TicketStartTool = Tool.make("t3_ticket_start", {
  ...shared,
  description:
    "Start work on a ticket: a new thread in its own worktree and branch, running the ticket as its first message, linked back to the ticket. `projectId` only when the initiative spans several.",
  parameters: Schema.Struct(TicketStartInput.fields),
  success: Schema.Struct({ ticket: Ticket, threadId: ThreadId, projectId: ProjectId }),
  dependencies: [...shared.dependencies, TicketLaunch.TicketLaunchService],
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const TicketUnlinkThreadTool = Tool.make("t3_ticket_unlink_thread", {
  ...shared,
  description: "Stop treating a thread as a ticket's work.",
  parameters: Schema.Struct(TicketThreadInput.fields),
  success: Schema.Struct({ ticket: Ticket }),
}).annotate(Tool.Destructive, true);

const ArtifactListTool = Tool.make("t3_artifact_list", {
  ...shared,
  description:
    "List artifacts: plans, research notes and reports a thread produced for an initiative. Read one from its `path`.",
  parameters: Schema.Struct(ArtifactListInput.fields),
  success: Schema.Struct({ artifacts: Schema.Array(Artifact) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ArtifactWriteTool = Tool.make("t3_artifact_write", {
  ...shared,
  description:
    "Write an artifact into the initiative's directory, where it outlives this thread. Same `fileName` replaces it. Not for code, which belongs in a worktree.",
  parameters: Schema.Struct(artifactFields),
  success: Schema.Struct({ artifact: Artifact }),
}).annotate(Tool.Destructive, true);

const ArtifactDeleteTool = Tool.make("t3_artifact_delete", {
  ...shared,
  description: "Forget an artifact. `deleteFile` also removes it from disk.",
  parameters: Schema.Struct(ArtifactDeleteInput.fields),
  success: Schema.Struct({ id: Schema.String }),
}).annotate(Tool.Destructive, true);

const TodoWriteTool = Tool.make("t3_todo_write", {
  ...shared,
  description:
    "Record this thread's open topics: side quests, findings, deferred scope and unanswered questions, grouped and tagged. Omit a row's `id` to create it. Not for the steps of the work you were asked to do.",
  parameters: Schema.Struct({ todos: Schema.Array(ThreadTodoWriteRow) }),
  success: Schema.Struct({ todos: Schema.Array(ThreadTodo) }),
  dependencies: [...shared.dependencies, ThreadTodos.ThreadTodoService],
}).annotate(Tool.Destructive, true);

export const WorkTrackingToolkit = Toolkit.make(
  TodoWriteTool,
  InitiativeListTool,
  InitiativeWriteTool,
  InitiativeDeleteTool,
  TicketListTool,
  TicketWriteTool,
  TicketDeleteTool,
  TicketLinkThreadTool,
  TicketUnlinkThreadTool,
  TicketStartTool,
  ArtifactListTool,
  ArtifactWriteTool,
  ArtifactDeleteTool,
);
