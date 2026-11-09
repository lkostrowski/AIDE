import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS initiatives (
      initiative_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      project_ids_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      creation_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id TEXT PRIMARY KEY,
      initiative_id TEXT NOT NULL REFERENCES initiatives(initiative_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      blocked_reason TEXT,
      review_links_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      creation_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tickets_initiative
    ON tickets(initiative_id, status, updated_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS ticket_threads (
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (ticket_id, thread_id)
    )
  `;

  // The reactor looks a thread up to find the tickets it works on.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_ticket_threads_thread
    ON ticket_threads(thread_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS initiative_artifacts (
      artifact_id TEXT PRIMARY KEY,
      initiative_id TEXT NOT NULL REFERENCES initiatives(initiative_id) ON DELETE CASCADE,
      ticket_id TEXT REFERENCES tickets(ticket_id) ON DELETE SET NULL,
      thread_id TEXT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      creation_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (initiative_id, file_name)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_initiative_artifacts_ticket
    ON initiative_artifacts(ticket_id)
  `;
});
