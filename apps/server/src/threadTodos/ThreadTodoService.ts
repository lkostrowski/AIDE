import {
  MAX_OPEN_THREAD_TODOS,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  ThreadId,
  type ThreadTodo,
  type ThreadTodoAddInput,
  ThreadTodoError,
  ThreadTodoId,
  type ThreadTodoListInput,
  type ThreadTodoListResult,
  type ThreadTodoMutationResult,
  type ThreadTodoSetStateInput,
  type ThreadTodoState,
  type ThreadTodoWriteInput,
  THREAD_TODO_USER_GROUP,
  TicketId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { buildThreadTodoContext, threadTodoWatermark } from "./threadTodoContext.ts";

export interface ThreadTodoWriteContext {
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

export class ThreadTodoService extends Context.Service<
  ThreadTodoService,
  {
    readonly list: (
      input: ThreadTodoListInput,
    ) => Effect.Effect<ThreadTodoListResult, ThreadTodoError>;
    readonly subscribe: (
      threadId: ThreadId,
    ) => Stream.Stream<ThreadTodoListResult, ThreadTodoError>;
    /** The agent's write. Creates, edits and closes rows; never reopens one. */
    readonly write: (
      input: ThreadTodoWriteInput,
      context: ThreadTodoWriteContext,
    ) => Effect.Effect<ThreadTodoListResult, ThreadTodoError>;
    readonly add: (
      input: ThreadTodoAddInput,
    ) => Effect.Effect<ThreadTodoMutationResult, ThreadTodoError>;
    /** The user's write, and the only path that can reopen a closed row. */
    readonly setState: (
      input: ThreadTodoSetStateInput,
    ) => Effect.Effect<ThreadTodoMutationResult, ThreadTodoError>;
    readonly read: (id: ThreadTodoId) => Effect.Effect<ThreadTodo | null, ThreadTodoError>;
    /** Cheap enough to ask on every turn, so a thread with no todos costs one count. */
    readonly hasAny: (threadId: ThreadId) => Effect.Effect<boolean, ThreadTodoError>;
    /**
     * The block for this thread's next turn, empty when nothing changed since the
     * last one. Delivering it advances the watermark, so a list is never re-sent
     * unchanged; `force` ignores the watermark, which compaction needs because the
     * provider drops the earlier copy.
     */
    readonly contextBlock: (
      threadId: ThreadId,
      options?: { readonly force?: boolean },
    ) => Effect.Effect<string, ThreadTodoError>;
    readonly attachTicket: (
      id: ThreadTodoId,
      ticketId: TicketId,
    ) => Effect.Effect<ThreadTodoMutationResult, ThreadTodoError>;
  }
>()("t3/threadTodos/ThreadTodoService") {}

function todoError(
  message: string,
  input?: {
    readonly todoId?: ThreadTodoId;
    readonly threadId?: ThreadId;
    readonly cause?: unknown;
  },
) {
  return new ThreadTodoError({
    message,
    ...(input?.todoId === undefined ? {} : { todoId: input.todoId }),
    ...(input?.threadId === undefined ? {} : { threadId: input.threadId }),
    ...(input?.cause === undefined ? {} : { cause: input.cause }),
  });
}

interface TodoRow {
  readonly todo_id: string;
  readonly thread_id: string;
  readonly todo_group: string;
  readonly text: string;
  readonly tags_json: string;
  readonly state: string;
  readonly revision: number;
  readonly ticket_id: string | null;
  readonly created_by: string;
  readonly creation_source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const STATES = new Set<string>(["open", "done", "discarded"]);

function asState(value: string): ThreadTodoState {
  return STATES.has(value) ? (value as ThreadTodoState) : "open";
}

/** Stored as JSON because the list is short and never queried by element. */
function encodeTags(values: ReadonlyArray<string>): string {
  return JSON.stringify(values);
}

function parseTags(json: string): ReadonlyArray<string> {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
}

function decode(row: TodoRow): ThreadTodo {
  return {
    id: ThreadTodoId.make(row.todo_id),
    threadId: ThreadId.make(row.thread_id),
    group: row.todo_group,
    text: row.text,
    tags: parseTags(row.tags_json),
    state: asState(row.state),
    revision: row.revision,
    ticketId: row.ticket_id === null ? null : TicketId.make(row.ticket_id),
    createdBy: row.created_by as ThreadTodo["createdBy"],
    creationSource: row.creation_source as ThreadTodo["creationSource"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const layer = Layer.effect(
  ThreadTodoService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const random = yield* SecureRandom.SecureRandom;

    // Slow subscribers need only the newest dirty signal; each one re-reads its thread.
    const changes = yield* PubSub.sliding<ThreadId>(16);
    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    // In memory on purpose: after a restart the provider session is new too, so the
    // list should go again rather than be suppressed by a watermark that outlived it.
    const watermarks = yield* Ref.make(new Map<ThreadId, number>());

    const nextRevision = (threadId: ThreadId) =>
      sql<{
        readonly next: number;
      }>`SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM thread_todos WHERE thread_id = ${threadId}`.pipe(
        Effect.map((rows) => rows[0]?.next ?? 1),
        Effect.mapError((cause) => todoError("Could not read the thread's todos.", { cause })),
      );

    const rowsForThread = (threadId: ThreadId) =>
      sql<TodoRow>`
        SELECT * FROM thread_todos WHERE thread_id = ${threadId} ORDER BY created_at
      `.pipe(
        Effect.map((rows) => rows.map(decode)),
        Effect.mapError((cause) => todoError("Could not read the thread's todos.", { cause })),
      );

    const read = Effect.fn("ThreadTodoService.read")(
      function* (id: ThreadTodoId) {
        const rows = yield* sql<TodoRow>`SELECT * FROM thread_todos WHERE todo_id = ${id}`;
        const row = rows[0];
        return row === undefined ? null : decode(row);
      },
      (effect, id) =>
        effect.pipe(
          Effect.mapError((cause) => todoError("Could not read the todo.", { todoId: id, cause })),
        ),
    );

    const require_ = Effect.fn("ThreadTodoService.require")(function* (id: ThreadTodoId) {
      const todo = yield* read(id);
      if (todo === null) return yield* todoError("That todo no longer exists.", { todoId: id });
      return todo;
    });

    const list: ThreadTodoService["Service"]["list"] = (input) =>
      rowsForThread(input.threadId).pipe(
        Effect.map((todos) => ({
          todos: input.state === undefined ? todos : todos.filter((t) => t.state === input.state),
        })),
      );

    const subscribe: ThreadTodoService["Service"]["subscribe"] = (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading so a change during the first read is not missed.
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(list({ threadId })),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((changed) => changed === threadId),
              Stream.mapEffect(() => list({ threadId })),
            ),
          );
        }),
      );

    const write = Effect.fn("ThreadTodoService.write")(function* (
      input: ThreadTodoWriteInput,
      context: ThreadTodoWriteContext,
    ) {
      const existing = yield* rowsForThread(input.threadId);
      const byId = new Map(existing.map((todo) => [todo.id, todo]));
      let openCount = existing.filter((todo) => todo.state === "open").length;
      const now = yield* nowIso;

      for (const row of input.todos) {
        if (row.id === undefined) {
          if (row.group === undefined || row.text === undefined) {
            return yield* todoError("A new todo needs a group and text.", {
              threadId: input.threadId,
            });
          }
          if (openCount >= MAX_OPEN_THREAD_TODOS) {
            return yield* todoError(
              `This thread already has ${String(MAX_OPEN_THREAD_TODOS)} open todos. Discard the stale ones before adding more.`,
              { threadId: input.threadId },
            );
          }
          const id = yield* random.uuidV4().pipe(
            Effect.mapError((cause) => todoError("Could not generate an id.", { cause })),
            Effect.map((uuid) => ThreadTodoId.make(`threadTodo:${uuid}`)),
          );
          yield* sql`
            INSERT INTO thread_todos (
              todo_id, thread_id, todo_group, text, tags_json, state, revision,
              ticket_id, created_by, creation_source, created_at, updated_at
            ) VALUES (
              ${id}, ${input.threadId}, ${row.group}, ${row.text},
              ${encodeTags(row.tags ?? [])}, ${row.state ?? "open"},
              ${yield* nextRevision(input.threadId)}, ${null},
              ${context.createdBy}, ${context.creationSource}, ${now}, ${now}
            )
          `.pipe(
            Effect.mapError((cause) =>
              todoError("Could not save the todo.", { threadId: input.threadId, cause }),
            ),
          );
          if ((row.state ?? "open") === "open") openCount += 1;
          continue;
        }

        const current = byId.get(row.id);
        if (current === undefined) {
          return yield* todoError("That todo is not on this thread.", { todoId: row.id });
        }
        // Reopening is the user's call alone, so a row they closed cannot come back on its own.
        const state = row.state ?? current.state;
        yield* sql`
          UPDATE thread_todos SET
            todo_group = ${row.group ?? current.group},
            text = ${row.text ?? current.text},
            tags_json = ${encodeTags(row.tags ?? current.tags)},
            state = ${state},
            revision = ${yield* nextRevision(input.threadId)},
            updated_at = ${now}
          WHERE todo_id = ${row.id}
        `.pipe(
          Effect.mapError((cause) =>
            todoError("Could not update the todo.", {
              ...(row.id === undefined ? {} : { todoId: row.id }),
              cause,
            }),
          ),
        );
      }

      yield* PubSub.publish(changes, input.threadId);
      return yield* list({ threadId: input.threadId });
    });

    const add = Effect.fn("ThreadTodoService.add")(function* (input: ThreadTodoAddInput) {
      const now = yield* nowIso;
      const id = yield* random.uuidV4().pipe(
        Effect.mapError((cause) => todoError("Could not generate an id.", { cause })),
        Effect.map((uuid) => ThreadTodoId.make(`threadTodo:${uuid}`)),
      );
      yield* sql`
        INSERT INTO thread_todos (
          todo_id, thread_id, todo_group, text, tags_json, state, revision,
          ticket_id, created_by, creation_source, created_at, updated_at
        ) VALUES (
          ${id}, ${input.threadId}, ${input.group ?? THREAD_TODO_USER_GROUP}, ${input.text},
          ${encodeTags(input.tags ?? [])}, ${"open"},
          ${yield* nextRevision(input.threadId)},
          ${null}, ${"user"}, ${"web"}, ${now}, ${now}
        )
      `.pipe(
        Effect.mapError((cause) =>
          todoError("Could not save the todo.", { threadId: input.threadId, cause }),
        ),
      );
      yield* PubSub.publish(changes, input.threadId);
      return { todo: yield* require_(id) };
    });

    const setState = Effect.fn("ThreadTodoService.setState")(function* (
      input: ThreadTodoSetStateInput,
    ) {
      const current = yield* require_(input.id);
      const now = yield* nowIso;
      yield* sql`
        UPDATE thread_todos SET
          state = ${input.state},
          revision = ${yield* nextRevision(current.threadId)},
          updated_at = ${now}
        WHERE todo_id = ${input.id}
      `.pipe(
        Effect.mapError((cause) =>
          todoError("Could not update the todo.", { todoId: input.id, cause }),
        ),
      );
      yield* PubSub.publish(changes, current.threadId);
      return { todo: yield* require_(input.id) };
    });

    const attachTicket = Effect.fn("ThreadTodoService.attachTicket")(function* (
      id: ThreadTodoId,
      ticketId: TicketId,
    ) {
      const current = yield* require_(id);
      const now = yield* nowIso;
      yield* sql`
        UPDATE thread_todos SET
          ticket_id = ${ticketId},
          state = ${"done"},
          revision = ${yield* nextRevision(current.threadId)},
          updated_at = ${now}
        WHERE todo_id = ${id}
      `.pipe(
        Effect.mapError((cause) => todoError("Could not link the ticket.", { todoId: id, cause })),
      );
      yield* PubSub.publish(changes, current.threadId);
      return { todo: yield* require_(id) };
    });

    const hasAny: ThreadTodoService["Service"]["hasAny"] = (threadId) =>
      sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM thread_todos WHERE thread_id = ${threadId}`.pipe(
        Effect.map((rows) => (rows[0]?.count ?? 0) > 0),
        Effect.mapError((cause) => todoError("Could not count the thread's todos.", { cause })),
      );

    const contextBlock = Effect.fn("ThreadTodoService.contextBlock")(function* (
      threadId: ThreadId,
      options?: { readonly force?: boolean },
    ) {
      const todos = yield* rowsForThread(threadId);
      if (todos.length === 0) return "";
      const delivered = yield* Ref.get(watermarks);
      const deliveredThrough = options?.force === true ? null : (delivered.get(threadId) ?? null);
      const block = buildThreadTodoContext(todos, { deliveredThrough });
      if (block === "") return "";
      const watermark = threadTodoWatermark(todos);
      if (watermark !== null) {
        yield* Ref.update(watermarks, (current) => new Map(current).set(threadId, watermark));
      }
      return block;
    });

    return { list, subscribe, write, add, setState, read, attachTicket, hasAny, contextBlock };
  }),
);
