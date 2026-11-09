# Work tracking

This fork adds one thing T3 Code does not have: a layer above the thread that tracks _what
is being attempted_ rather than _where the code is_. T3's `Project` is a directory; its
`Thread` is a conversation in that directory. Neither can express "ship custom taxes
across core, dashboard and docs, blocked on finance" — a unit of work that spans
checkouts, carries a status, and outlives any one conversation.

That layer is the whole of the fork's intent. Everything else it was designed around —
durable store, event log, projections, external agent adapters, an app-owned MCP endpoint,
remote clients — T3 Code already has, usually in a better-reasoned form. This page records
which of the fork's original decisions survive contact with T3, what the colliding
vocabulary resolves to, and where the new entities attach.

## What the fork's design document already got for free

The fork began as a from-scratch app on `pi-durable`. Twelve of its decisions have a T3
counterpart:

| Fork decision                                     | Fate on T3 Code                                                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-first, single-user, loopback only           | **Dropped.** T3 is remote-ready with authenticated RPC, multi-client and multi-environment. A single-user assumption would be a regression.                                                                            |
| `pi-durable` as store, scheduler and transcript   | **Dropped.** T3 is event-sourced over its own SQLite with projections committed in the event transaction. `pi` survives as a _provider_.                                                                               |
| External agents are first-class                   | **Already true.** Seven providers behind adapters.                                                                                                                                                                     |
| Structured adapters only (duplex JSONL)           | **Already true**, and finer-grained: driver, provider instance, adapter, session.                                                                                                                                      |
| One SQLite per project                            | **Dropped.** One `statev2.sqlite` per environment. Per-project stores would break cross-project reads the PR links already rely on.                                                                                    |
| Worktrees owned by the PM layer, never shared     | **Rewritten.** See [Worktree ownership](#worktree-ownership).                                                                                                                                                          |
| A work item owns 0..N worktrees                   | **Rewritten.** Same section.                                                                                                                                                                                           |
| Store raw adapter events, normalize on read       | **Inverted.** T3 stores the normalized event as canonical and treats raw provider frames as bounded rotating diagnostics. Its reasoning is better: the fork's version was an argument from having exactly one adapter. |
| The server projects an app-shaped view            | **Already true.** `packages/contracts` is that boundary.                                                                                                                                                               |
| Global repo registry; the PM layer links to repos | **Narrowed.** The project list is environment-local, not global. Linking still applies.                                                                                                                                |
| The app exposes its own tools over MCP            | **Already true and better.** `/mcp` with per-provider-session scoped credentials, capability checks, and injection per provider.                                                                                       |
| A shared context directory, attachments copied in | **Dissolved.** See [Vocabulary](#vocabulary).                                                                                                                                                                          |

What is left over is five concepts. That is the fork.

## Vocabulary

T3's glossary owns the words that collide, and it owns them for good reasons, so the fork
renames rather than redefines. Redefining `Project` would make every existing doc, type
and settings path lie.

| Fork term                  | Here                                             | Why                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                       | **Project**                                      | T3's `Project` _is_ this: a `workspaceRoot`, a `repositoryIdentity`, defaults and scripts. Adopt it rather than fork a mature entity to rename it.                                                                                                                                                 |
| Clone                      | _(dropped)_                                      | `workspaceRoot` is the checkout. The fork's "a copy the app keeps" was never implemented as a copy.                                                                                                                                                                                                |
| Project (goal)             | **Initiative**                                   | `Project` is taken. `Initiative` is unused anywhere in the codebase, and `InitiativeId` reads unambiguously beside `ProjectId`. Not _Goal_: `OrchestrationV2ProviderGoal` is a thread's own objective, with a sidebar badge that renders the word.                                                 |
| Issue                      | **Ticket**                                       | Unused: three hits, all test fixtures. `Issue` was free as a domain term too, but _issue_ already means "a validation defect" here — Effect's `SchemaIssue`, T3's `ServerConfigIssue` — and "the ticket has three issues" stays sayable without ambiguity.                                         |
| Board                      | **Board**                                        | Unused.                                                                                                                                                                                                                                                                                            |
| Status, blocked reason     | unchanged                                        | Unused. `Run.status` and `Thread.status` are scoped by their entity names.                                                                                                                                                                                                                         |
| Worktree                   | **Worktree**                                     | Same meaning as T3's. Only the ownership changes.                                                                                                                                                                                                                                                  |
| Thread, Turn               | T3's                                             | Same meaning; T3's is richer (run, attempt, execution node).                                                                                                                                                                                                                                       |
| Handoff                    | **Context handoff**                              | T3's `ContextTransfer` + `ContextHandoff` are a strict superset.                                                                                                                                                                                                                                   |
| Transcript, Entry          | **turn items**, **activities**                   | Already built, already projected in display order.                                                                                                                                                                                                                                                 |
| Summary                    | thread title, status projection, settlement      | Mostly already built and server-owned. The fork's "derived mechanically, never claimed by a model" rule still applies to anything added.                                                                                                                                                           |
| Agent, Adapter             | **agent**, **provider**, **driver**, **adapter** | T3 splits what the fork called one thing. Use its split.                                                                                                                                                                                                                                           |
| Artifact                   | **Artifact**                                     | Unused. The durable output of a thread that belongs to the Initiative.                                                                                                                                                                                                                             |
| Context (shared directory) | _(dropped as a term)_                            | `context` is already triple-booked: composer context records and references, `ContextTransfer`, `ContextHandoff`. The directory needs no noun — it is the Initiative's directory, `initiativeRoot`, parallel to `workspaceRoot`. Artifact is the concept; the folder is just where Artifacts land. |
| Attachment                 | T3's **attachment**                              | T3 already has server-owned attachments with durable bindings and an inventory. A Ticket referencing those needs no second attachment concept and no copy-on-file logic.                                                                                                                           |

Renaming a T3 entity was considered for both and rejected for both. This is a fork that
wants to keep pulling upstream, so every word taken from upstream's vocabulary is a
permanent merge cost and a comprehension tax when reading their code. Route around
instead.

One ban from the fork's glossary is lifted: it listed _Initiative_ as a word to avoid,
purely to protect _Project_. `Project` is no longer the fork's to protect.

The fork's bans on _Task_ and _Run_ still hold, and T3 gives each a second reason:
`ScheduledTask` is recurring work with its own shipped settings surface on web and mobile,
and `Run` is a counted turn.

## The five new concepts

- **Initiative** — a goal that spans one or more Projects. Not a directory. Owns Tickets and
  Artifacts, and has a directory of its own for them.
- **Ticket** — the unit of work. Carries status, blocked reason, description and review
  links. Owns the Threads doing the work. Status is the Ticket's own property, so a change
  spanning three Projects is blocked once rather than three times.
- **Board** — an Initiative's view of its Tickets.
- **Status** — where a Ticket stands. `todo | doing | blocked | review | done` is a default,
  not a decision.
- **Artifact** — something a Thread produced for the Initiative rather than for its own
  transcript: a plan, a research note, a report. Survives the Thread that wrote it. Not
  code, which lives in a worktree, and not conversation, which lives in turn items.

## Worktree ownership

This is the one place T3's model and the fork's disagree structurally.

The fork had a work item own 0..N worktrees and gave a single thread access to all of them, so
one agent could change `core` and `dashboard` in one conversation. T3 attaches at most one
worktree to a thread (`AppThread.worktreePath`, `t3_worktree_handoff`), and a thread belongs
to exactly one Project.

**Resolved in T3's favour: a Ticket owns 0..N Threads, each in one Project with its own
worktree.** The cross-repo change is then one Ticket with one Thread per Project. It is
blocked once, reviewed as one unit, and shown as one card — which was the point — without
touching the thread-to-worktree relation, the checkpoint scopes that hang off it, or the
provider `cwd`. The fork's own multi-grant mechanism existed only to work around having no
layer above the thread; the layer makes it unnecessary.

The cost is real: no single agent sees both checkouts at once, so cross-repo work
coordinates at the Ticket layer and through context handoffs instead of inside one context
window. Accept it until a concrete task proves it insufficient. The falsifying condition is
a change where the two repos must be edited in lockstep against each other's uncommitted
state; a contract and its consumer would qualify.

## Where it attaches

Following the patterns already in the repo rather than inventing a shape:

- **Contracts first.** `InitiativeId`, `TicketId` and `ArtifactId` in
  `packages/contracts/src/baseSchemas.ts`; entities and RPC payloads in `workTracking.ts`. One
  file, because the three entities are never used apart. Anything crossing the wire is typed
  here, and server, web, mobile and desktop follow.
- **Initiative is plain state, like Project.** A title, linked project ids, a directory. A
  service and its own tables. `ScheduledTaskService` is the template: a `Context.Service`
  with migrations of its own, not an orchestration stream.
- **Ticket status arrives by reactor**, not by orchestration command. See
  [Where Ticket state lives](#where-ticket-state-lives).
- **A service, not handler code.** `WorkTrackingService` owns lookup, listing and transitions for
  all three entities. WebSocket RPC and MCP each decode input, call one method, and map errors.
- **Guarded mutations.** Client mutations go through `createEnvironmentRpcCommand`, with the
  mutating methods added to `CLIENT_GUARDED_RPC_SCOPES`.
- **MCP tools in their own toolkit**, named `t3_ticket_write`, `t3_ticket_list` and so on. Create
  and update are one tool each, because two would double what the model carries for one concept. The fork's own rule holds and T3 already enforces it
  from the other direction: a capability a user can trigger is one an agent should reach
  through MCP, and that only works when it is a service method. `createdBy: "user" |
  "agent" | "system"` and `creationSource` already exist, so "who filed this" needs no new
  field.
- **Every surface.** Web, mobile, and the command palette and keybindings on each. A Ticket
  that can only be filed from one route is not a filed Ticket. Mobile is not built yet; see
  [Open decisions](#open-decisions).

## Where Ticket state lives

Tickets are their own service and tables, outside orchestration. A reactor subscribes to
committed V2 events behind a durable cursor and applies them idempotently.

The choice was not really "event-sourced or not". It was how much of the fork's code sits
in the files upstream rewrites most. Over the last 300 upstream commits:

| File                      |  Lines | Commits touching it |
| ------------------------- | -----: | ------------------: |
| `Orchestrator.ts`         | 14,607 |                 164 |
| `ProjectionStore.ts`      |  7,530 |                 116 |
| `ScheduledTaskService.ts` |  2,520 |                  39 |

Ticket commands and events inside orchestration would mean editing the two files upstream
touches in 55% and 39% of its commits, in a 14,000-line switch. For a fork that keeps
pulling, that cost dominates the line count.

What the fork's founding claim needs is not one transaction. It is that the board can never
silently disagree with the threads, which an idempotent apply gives just as well — the board
lags the thread by a tick rather than moving with it.

`TicketStatusReactor` is that reactor: a `Context.Service` whose `start` sweeps and then
subscribes, the shape `PullRequestSyncReactor` and `ThreadSettlementService` already use. It
reads `EventSinkV2.stream({ afterSequence, bounded: false })`, whose own comment reserves the
unbounded form for internal workers that must not drop their subscription under load.

One rule the implementation has to hold:

**Every transition is a function of current thread state, not a delta.** Applying it twice has
to be a no-op. The reactor holds exactly one: a Ticket whose Thread has started a run is no
longer `todo`.

That rule is also why there is no cursor. The event log is pruned to about a day
(`ProjectionMaintenance`), so recovery has to come from the thread projections regardless — and
a sweep that re-derives every `todo` Ticket from its Threads is a complete recovery by itself.
The reactor sweeps at startup, reads `latestSequence`, and streams from there. The cursor row
beside `thread-projections` in `orchestration_v2_projection_metadata` is where a cursor would
go if a rule ever needed one, which is also the signal that the rule has become
history-dependent and belongs in orchestration instead.

The single transaction earns its cost only for a transition that must be atomically
_rejected_ against live thread state, the way `thread.auto-settle` rejects newer activity,
explicit overrides, and live or blocked work. If a guard like "cannot mark done while a run
is live" has to be airtight rather than optimistic, move that one command into
orchestration. Not the entity.

## Open decisions

- **Settled: an Initiative is environment-local**, like a Project. PR links already cross
  projects within an environment and explicitly stop there, and the MCP tools take no
  `environmentId` for the same reason. A linked environment is refused outright rather than
  silently writing into the wrong board.
- Mobile has no board yet, so a Ticket filed on web is invisible there. The contracts and
  service are surface-agnostic; what is missing is the React Native screen.
- The web board shows the primary environment only. With several connected environments the
  rest of the work is unreachable, which the per-environment sections in Scheduled tasks
  already solve and the board does not copy yet.
- Whether Ticket replaces the "track it in the GitHub issue" rule in `AGENTS.md`, and what
  happens to that rule's ban on committing working material.
- Whether the fork's `docs/adr/` convention survives beside `docs/internals/`, or its
  decisions move into these pages.
