import {
  type ProjectId,
  type ThreadId,
  type ThreadTodoCreateTicketInput,
  type ThreadTodoCreateTicketResult,
  type ThreadTodoDraftTicketInput,
  ThreadTodoError,
  type ThreadTodoTicketDraft,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGenerationService from "../textGeneration/TextGeneration.ts";
import * as WorkTracking from "../workTracking/WorkTrackingService.ts";
import * as ThreadTodos from "./ThreadTodoService.ts";
import { threadTodoTranscriptExcerpt } from "./threadTodoTranscript.ts";

export class ThreadTodoTicketService extends Context.Service<
  ThreadTodoTicketService,
  {
    /** Writes nothing: the user edits this before anything lands on the board. */
    readonly draft: (
      input: ThreadTodoDraftTicketInput,
    ) => Effect.Effect<ThreadTodoTicketDraft, ThreadTodoError>;
    readonly create: (
      input: ThreadTodoCreateTicketInput,
    ) => Effect.Effect<ThreadTodoCreateTicketResult, ThreadTodoError>;
  }
>()("t3/threadTodos/ThreadTodoTicketService") {}

function todoError(message: string, cause?: unknown) {
  return new ThreadTodoError({ message, ...(cause === undefined ? {} : { cause }) });
}

export const layer = Layer.effect(
  ThreadTodoTicketService,
  Effect.gen(function* () {
    const todos = yield* ThreadTodos.ThreadTodoService;
    const work = yield* WorkTracking.WorkTrackingService;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const projects = yield* ProjectService.ProjectService;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const textGeneration = yield* TextGenerationService.TextGeneration;

    const requireTodo = Effect.fn("ThreadTodoTicketService.requireTodo")(function* (
      id: ThreadTodoCreateTicketInput["id"],
    ) {
      const todo = yield* todos.read(id);
      if (todo === null) return yield* todoError("That todo no longer exists.");
      return todo;
    });

    /**
     * A ticket the thread already works on wins; otherwise the only initiative covering
     * its project. With neither, the client keeps the action disabled rather than
     * inventing an initiative.
     */
    const resolveInitiative = Effect.fn("ThreadTodoTicketService.resolveInitiative")(function* (
      threadId: ThreadId,
      projectId: ProjectId,
    ) {
      const board = yield* work
        .board()
        .pipe(Effect.mapError((error) => todoError(error.message, error)));
      const linked = board.tickets.find((ticket) => ticket.threadIds.includes(threadId));
      if (linked !== undefined) {
        const initiative = board.initiatives.find((entry) => entry.id === linked.initiativeId);
        return initiative ?? null;
      }
      const covering = board.initiatives.filter((entry) =>
        entry.projectIds.some((candidate) => candidate === projectId),
      );
      return covering.length === 1 ? (covering[0] ?? null) : null;
    });

    const gather = Effect.fn("ThreadTodoTicketService.gather")(function* (
      id: ThreadTodoCreateTicketInput["id"],
    ) {
      const todo = yield* requireTodo(id);
      const records = yield* projections
        .getThreadRecords(todo.threadId, ["messages"])
        .pipe(Effect.mapError((cause) => todoError("Could not read the thread.", cause)));
      const project = yield* projects.getById(records.thread.projectId).pipe(
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      );
      const initiative = yield* resolveInitiative(todo.threadId, records.thread.projectId);
      return { todo, records, project, initiative };
    });

    const draft: ThreadTodoTicketService["Service"]["draft"] = Effect.fn(
      "ThreadTodoTicketService.draft",
    )(function* (input) {
      const { todo, records, project, initiative } = yield* gather(input.id);
      const base = {
        initiativeId: initiative?.id ?? null,
        initiativeTitle: initiative?.title ?? null,
      };
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) => todoError("Could not read model settings.", cause)),
      );
      const generated = yield* textGeneration
        .generateTicketContent({
          cwd: project?.workspaceRoot ?? records.thread.worktreePath ?? process.cwd(),
          todoText: todo.text,
          todoTags: todo.tags,
          threadTitle: records.thread.title ?? "",
          projectName: project?.title ?? "",
          transcriptExcerpt: threadTodoTranscriptExcerpt(records.messages, todo.createdAt),
          modelSelection: settings.textGenerationModelSelection,
        })
        .pipe(Effect.option);
      if (generated._tag === "None") {
        // A dead button helps nobody: the row's own text is a usable title to edit.
        return {
          ...base,
          title: todo.text,
          description: "",
          generationError: "Could not write the issue. Edit it here, or change the model.",
        };
      }
      return {
        ...base,
        title: generated.value.title,
        description: generated.value.description,
        generationError: null,
      };
    });

    const create: ThreadTodoTicketService["Service"]["create"] = Effect.fn(
      "ThreadTodoTicketService.create",
    )(function* (input) {
      const { todo, initiative } = yield* gather(input.id);
      if (initiative === null) {
        return yield* todoError(
          "This thread is not part of an initiative, so there is nowhere to file the issue.",
        );
      }
      const created = yield* work
        .upsertTicket({
          initiativeId: initiative.id,
          title: input.title,
          description: input.description,
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError((error) => todoError(error.message, error)));
      const linked = yield* todos.attachTicket(todo.id, created.ticket.id);
      return { todo: linked.todo, ticketId: created.ticket.id };
    });

    return { draft, create };
  }),
);
