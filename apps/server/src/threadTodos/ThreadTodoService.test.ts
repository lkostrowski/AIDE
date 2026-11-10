import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { MAX_OPEN_THREAD_TODOS, ThreadId, ThreadTodoError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ThreadTodoService from "./ThreadTodoService.ts";

const isThreadTodoError = Schema.is(ThreadTodoError);
const threadId = ThreadId.make("thread:1");
const agent = { createdBy: "agent", creationSource: "mcp" } as const;

const testLayer = ThreadTodoService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeCrypto.layer, SqlitePersistence.layerMemory)),
);

const run = <A, E>(effect: Effect.Effect<A, E, ThreadTodoService.ThreadTodoService>) =>
  Effect.provide(effect, testLayer);

it.effect("edits a row by id without clearing the fields left out", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      const written = yield* todos.write(
        { threadId, todos: [{ group: "Infra", text: "Ask about the quota", tags: ["infra"] }] },
        agent,
      );
      const created = written.todos[0]!;
      const updated = yield* todos.write(
        { threadId, todos: [{ id: created.id, text: "Ask infra about the quota" }] },
        agent,
      );
      const row = updated.todos[0]!;
      assert.strictEqual(updated.todos.length, 1);
      assert.strictEqual(row.text, "Ask infra about the quota");
      assert.strictEqual(row.group, "Infra");
      assert.deepStrictEqual(row.tags, ["infra"]);
    }),
  ),
);

it.effect("lets the agent close a row it got wrong", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      const written = yield* todos.write(
        { threadId, todos: [{ group: "Infra", text: "Ask about the quota" }] },
        agent,
      );
      const closed = yield* todos.write(
        { threadId, todos: [{ id: written.todos[0]!.id, state: "discarded" }] },
        agent,
      );
      assert.strictEqual(closed.todos[0]!.state, "discarded");
    }),
  ),
);

it.effect("never lets an agent write reopen a row the user closed", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      const written = yield* todos.write(
        { threadId, todos: [{ group: "Infra", text: "Ask about the quota" }] },
        agent,
      );
      const id = written.todos[0]!.id;
      yield* todos.setState({ id, state: "discarded" });
      // The write tool has no "open" state to pass, and omitting it keeps what is there.
      const after = yield* todos.write(
        { threadId, todos: [{ id, text: "Ask infra about the quota" }] },
        agent,
      );
      assert.strictEqual(after.todos[0]!.state, "discarded");
      assert.strictEqual(after.todos[0]!.text, "Ask infra about the quota");
    }),
  ),
);

it.effect("lets the user reopen a closed row", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      const added = yield* todos.add({ threadId, text: "Pick a name" });
      yield* todos.setState({ id: added.todo.id, state: "discarded" });
      const reopened = yield* todos.setState({ id: added.todo.id, state: "open" });
      assert.strictEqual(reopened.todo.state, "open");
    }),
  ),
);

it.effect("puts a user-written row in its own group and records the author", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      const added = yield* todos.add({ threadId, text: "Pick a name" });
      assert.strictEqual(added.todo.group, "Yours");
      assert.strictEqual(added.todo.createdBy, "user");
    }),
  ),
);

it.effect("refuses an agent write past the open cap, counting only open rows", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      yield* todos.write(
        {
          threadId,
          todos: Array.from({ length: MAX_OPEN_THREAD_TODOS }, (_, index) => ({
            group: "Infra",
            text: `Item ${String(index)}`,
          })),
        },
        agent,
      );
      const refused = yield* todos
        .write({ threadId, todos: [{ group: "Infra", text: "One more" }] }, agent)
        .pipe(Effect.flip);
      assert.isTrue(isThreadTodoError(refused));
      assert.include(refused.message, "Discard the stale ones");

      const existing = yield* todos.list({ threadId });
      yield* todos.setState({ id: existing.todos[0]!.id, state: "done" });
      const accepted = yield* todos.write(
        { threadId, todos: [{ group: "Infra", text: "One more" }] },
        agent,
      );
      assert.strictEqual(accepted.todos.length, MAX_OPEN_THREAD_TODOS + 1);
    }),
  ),
);

it.effect("refuses a row for a thread it does not belong to", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      const written = yield* todos.write(
        { threadId, todos: [{ group: "Infra", text: "Ask about the quota" }] },
        agent,
      );
      const refused = yield* todos
        .write(
          { threadId: ThreadId.make("thread:2"), todos: [{ id: written.todos[0]!.id }] },
          agent,
        )
        .pipe(Effect.flip);
      assert.isTrue(isThreadTodoError(refused));
    }),
  ),
);

it.effect("sends the block once, then again only after something changes", () =>
  run(
    Effect.gen(function* () {
      const todos = yield* ThreadTodoService.ThreadTodoService;
      yield* todos.write({ threadId, todos: [{ group: "Infra", text: "Ask about it" }] }, agent);
      const first = yield* todos.contextBlock(threadId);
      assert.include(first, "Ask about it");

      // An open row always rides along, so only its closure can fall out of the block.
      const listed = yield* todos.list({ threadId });
      yield* todos.setState({ id: listed.todos[0]!.id, state: "discarded" });
      const afterClose = yield* todos.contextBlock(threadId);
      assert.include(afterClose, "(discarded)");
      assert.strictEqual(yield* todos.contextBlock(threadId), "");

      // Compaction drops the provider's copy, so force resends it.
      assert.include(yield* todos.contextBlock(threadId, { force: true }), "(discarded)");
    }),
  ),
);
