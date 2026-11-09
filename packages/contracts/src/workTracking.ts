import * as Schema from "effect/Schema";

import {
  ArtifactId,
  ForwardCompatibleArray,
  InitiativeId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TicketId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationV2Actor, OrchestrationV2CreationSource } from "./orchestrationV2.ts";

/** A default, not a decision: the set is closed so a board column maps to one value. */
export const TicketStatus = Schema.Literals(["todo", "doing", "blocked", "review", "done"]);
export type TicketStatus = typeof TicketStatus.Type;

export const TICKET_STATUSES = ["todo", "doing", "blocked", "review", "done"] as const;

const MAX_TICKET_REVIEW_LINKS = 16;

const Description = Schema.String.check(Schema.isMaxLength(20_000));
const ReviewLinks = Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(2048))).check(
  Schema.isMaxLength(MAX_TICKET_REVIEW_LINKS),
);

/** A file name inside the Initiative's directory. No separators, so an Artifact cannot escape it. */
export const ArtifactFileName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(120),
  Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/),
).annotate({ description: "File name such as plan.md. No directories." });

const MAX_ARTIFACT_CONTENT_CHARS = 400_000;

const CreationFields = {
  createdBy: OrchestrationV2Actor,
  creationSource: OrchestrationV2CreationSource,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const;

export const Initiative = Schema.Struct({
  id: InitiativeId,
  title: TrimmedNonEmptyString,
  description: Description,
  /** Projects the work spans. A Ticket's Threads each live in one of them. */
  projectIds: Schema.Array(ProjectId),
  /** The Initiative's directory, where its Artifacts land. */
  initiativeRoot: Schema.String,
  ...CreationFields,
});
export type Initiative = typeof Initiative.Type;

export const Ticket = Schema.Struct({
  id: TicketId,
  initiativeId: InitiativeId,
  title: TrimmedNonEmptyString,
  description: Description,
  status: TicketStatus,
  blockedReason: Schema.NullOr(Schema.String),
  reviewLinks: ReviewLinks,
  /** The Threads doing the work, each in one Project with its own worktree. */
  threadIds: Schema.Array(ThreadId),
  ...CreationFields,
});
export type Ticket = typeof Ticket.Type;

export const Artifact = Schema.Struct({
  id: ArtifactId,
  initiativeId: InitiativeId,
  ticketId: Schema.NullOr(TicketId),
  /** The Thread that produced it. The Artifact outlives it, so the Thread may be gone. */
  threadId: Schema.NullOr(ThreadId),
  title: TrimmedNonEmptyString,
  fileName: ArtifactFileName,
  /** Absolute path, so an agent can read it without knowing where the Initiative's directory is. */
  path: Schema.String,
  ...CreationFields,
});
export type Artifact = typeof Artifact.Type;

export const WorkTrackingBoardInput = Schema.Struct({});
export type WorkTrackingBoardInput = typeof WorkTrackingBoardInput.Type;

/**
 * One payload for the whole board. Initiatives and Tickets are hand-written
 * work items, so the list stays small enough that paging would cost more than
 * it saves.
 */
export const WorkTrackingBoard = Schema.Struct({
  initiatives: ForwardCompatibleArray(Initiative),
  tickets: ForwardCompatibleArray(Ticket),
  artifacts: ForwardCompatibleArray(Artifact),
});
export type WorkTrackingBoard = typeof WorkTrackingBoard.Type;

export const InitiativeUpsertInput = Schema.Struct({
  id: Schema.optional(InitiativeId).annotate({
    description: "Omit to create. With it, only the fields you pass change.",
  }),
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Description),
  projectIds: Schema.optional(Schema.Array(ProjectId)),
  createdBy: Schema.optional(OrchestrationV2Actor),
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type InitiativeUpsertInput = typeof InitiativeUpsertInput.Type;

export const InitiativeDeleteInput = Schema.Struct({
  id: InitiativeId,
  /** Also delete its Tickets and Artifact records. The directory on disk stays. */
  force: Schema.optional(Schema.Boolean),
});
export type InitiativeDeleteInput = typeof InitiativeDeleteInput.Type;

export const InitiativeMutationResult = Schema.Struct({ initiative: Initiative });
export type InitiativeMutationResult = typeof InitiativeMutationResult.Type;

export const InitiativeListInput = Schema.Struct({});
export type InitiativeListInput = typeof InitiativeListInput.Type;

export const InitiativeListResult = Schema.Struct({
  initiatives: ForwardCompatibleArray(Initiative),
});
export type InitiativeListResult = typeof InitiativeListResult.Type;

export const TicketUpsertInput = Schema.Struct({
  id: Schema.optional(TicketId).annotate({
    description: "Omit to create. With it, only the fields you pass change.",
  }),
  initiativeId: Schema.optional(InitiativeId),
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Description),
  status: Schema.optional(TicketStatus),
  blockedReason: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))),
  reviewLinks: Schema.optional(ReviewLinks),
  createdBy: Schema.optional(OrchestrationV2Actor),
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type TicketUpsertInput = typeof TicketUpsertInput.Type;

