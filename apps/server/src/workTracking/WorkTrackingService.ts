import {
  type Artifact,
  type ArtifactDeleteInput,
  ArtifactId,
  type ArtifactListInput,
  type ArtifactListResult,
  type ArtifactMutationResult,
  type ArtifactWriteInput,
  type Initiative,
  type InitiativeDeleteInput,
  InitiativeId,
  type InitiativeListResult,
  type InitiativeMutationResult,
  type InitiativeUpsertInput,
  ProjectId,
  type Ticket,
  type TicketDeleteInput,
  TicketId,
  type TicketListInput,
  type TicketListResult,
  type TicketMutationResult,
  type TicketStatus,
  type TicketThreadInput,
  type TicketUpsertInput,
  ThreadId,
  type WorkTrackingBoard,
  type WorkTrackingDeleteResult,
  WorkTrackingError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

export class WorkTrackingService extends Context.Service<
  WorkTrackingService,
  {
    readonly board: () => Effect.Effect<WorkTrackingBoard, WorkTrackingError>;
    readonly subscribeBoard: () => Stream.Stream<WorkTrackingBoard, WorkTrackingError>;
    readonly listInitiatives: () => Effect.Effect<InitiativeListResult, WorkTrackingError>;
    readonly upsertInitiative: (
      input: InitiativeUpsertInput,
    ) => Effect.Effect<InitiativeMutationResult, WorkTrackingError>;
    readonly deleteInitiative: (
      input: InitiativeDeleteInput,
    ) => Effect.Effect<WorkTrackingDeleteResult, WorkTrackingError>;
    readonly listTickets: (
      input: TicketListInput,
    ) => Effect.Effect<TicketListResult, WorkTrackingError>;
    readonly upsertTicket: (
      input: TicketUpsertInput,
    ) => Effect.Effect<TicketMutationResult, WorkTrackingError>;
    readonly deleteTicket: (
      input: TicketDeleteInput,
    ) => Effect.Effect<WorkTrackingDeleteResult, WorkTrackingError>;
    readonly linkTicketThread: (
      input: TicketThreadInput,
    ) => Effect.Effect<TicketMutationResult, WorkTrackingError>;
    readonly unlinkTicketThread: (
      input: TicketThreadInput,
    ) => Effect.Effect<TicketMutationResult, WorkTrackingError>;
    /**
     * Moves a Ticket's status when thread state demands it, and reports whether
     * anything changed so the reactor can stay quiet when nothing did.
     */
    readonly advanceTicketsForStartedThread: (
      threadId: ThreadId,
    ) => Effect.Effect<boolean, WorkTrackingError>;
    /** Tickets in `todo` that have at least one linked Thread, for the recovery sweep. */
    readonly pendingTicketThreads: () => Effect.Effect<
      ReadonlyArray<{ readonly ticketId: TicketId; readonly threadId: ThreadId }>,
      WorkTrackingError
    >;
    readonly listArtifacts: (
      input: ArtifactListInput,
    ) => Effect.Effect<ArtifactListResult, WorkTrackingError>;
    readonly writeArtifact: (
      input: ArtifactWriteInput,
    ) => Effect.Effect<ArtifactMutationResult, WorkTrackingError>;
    readonly deleteArtifact: (
      input: ArtifactDeleteInput,
    ) => Effect.Effect<WorkTrackingDeleteResult, WorkTrackingError>;
  }
>()("t3/workTracking/WorkTrackingService") {}

function workError(
  message: string,
  input?: {
    readonly initiativeId?: InitiativeId;
    readonly ticketId?: TicketId;
    readonly cause?: unknown;
  },
) {
  return new WorkTrackingError({
    message,
    ...(input?.initiativeId === undefined ? {} : { initiativeId: input.initiativeId }),
    ...(input?.ticketId === undefined ? {} : { ticketId: input.ticketId }),
    ...(input?.cause === undefined ? {} : { cause: input.cause }),
  });
}

interface InitiativeRow {
  readonly initiative_id: string;
  readonly title: string;
  readonly description: string;
  readonly project_ids_json: string;
  readonly created_by: string;
  readonly creation_source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TicketRow {
  readonly ticket_id: string;
  readonly initiative_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly blocked_reason: string | null;
  readonly review_links_json: string;
  readonly created_by: string;
  readonly creation_source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ArtifactRow {
  readonly artifact_id: string;
  readonly initiative_id: string;
  readonly ticket_id: string | null;
  readonly thread_id: string | null;
  readonly title: string;
  readonly file_name: string;
  readonly created_by: string;
  readonly creation_source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const STATUSES = new Set<string>(["todo", "doing", "blocked", "review", "done"]);

function asStatus(value: string): TicketStatus {
  return STATUSES.has(value) ? (value as TicketStatus) : "todo";
}

/** Stored as JSON because the lists are short and never queried by element. */
function parseStringArray(json: string): ReadonlyArray<string> {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
}

function encodeStringArray(values: ReadonlyArray<string>): string {
  return JSON.stringify(values);
}

export const layer = Layer.effect(
  WorkTrackingService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const random = yield* SecureRandom.SecureRandom;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;

    const initiativesDir = path.join(config.stateDir, "initiatives");
    // Ids carry a colon, which Windows rejects in a file name.
    const initiativeRoot = (id: InitiativeId) =>
      path.join(initiativesDir, id.replaceAll(/[^A-Za-z0-9._-]/gu, "-"));

    // Slow subscribers need only the newest dirty signal; each one re-reads the board.
    const changes = yield* PubSub.sliding<void>(1);
    const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

    const newId = (prefix: string) =>
      random.uuidV4().pipe(
        Effect.map((uuid) => `${prefix}:${uuid}`),
        Effect.mapError((cause) => workError(`Could not generate an id.`, { cause })),
      );

    const decodeInitiative = (row: InitiativeRow): Initiative => {
      const id = InitiativeId.make(row.initiative_id);
      return {
        id,
        title: row.title,
        description: row.description,
        projectIds: parseStringArray(row.project_ids_json).map((id) => ProjectId.make(id)),
        initiativeRoot: initiativeRoot(id),
        createdBy: row.created_by as Initiative["createdBy"],
        creationSource: row.creation_source as Initiative["creationSource"],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    };

    const decodeTicket = (row: TicketRow, threadIds: ReadonlyArray<ThreadId>): Ticket => ({
      id: TicketId.make(row.ticket_id),
      initiativeId: InitiativeId.make(row.initiative_id),
      title: row.title,
      description: row.description,
      status: asStatus(row.status),
      blockedReason: row.blocked_reason,
      reviewLinks: parseStringArray(row.review_links_json),
      threadIds,
      createdBy: row.created_by as Ticket["createdBy"],
      creationSource: row.creation_source as Ticket["creationSource"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });

    const decodeArtifact = (row: ArtifactRow): Artifact => {
      const initiativeId = InitiativeId.make(row.initiative_id);
      return {
        id: ArtifactId.make(row.artifact_id),
        initiativeId,
        ticketId: row.ticket_id === null ? null : TicketId.make(row.ticket_id),
        threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
        title: row.title,
        fileName: row.file_name,
        path: path.join(initiativeRoot(initiativeId), row.file_name),
        createdBy: row.created_by as Artifact["createdBy"],
        creationSource: row.creation_source as Artifact["creationSource"],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    };

    const threadIdsByTicket = Effect.fn("WorkTrackingService.threadIdsByTicket")(function* () {
      const rows = yield* sql<{
        readonly ticket_id: string;
        readonly thread_id: string;
      }>`SELECT ticket_id, thread_id FROM ticket_threads ORDER BY linked_at`;
      const grouped = new Map<string, Array<ThreadId>>();
      for (const row of rows) {
        const existing = grouped.get(row.ticket_id);
        const threadId = ThreadId.make(row.thread_id);
        if (existing === undefined) grouped.set(row.ticket_id, [threadId]);
        else existing.push(threadId);
      }
      return grouped;
    });

    const readInitiative = Effect.fn("WorkTrackingService.readInitiative")(function* (
      id: InitiativeId,
    ) {
      const rows = yield* sql<InitiativeRow>`
        SELECT * FROM initiatives WHERE initiative_id = ${id}
      `;
      const row = rows[0];
      return row === undefined ? null : decodeInitiative(row);
    });

    const readTicket = Effect.fn("WorkTrackingService.readTicket")(function* (id: TicketId) {
      const rows = yield* sql<TicketRow>`SELECT * FROM tickets WHERE ticket_id = ${id}`;
      const row = rows[0];
      if (row === undefined) return null;
      const threads = yield* sql<{
        readonly thread_id: string;
      }>`SELECT thread_id FROM ticket_threads WHERE ticket_id = ${id} ORDER BY linked_at`;
      return decodeTicket(
        row,
        threads.map((entry) => ThreadId.make(entry.thread_id)),
      );
    });

    const requireTicket = Effect.fn("WorkTrackingService.requireTicket")(function* (id: TicketId) {
      const ticket = yield* readTicket(id).pipe(
        Effect.mapError((cause) =>
          workError("Could not read the ticket.", { ticketId: id, cause }),
        ),
      );
      if (ticket === null)
        return yield* workError("That ticket no longer exists.", { ticketId: id });
      return ticket;
    });

    const listInitiatives: WorkTrackingService["Service"]["listInitiatives"] = () =>
      sql<InitiativeRow>`SELECT * FROM initiatives ORDER BY created_at DESC`.pipe(
        Effect.map((rows) => ({ initiatives: rows.map(decodeInitiative) })),
        Effect.mapError((cause) => workError("Could not list initiatives.", { cause })),
      );

    const listTickets = Effect.fn("WorkTrackingService.listTickets")(
      function* (input: TicketListInput) {
        const rows = yield* sql<TicketRow>`
          SELECT t.* FROM tickets t
          ${
            input.threadId === undefined
              ? sql``
              : sql`JOIN ticket_threads tt
                    ON tt.ticket_id = t.ticket_id AND tt.thread_id = ${input.threadId}`
          }
          WHERE 1 = 1
          ${input.initiativeId === undefined ? sql`` : sql`AND t.initiative_id = ${input.initiativeId}`}
          ${input.status === undefined ? sql`` : sql`AND t.status = ${input.status}`}
          ORDER BY t.created_at DESC
        `;
        const threads = yield* threadIdsByTicket();
        return { tickets: rows.map((row) => decodeTicket(row, threads.get(row.ticket_id) ?? [])) };
      },
      (effect) =>
        effect.pipe(Effect.mapError((cause) => workError("Could not list tickets.", { cause }))),
    );

    const listArtifacts: WorkTrackingService["Service"]["listArtifacts"] = (input) =>
      sql<ArtifactRow>`
        SELECT * FROM initiative_artifacts
        WHERE 1 = 1
        ${input.initiativeId === undefined ? sql`` : sql`AND initiative_id = ${input.initiativeId}`}
        ${input.ticketId === undefined ? sql`` : sql`AND ticket_id = ${input.ticketId}`}
        ORDER BY created_at DESC
      `.pipe(
        Effect.map((rows) => ({ artifacts: rows.map(decodeArtifact) })),
        Effect.mapError((cause) => workError("Could not list artifacts.", { cause })),
      );

    const board: WorkTrackingService["Service"]["board"] = () =>
      Effect.all({
        initiatives: listInitiatives().pipe(Effect.map((result) => result.initiatives)),
        tickets: listTickets({}).pipe(Effect.map((result) => result.tickets)),
        artifacts: listArtifacts({}).pipe(Effect.map((result) => result.artifacts)),
      });

    const subscribeBoard: WorkTrackingService["Service"]["subscribeBoard"] = () =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading so a change during the first read is not missed.
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(board()),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => board())),
          );
        }),
      );

    const upsertInitiative = Effect.fn("WorkTrackingService.upsertInitiative")(function* (
      input: InitiativeUpsertInput,
    ) {
      const now = yield* nowIso;
      const existing =
        input.id === undefined
          ? null
          : yield* readInitiative(input.id).pipe(
              Effect.mapError((cause) => workError("Could not read the initiative.", { cause })),
            );
      if (input.id !== undefined && existing === null) {
        return yield* workError("That initiative no longer exists.", { initiativeId: input.id });
      }
      const title = input.title ?? existing?.title;
      if (title === undefined) {
        return yield* workError("A new initiative needs a title.");
      }
      const id = existing?.id ?? InitiativeId.make(yield* newId("initiative"));
      const description = input.description ?? existing?.description ?? "";
      const projectIds = input.projectIds ?? existing?.projectIds ?? [];
      yield* sql`
          INSERT INTO initiatives (
            initiative_id, title, description, project_ids_json,
            created_by, creation_source, created_at, updated_at
          ) VALUES (
            ${id}, ${title}, ${description}, ${encodeStringArray(projectIds)},
            ${input.createdBy ?? "user"}, ${input.creationSource ?? "web"},
            ${existing?.createdAt ?? now}, ${now}
          )
          ON CONFLICT(initiative_id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            project_ids_json = excluded.project_ids_json,
            updated_at = excluded.updated_at
        `.pipe(
        Effect.mapError((cause) =>
          workError("Could not save the initiative.", { initiativeId: id, cause }),
        ),
      );
      // Created eagerly so an agent can write into it without a second round trip.
      yield* fileSystem
        .makeDirectory(initiativeRoot(id), { recursive: true })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not create the initiative directory.", { id, cause }),
          ),
        );
      yield* notifyChanged;
      const saved = yield* readInitiative(id).pipe(
        Effect.mapError((cause) =>
          workError("Could not read the saved initiative.", { initiativeId: id, cause }),
        ),
      );
      if (saved === null) {
        return yield* workError("The initiative disappeared while saving.", { initiativeId: id });
      }
      return { initiative: saved };
    });

    const deleteInitiative = Effect.fn("WorkTrackingService.deleteInitiative")(function* (
      input: InitiativeDeleteInput,
    ) {
      const tickets = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM tickets WHERE initiative_id = ${input.id}`.pipe(
        Effect.mapError((cause) =>
          workError("Could not read the initiative's tickets.", {
            initiativeId: input.id,
            cause,
          }),
        ),
      );
      if ((tickets[0]?.count ?? 0) > 0 && input.force !== true) {
        return yield* workError(
          "That initiative still has tickets; pass force to delete them with it.",
          { initiativeId: input.id },
        );
      }
      // Tickets, their thread links and artifact records cascade.
      yield* sql`DELETE FROM initiatives WHERE initiative_id = ${input.id}`.pipe(
        Effect.mapError((cause) =>
          workError("Could not delete the initiative.", { initiativeId: input.id, cause }),
        ),
      );
      yield* notifyChanged;
      return { id: input.id };
    });

    const upsertTicket = Effect.fn("WorkTrackingService.upsertTicket")(function* (
      input: TicketUpsertInput,
    ) {
      const now = yield* nowIso;
      const existing = input.id === undefined ? null : yield* requireTicket(input.id);
      const initiativeId = input.initiativeId ?? existing?.initiativeId;
      if (initiativeId === undefined) {
        return yield* workError("A new ticket needs an initiativeId.");
      }
      const initiative = yield* readInitiative(initiativeId).pipe(
        Effect.mapError((cause) => workError("Could not read the initiative.", { cause })),
      );
      if (initiative === null) {
        return yield* workError("That initiative no longer exists.", { initiativeId });
      }
      const title = input.title ?? existing?.title;
      if (title === undefined) return yield* workError("A new ticket needs a title.");
      const status = input.status ?? existing?.status ?? "todo";
      const blockedReason =
        input.blockedReason === undefined ? (existing?.blockedReason ?? null) : input.blockedReason;
      if (status === "blocked" && (blockedReason === null || blockedReason.trim() === "")) {
        return yield* workError(
          "A blocked ticket needs a blockedReason.",
          existing === null ? {} : { ticketId: existing.id },
        );
      }
      const id = existing?.id ?? TicketId.make(yield* newId("ticket"));
      yield* sql`
          INSERT INTO tickets (
            ticket_id, initiative_id, title, description, status, blocked_reason,
            review_links_json, created_by, creation_source, created_at, updated_at
          ) VALUES (
            ${id}, ${initiativeId}, ${title}, ${input.description ?? existing?.description ?? ""},
            ${status}, ${status === "blocked" ? blockedReason : null},
            ${encodeStringArray(input.reviewLinks ?? existing?.reviewLinks ?? [])},
            ${input.createdBy ?? "user"}, ${input.creationSource ?? "web"},
            ${existing?.createdAt ?? now}, ${now}
          )
          ON CONFLICT(ticket_id) DO UPDATE SET
            initiative_id = excluded.initiative_id,
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            blocked_reason = excluded.blocked_reason,
            review_links_json = excluded.review_links_json,
            updated_at = excluded.updated_at
        `.pipe(
        Effect.mapError((cause) =>
          workError("Could not save the ticket.", { ticketId: id, cause }),
        ),
      );
      yield* notifyChanged;
      return { ticket: yield* requireTicket(id) };
    });

    const deleteTicket: WorkTrackingService["Service"]["deleteTicket"] = (input) =>
      sql`DELETE FROM tickets WHERE ticket_id = ${input.id}`.pipe(
        Effect.mapError((cause) =>
          workError("Could not delete the ticket.", { ticketId: input.id, cause }),
        ),
        Effect.andThen(notifyChanged),
        Effect.as({ id: input.id }),
      );

    const linkTicketThread = Effect.fn("WorkTrackingService.linkTicketThread")(function* (
      input: TicketThreadInput,
    ) {
      yield* requireTicket(input.ticketId);
      const now = yield* nowIso;
      yield* sql`
          INSERT INTO ticket_threads (ticket_id, thread_id, linked_at)
          VALUES (${input.ticketId}, ${input.threadId}, ${now})
          ON CONFLICT(ticket_id, thread_id) DO NOTHING
        `.pipe(
        Effect.mapError((cause) =>
          workError("Could not link the thread.", { ticketId: input.ticketId, cause }),
        ),
      );
      yield* notifyChanged;
      return { ticket: yield* requireTicket(input.ticketId) };
    });

    const unlinkTicketThread = Effect.fn("WorkTrackingService.unlinkTicketThread")(function* (
      input: TicketThreadInput,
    ) {
      yield* sql`
          DELETE FROM ticket_threads
          WHERE ticket_id = ${input.ticketId} AND thread_id = ${input.threadId}
        `.pipe(
        Effect.mapError((cause) =>
          workError("Could not unlink the thread.", { ticketId: input.ticketId, cause }),
        ),
      );
      yield* notifyChanged;
      return { ticket: yield* requireTicket(input.ticketId) };
    });

    /**
     * A function of thread state, not a delta: a Ticket whose Thread has started
     * is not in `todo`, so applying this twice is a no-op.
     */
    const advanceTicketsForStartedThread = Effect.fn(
      "WorkTrackingService.advanceTicketsForStartedThread",
    )(
      function* (threadId: ThreadId) {
        const pending = yield* sql<{ readonly ticket_id: string }>`
            SELECT tt.ticket_id FROM ticket_threads tt
            JOIN tickets t ON t.ticket_id = tt.ticket_id
            WHERE tt.thread_id = ${threadId} AND t.status = 'todo'
          `;
        if (pending.length === 0) return false;
        const now = yield* nowIso;
        yield* sql`
            UPDATE tickets SET status = 'doing', updated_at = ${now}
            WHERE status = 'todo'
              AND ticket_id IN (SELECT ticket_id FROM ticket_threads WHERE thread_id = ${threadId})
          `;
        yield* notifyChanged;
        return true;
      },
      (effect) =>
        effect.pipe(
          Effect.mapError((cause) =>
            workError("Could not advance tickets for a started thread.", { cause }),
          ),
        ),
    );

    const pendingTicketThreads: WorkTrackingService["Service"]["pendingTicketThreads"] = () =>
      sql<{ readonly ticket_id: string; readonly thread_id: string }>`
        SELECT tt.ticket_id, tt.thread_id
        FROM ticket_threads tt
        JOIN tickets t ON t.ticket_id = tt.ticket_id
        WHERE t.status = 'todo'
      `.pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            ticketId: TicketId.make(row.ticket_id),
            threadId: ThreadId.make(row.thread_id),
          })),
        ),
        Effect.mapError((cause) => workError("Could not read pending ticket threads.", { cause })),
      );

    const writeArtifact = Effect.fn("WorkTrackingService.writeArtifact")(function* (
      input: ArtifactWriteInput,
    ) {
      const initiative = yield* readInitiative(input.initiativeId).pipe(
        Effect.mapError((cause) => workError("Could not read the initiative.", { cause })),
      );
      if (initiative === null) {
        return yield* workError("That initiative no longer exists.", {
          initiativeId: input.initiativeId,
        });
      }
      if (input.ticketId !== undefined && input.ticketId !== null) {
        const ticket = yield* requireTicket(input.ticketId);
        if (ticket.initiativeId !== input.initiativeId) {
          return yield* workError("That ticket belongs to a different initiative.", {
            ticketId: input.ticketId,
          });
        }
      }
      const root = initiativeRoot(input.initiativeId);
      const now = yield* nowIso;
      yield* fileSystem.makeDirectory(root, { recursive: true }).pipe(
        Effect.mapError((cause) =>
          workError("Could not create the initiative directory.", {
            initiativeId: input.initiativeId,
            cause,
          }),
        ),
      );
      yield* fileSystem.writeFileString(path.join(root, input.fileName), input.content).pipe(
        Effect.mapError((cause) =>
          workError("Could not write the artifact file.", {
            initiativeId: input.initiativeId,
            cause,
          }),
        ),
      );
      const existing = yield* sql<ArtifactRow>`
          SELECT * FROM initiative_artifacts
          WHERE initiative_id = ${input.initiativeId} AND file_name = ${input.fileName}
        `.pipe(Effect.mapError((cause) => workError("Could not read the artifact.", { cause })));
      const id = existing[0]?.artifact_id ?? (yield* newId("artifact"));
      yield* sql`
          INSERT INTO initiative_artifacts (
            artifact_id, initiative_id, ticket_id, thread_id, title, file_name,
            created_by, creation_source, created_at, updated_at
          ) VALUES (
            ${id}, ${input.initiativeId}, ${input.ticketId ?? null}, ${input.threadId ?? null},
            ${input.title}, ${input.fileName},
            ${input.createdBy ?? "agent"}, ${input.creationSource ?? "mcp"},
            ${existing[0]?.created_at ?? now}, ${now}
          )
          ON CONFLICT(artifact_id) DO UPDATE SET
            ticket_id = excluded.ticket_id,
            thread_id = excluded.thread_id,
            title = excluded.title,
            updated_at = excluded.updated_at
        `.pipe(Effect.mapError((cause) => workError("Could not save the artifact.", { cause })));
      yield* notifyChanged;
      const rows = yield* sql<ArtifactRow>`
          SELECT * FROM initiative_artifacts WHERE artifact_id = ${id}
        `.pipe(Effect.mapError((cause) => workError("Could not read the artifact.", { cause })));
      const row = rows[0];
      if (row === undefined) return yield* workError("The artifact disappeared while saving.");
      return { artifact: decodeArtifact(row) };
    });

    const deleteArtifact = Effect.fn("WorkTrackingService.deleteArtifact")(function* (
      input: ArtifactDeleteInput,
    ) {
      const rows = yield* sql<ArtifactRow>`
          SELECT * FROM initiative_artifacts WHERE artifact_id = ${input.id}
        `.pipe(Effect.mapError((cause) => workError("Could not read the artifact.", { cause })));
      const row = rows[0];
      if (row === undefined) return { id: input.id };
      yield* sql`DELETE FROM initiative_artifacts WHERE artifact_id = ${input.id}`.pipe(
        Effect.mapError((cause) => workError("Could not delete the artifact.", { cause })),
      );
      if (input.deleteFile === true) {
        yield* fileSystem
          .remove(decodeArtifact(row).path)
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not remove the artifact file.", { id: input.id, cause }),
            ),
          );
      }
      yield* notifyChanged;
      return { id: input.id };
    });

    return {
      board,
      subscribeBoard,
      listInitiatives,
      upsertInitiative,
      deleteInitiative,
      listTickets,
      upsertTicket,
      deleteTicket,
      linkTicketThread,
      unlinkTicketThread,
      advanceTicketsForStartedThread,
      pendingTicketThreads,
      listArtifacts,
      writeArtifact,
      deleteArtifact,
    } satisfies WorkTrackingService["Service"];
  }),
);
