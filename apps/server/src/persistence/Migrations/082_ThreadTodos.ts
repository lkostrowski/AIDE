import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_todos (
      todo_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      todo_group TEXT NOT NULL,
      text TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      state TEXT NOT NULL,
      -- Per-thread and monotonic: two writes in one millisecond share a timestamp.
      revision INTEGER NOT NULL,
      ticket_id TEXT,
      created_by TEXT NOT NULL,
      creation_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // The panel and the per-turn context block both read one thread's rows in display order.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_todos_thread
    ON thread_todos(thread_id, created_at)
  `;
});