export const TicketDeleteInput = Schema.Struct({ id: TicketId });
export type TicketDeleteInput = typeof TicketDeleteInput.Type;

export const TicketMutationResult = Schema.Struct({ ticket: Ticket });
export type TicketMutationResult = typeof TicketMutationResult.Type;

export const TicketListInput = Schema.Struct({
  initiativeId: Schema.optional(InitiativeId),
  status: Schema.optional(TicketStatus),
  threadId: Schema.optional(ThreadId).annotate({
    description: "Only Tickets this Thread works on.",
  }),
});
export type TicketListInput = typeof TicketListInput.Type;

export const TicketListResult = Schema.Struct({ tickets: ForwardCompatibleArray(Ticket) });
export type TicketListResult = typeof TicketListResult.Type;

export const TicketThreadInput = Schema.Struct({
  ticketId: TicketId,
  threadId: ThreadId,
});
export type TicketThreadInput = typeof TicketThreadInput.Type;

export const TicketStartInput = Schema.Struct({
  ticketId: TicketId,
  projectId: Schema.optional(ProjectId).annotate({
    description: "Required when the Initiative spans more than one Project.",
  }),
  prompt: Schema.optional(Schema.String.check(Schema.isMaxLength(20_000))).annotate({
    description: "First message. Default: the Ticket's title and description.",
  }),
});
export type TicketStartInput = typeof TicketStartInput.Type;

export const TicketStartResult = Schema.Struct({
  ticket: Ticket,
  threadId: ThreadId,
  projectId: ProjectId,
});
export type TicketStartResult = typeof TicketStartResult.Type;

export const ArtifactWriteInput = Schema.Struct({
  initiativeId: InitiativeId,
  ticketId: Schema.optional(Schema.NullOr(TicketId)),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  title: TrimmedNonEmptyString,
  fileName: ArtifactFileName,
  content: Schema.String.check(Schema.isMaxLength(MAX_ARTIFACT_CONTENT_CHARS)),
  createdBy: Schema.optional(OrchestrationV2Actor),
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type ArtifactWriteInput = typeof ArtifactWriteInput.Type;

export const ArtifactListInput = Schema.Struct({
  initiativeId: Schema.optional(InitiativeId),
  ticketId: Schema.optional(TicketId),
});
export type ArtifactListInput = typeof ArtifactListInput.Type;

export const ArtifactListResult = Schema.Struct({ artifacts: ForwardCompatibleArray(Artifact) });
export type ArtifactListResult = typeof ArtifactListResult.Type;

export const ArtifactDeleteInput = Schema.Struct({
  id: ArtifactId,
  /** Also remove the file from the Initiative's directory. */
  deleteFile: Schema.optional(Schema.Boolean),
});
export type ArtifactDeleteInput = typeof ArtifactDeleteInput.Type;

export const ArtifactMutationResult = Schema.Struct({ artifact: Artifact });
export type ArtifactMutationResult = typeof ArtifactMutationResult.Type;

export const WorkTrackingDeleteResult = Schema.Struct({ id: Schema.String });
export type WorkTrackingDeleteResult = typeof WorkTrackingDeleteResult.Type;

export class WorkTrackingError extends Schema.TaggedError<WorkTrackingError>()(
  "WorkTrackingError",
  {
    message: Schema.String,
    initiativeId: Schema.optional(InitiativeId),
    ticketId: Schema.optional(TicketId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
