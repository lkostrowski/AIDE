import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type ProjectId,
  type TicketStartInput,
  type TicketStartResult,
  WorkTrackingError,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WorkTracking from "./WorkTrackingService.ts";

/**
 * Starting a Ticket is the one place work tracking reaches into orchestration:
 * it launches a Thread in its own worktree and binds it to the Ticket.
 */
export class TicketLaunchService extends Context.Service<
  TicketLaunchService,
  {
    readonly startTicket: (
      input: TicketStartInput,
    ) => Effect.Effect<TicketStartResult, WorkTrackingError>;
  }
>()("t3/workTracking/TicketLaunchService") {}

function launchError(message: string, cause?: unknown) {
  return new WorkTrackingError({ message, ...(cause === undefined ? {} : { cause }) });
}

/** Git refuses many characters in a branch name, and a Ticket title accepts all of them. */
export function ticketBranchName(title: string, ticketId: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .slice(0, 40)
    // After the cut, not before: a slice can end mid-separator.
    .replaceAll(/^-+|-+$/gu, "");
  const suffix = ticketId.split(":").at(-1)?.slice(0, 8) ?? "ticket";
  return `ticket/${slug === "" ? "work" : slug}-${suffix}`;
}

export function ticketPrompt(input: {
  readonly title: string;
  readonly description: string;
}): string {
  return input.description.trim() === ""
    ? input.title
    : `${input.title}\n\n${input.description.trim()}`;
}

export const layer = Layer.effect(
  TicketLaunchService,
  Effect.gen(function* () {
    const work = yield* WorkTracking.WorkTrackingService;
    const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
    const projects = yield* ProjectService.ProjectService;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
    const git = yield* GitVcsDriver.GitVcsDriver;

    /** The project's default branch on its remote, so a new worktree starts from pushed work. */
    const resolveBase = Effect.fn("TicketLaunchService.resolveBase")(function* (
      workspaceRoot: string,
    ) {
      const remote = yield* git
        .resolvePrimaryRemoteName(workspaceRoot)
        .pipe(Effect.orElseSucceed(() => null));
      const branch =
        remote === null
          ? null
          : yield* git
              .resolveDefaultBranchName(workspaceRoot, remote)
              .pipe(Effect.orElseSucceed(() => null));
      if (remote !== null && branch !== null) {
        return { baseRef: `${remote}/${branch}`, startFromOrigin: true };
      }
      const local = yield* git
        .statusDetails(workspaceRoot)
        .pipe(Effect.map((status) => status.branch));
      return { baseRef: local ?? "HEAD", startFromOrigin: false };
    });

    const startTicket = Effect.fn("TicketLaunchService.startTicket")(function* (
      input: TicketStartInput,
    ) {
      const listed = yield* work.listTickets({});
      const ticket = listed.tickets.find((entry) => entry.id === input.ticketId);
      if (ticket === undefined) {
        return yield* launchError("That ticket no longer exists.");
      }
      const initiatives = yield* work.listInitiatives();
      const initiative = initiatives.initiatives.find((entry) => entry.id === ticket.initiativeId);
      if (initiative === undefined) {
        return yield* launchError("That ticket's initiative no longer exists.");
      }
      const projectId: ProjectId | undefined =
        input.projectId ??
        (initiative.projectIds.length === 1 ? initiative.projectIds[0] : undefined);
      if (projectId === undefined) {
        return yield* launchError(
          initiative.projectIds.length === 0
            ? "Pass the projectId to start in; the initiative has no project yet."
            : "The initiative spans several projects; pass the projectId to start in.",
        );
      }
      if (initiative.projectIds.length > 0 && !initiative.projectIds.includes(projectId)) {
        return yield* launchError("That project is not one of the initiative's.");
      }
      // Starting in the first project an Initiative sees adopts it, so the board
      // does not need a separate step before any work can begin.
      if (initiative.projectIds.length === 0) {
        yield* work.upsertInitiative({ id: initiative.id, projectIds: [projectId] });
      }
      const project = yield* projects.getById(projectId).pipe(
        Effect.mapError((cause) => launchError("Could not read the project.", cause)),
        Effect.map(Option.getOrUndefined),
      );
      if (project === undefined) return yield* launchError("The project was not found.");

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) => launchError("Could not read server settings.", cause)),
      );
      const resolved = resolveProjectSettings(settings, projectId, project).settings;
      const modelSelection = resolveNewThreadModelSelection({
        defaultSelection: resolved.defaultModelSelection,
        fallbackSelection: resolved.fallbackModelSelection,
        providers: yield* providerRegistry.getProviders,
        settings: resolved,
        projectId,
        now: DateTime.toEpochMillis(yield* DateTime.now),
      }).selection;
      if (modelSelection === null) {
        return yield* launchError(
          "That project has no default model. Pick one in its settings first.",
        );
      }

      const base = yield* resolveBase(project.workspaceRoot).pipe(
        Effect.mapError((cause) => launchError("Could not read the project's branches.", cause)),
      );
      // One Ticket can have several Threads, so each start is its own command.
      const fireKey = `${ticket.id}:${ticket.threadIds.length}`;
      const launched = yield* threadLaunch
        .launch({
          commandId: CommandId.make(`ticket-start:${fireKey}`),
          projectId,
          title: ticket.title,
          modelSelection,
          runtimeMode: resolved.defaultRuntimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          workspaceStrategy: {
            type: "worktree",
            baseRef: base.baseRef,
            branch: ticketBranchName(ticket.title, ticket.id),
            ...(base.startFromOrigin ? { startFromOrigin: true } : {}),
          },
          initialMessage: {
            messageId: MessageId.make(`ticket-start-message:${fireKey}`),
            text: input.prompt ?? ticketPrompt(ticket),
            attachments: [],
          },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError((cause) => launchError("Could not start the thread.", cause)));

      yield* work.linkTicketThread({ ticketId: ticket.id, threadId: launched.threadId });
      // The launch's run.created reached the reactor before this link existed, so
      // re-derive here rather than leave the card behind until the next sweep.
      yield* work.advanceTicketsForStartedThread(launched.threadId);
      const started = yield* work.listTickets({});
      const current = started.tickets.find((entry) => entry.id === ticket.id) ?? ticket;
      return { ticket: current, threadId: launched.threadId, projectId };
    });

    return { startTicket } satisfies TicketLaunchService["Service"];
  }),
);
