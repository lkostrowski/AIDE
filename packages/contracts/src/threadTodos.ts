import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  ThreadId,
  ThreadTodoId,
  TicketId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationV2Actor, OrchestrationV2CreationSource } from "./orchestrationV2.ts";

/** Nothing leaves the list, so closing is a state and not a delete. Only the user reopens. */
export const ThreadTodoState = Schema.Literals(["open", "done", "discarded"]);
export type ThreadTodoState = typeof ThreadTodoState.Type;

const MAX_TAGS = 4;

export const ThreadTodoText = TrimmedNonEmptyString.check(Schema.isMaxLength(500));
export const ThreadTodoGroup = TrimmedNonEmptyString.check(Schema.isMaxLength(60));
export const ThreadTodoTag = TrimmedNonEmptyString.check(Schema.isMaxLength(32));
export const ThreadTodoTags = Schema.Array(ThreadTodoTag).check(Schema.isMaxLength(MAX_TAGS));

/** The group a user-written row lands in until an agent regroups it. */
export const THREAD_TODO_USER_GROUP = "Yours";

/** Past this many open rows an agent write fails, so a broad capture rule cannot flood the panel. */
export const MAX_OPEN_THREAD_TODOS = 100;

/** Rows injected per turn, newest groups last. Beyond it the block says how many it left out. */
export const MAX_INJECTED_THREAD_TODOS = 40;

export const ThreadTodo = Schema.Struct({
  id: ThreadTodoId,
  threadId: ThreadId,
  group: ThreadTodoGroup,
  text: ThreadTodoText,
  tags: ThreadTodoTags,
  state: ThreadTodoState,
  /** Bumped on every write. The per-turn context block is gated on it, not on a clock. */
  revision: Schema.Int,
  /** Set once converted. The row stays, marked done, pointing at the ticket. */
  ticketId: Schema.NullOr(TicketId),
  createdBy: OrchestrationV2Actor,
  creationSource: OrchestrationV2CreationSource,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadTodo = typeof ThreadTodo.Type;

/** One row of an agent write. Without an id it is new; with one, only the fields passed change. */
export const ThreadTodoWriteRow = Schema.Struct({
  id: Schema.optional(ThreadTodoId).annotate({
    description: "Omit to create. With it, only the fields you pass change.",
  }),
  group: Schema.optional(ThreadTodoGroup).annotate({
    description: "Reuse a group you were shown before inventing one. Required when creating.",
  }),
  text: Schema.optional(ThreadTodoText),
  tags: Schema.optional(ThreadTodoTags),
  state: Schema.optional(Schema.Literals(["done", "discarded"])).annotate({
    description: "Close a row you were wrong about. You cannot reopen one; say so instead.",
  }),
});
export type ThreadTodoWriteRow = typeof ThreadTodoWriteRow.Type;

export const ThreadTodoWriteInput = Schema.Struct({
  threadId: ThreadId,
  todos: Schema.Array(ThreadTodoWriteRow).check(Schema.isMaxLength(MAX_OPEN_THREAD_TODOS)),
});
export type ThreadTodoWriteInput = typeof ThreadTodoWriteInput.Type;

export const ThreadTodoListInput = Schema.Struct({
  threadId: ThreadId,
  state: Schema.optional(ThreadTodoState),
});
export type ThreadTodoListInput = typeof ThreadTodoListInput.Type;

export const ThreadTodoListResult = Schema.Struct({
  todos: ForwardCompatibleArray(ThreadTodo),
});
export type ThreadTodoListResult = typeof ThreadTodoListResult.Type;

export const ThreadTodoAddInput = Schema.Struct({
  threadId: ThreadId,
  text: ThreadTodoText,
  group: Schema.optional(ThreadTodoGroup),
  tags: Schema.optional(ThreadTodoTags),
});
export type ThreadTodoAddInput = typeof ThreadTodoAddInput.Type;

export const ThreadTodoSetStateInput = Schema.Struct({
  id: ThreadTodoId,
  state: ThreadTodoState,
});
export type ThreadTodoSetStateInput = typeof ThreadTodoSetStateInput.Type;

export const ThreadTodoMutationResult = Schema.Struct({ todo: ThreadTodo });
export type ThreadTodoMutationResult = typeof ThreadTodoMutationResult.Type;

export const ThreadTodoDraftTicketInput = Schema.Struct({ id: ThreadTodoId });
export type ThreadTodoDraftTicketInput = typeof ThreadTodoDraftTicketInput.Type;

/**
 * The writer's output before anyone commits it. The user edits this in a dialog, so a
 * generation failure still yields a usable draft rather than a dead button.
 */
export const ThreadTodoTicketDraft = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  initiativeId: Schema.NullOr(Schema.String),
  initiativeTitle: Schema.NullOr(Schema.String),
  /** Set when the cheap model could not write the draft; the title still falls back to the row. */
  generationError: Schema.NullOr(Schema.String),
});
export type ThreadTodoTicketDraft = typeof ThreadTodoTicketDraft.Type;

export const ThreadTodoCreateTicketInput = Schema.Struct({
  id: ThreadTodoId,
  title: TrimmedNonEmptyString,
  description: Schema.String.check(Schema.isMaxLength(20_000)),
});
export type ThreadTodoCreateTicketInput = typeof ThreadTodoCreateTicketInput.Type;

export const ThreadTodoCreateTicketResult = Schema.Struct({
  todo: ThreadTodo,
  ticketId: TicketId,
});
export type ThreadTodoCreateTicketResult = typeof ThreadTodoCreateTicketResult.Type;

export class ThreadTodoError extends Schema.TaggedError<ThreadTodoError>()("ThreadTodoError", {
  message: Schema.String,
  todoId: Schema.optional(ThreadTodoId),
  threadId: Schema.optional(ThreadId),
  cause: Schema.optional(Schema.Defect()),
}) {}
