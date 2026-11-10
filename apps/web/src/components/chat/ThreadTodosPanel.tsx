import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  ThreadTodo,
  ThreadTodoState,
} from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  TicketIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadTodoTicketDialog } from "./ThreadTodoTicketDialog";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";
import { groupThreadTodos, openThreadTodoCount, threadInitiativeExists } from "./threadTodoGroups";

export type ThreadTodosDensity = "full" | "compact" | "essential";

function TodoRow({
  todo,
  canOperate,
  canFileIssue,
  onSetState,
  onCreateIssue,
}: {
  readonly todo: ThreadTodo;
  readonly canOperate: boolean;
  readonly canFileIssue: boolean;
  readonly onSetState: (state: ThreadTodoState) => void;
  readonly onCreateIssue: () => void;
}) {
  const closed = todo.state !== "open";
  return (
    <li className="group/todo flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-1 hover:bg-black/[0.035] dark:hover:bg-white/[0.08]">
      <Checkbox
        className="mt-0.5 shrink-0"
        checked={todo.state === "done"}
        disabled={!canOperate}
        aria-label={todo.text}
        onCheckedChange={(checked) => onSetState(checked === true ? "done" : "open")}
      />
      <div className="min-w-0 flex-1">
        {/* Wraps rather than truncates: a cut-off todo reads as a different task. */}
        <p
          className={cn(
            "break-words text-sm text-foreground/80",
            closed && "text-muted-foreground line-through",
          )}
        >
          {todo.text}
        </p>
        {todo.tags.length > 0 || todo.ticketId !== null ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {todo.ticketId === null ? null : (
              <span className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground">
                <TicketIcon aria-hidden className="size-3" />
                Issue
              </span>
            )}
            {todo.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border/65 px-1 text-2xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="opacity-0 group-hover/todo:opacity-100 has-[[data-popup-open]]:opacity-100">
        <Menu>
          <MenuTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label={`Actions for ${todo.text}`}
                disabled={!canOperate}
              />
            }
          >
            <MoreHorizontalIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-52 max-w-(--available-width)">
            {todo.state === "open" ? (
              <>
                <MenuItem onClick={() => onSetState("done")}>
                  <CheckIcon className="size-3.5" />
                  Mark done
                </MenuItem>
                <MenuItem onClick={() => onSetState("discarded")}>
                  <XIcon className="size-3.5" />
                  Discard
                </MenuItem>
              </>
            ) : (
              <MenuItem onClick={() => onSetState("open")}>
                <Undo2Icon className="size-3.5" />
                Reopen
              </MenuItem>
            )}
            {todo.ticketId === null ? (
              <MenuItem disabled={!canFileIssue} onClick={onCreateIssue}>
                <TicketIcon className="size-3.5" />
                {canFileIssue ? "Create issue…" : "Create issue (no initiative)"}
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
    </li>
  );
}

function TodoGroup({
  name,
  todos,
  openCount,
  canOperate,
  canFileIssue,
  onSetState,
  onCreateIssue,
}: {
  readonly name: string;
  readonly todos: ReadonlyArray<ThreadTodo>;
  readonly openCount: number;
  readonly canOperate: boolean;
  readonly canFileIssue: boolean;
  readonly onSetState: (todo: ThreadTodo, state: ThreadTodoState) => void;
  readonly onCreateIssue: (todo: ThreadTodo) => void;
}) {
  // A group with nothing left open starts closed: it stops taking space without hiding.
  const [expanded, setExpanded] = useState(openCount > 0);
  return (
    <div>
      <ThreadDetailsControl aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ListTodoIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className={cn(THREAD_DETAILS_PANEL_LABEL_CLASS, "min-w-0 flex-1 truncate")}>
          {name}
        </span>
        <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
          {openCount > 0 ? openCount : todos.length}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            THREAD_DETAILS_PANEL_CHEVRON_CLASS,
            "transition-transform",
            !expanded && "-rotate-90",
          )}
        />
      </ThreadDetailsControl>
      {expanded ? (
        <ul className="flex flex-col">
          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              canOperate={canOperate}
              canFileIssue={canFileIssue}
              onSetState={(state) => onSetState(todo, state)}
              onCreateIssue={() => onCreateIssue(todo)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Dumb on purpose: every mutation is a callback, so the panel owns all the wiring. */
function ThreadTodosList({
  todos,
  density,
  canOperate,
  canFileIssue,
  onAdd,
  onSetState,
  onCreateIssue,
}: {
  readonly todos: ReadonlyArray<ThreadTodo>;
  readonly density: ThreadTodosDensity;
  readonly canOperate: boolean;
  readonly canFileIssue: boolean;
  readonly onAdd: (text: string) => void;
  readonly onSetState: (todo: ThreadTodo, state: ThreadTodoState) => void;
  readonly onCreateIssue: (todo: ThreadTodo) => void;
}) {
  const [draft, setDraft] = useState("");
  const openCount = openThreadTodoCount(todos);
  const groups = groupThreadTodos(todos);

  const submit = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    onAdd(text);
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-todos-heading"
      title={openCount > 0 ? `Todos \u00b7 ${String(openCount)} open` : "Todos"}
      data-thread-todos-panel
    >
      <div className="flex flex-col">
        {density === "essential" ? (
          <div className="flex h-8 items-center gap-2.5 px-2.5 text-sm text-foreground/80">
            <ListTodoIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className="min-w-0 flex-1 truncate">
              {openCount > 0 ? `${String(openCount)} open` : "None open"}
            </span>
          </div>
        ) : (
          groups.map((group) => (
            <TodoGroup
              key={group.name}
              {...group}
              // At compact density the group rows stay, their contents do not.
              {...(density === "compact" ? { todos: [] } : {})}
              canOperate={canOperate}
              canFileIssue={canFileIssue}
              onSetState={onSetState}
              onCreateIssue={onCreateIssue}
            />
          ))
        )}
        {density === "full" && canOperate ? (
          <div className="px-2.5 pt-1">
            <Input
              value={draft}
              placeholder="Add a todo"
              aria-label="Add a todo"
              className="h-8"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
                if (event.key === "Escape") setDraft("");
              }}
            />
          </div>
        ) : null}
        {todos.length === 0 && density === "full" ? (
          <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground">
            <CircleDashedIcon aria-hidden className="size-3.5" />
            Open topics the agent raises land here.
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

export function ThreadTodosPanel({
  environmentId,
  threadId,
  projectId,
  density,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly density: ThreadTodosDensity;
}) {
  const query = useAtomValue(
    serverEnvironment.threadTodosLive({ environmentId, input: { threadId } }),
  );
  const board = AsyncResult.getOrElse(
    useAtomValue(serverEnvironment.workTrackingBoardLive({ environmentId, input: {} })),
    () => null,
  );
  const canOperate = useAtomValue(serverEnvironment.addThreadTodo.permissionAtom(environmentId));
  const add = useAtomCommand(serverEnvironment.addThreadTodo, { label: "todo add" });
  const setState = useAtomCommand(serverEnvironment.setThreadTodoState, { label: "todo state" });
  const [issueFor, setIssueFor] = useState<ThreadTodo | null>(null);

  const todos = AsyncResult.getOrElse(query, () => null)?.todos ?? [];
  if (todos.length === 0 && !canOperate) return null;

  return (
    <>
      <ThreadTodosList
        todos={todos}
        density={density}
        canOperate={canOperate}
        canFileIssue={board !== null && threadInitiativeExists(board, threadId, projectId)}
        onAdd={(text) => void add({ environmentId, input: { threadId, text } })}
        onSetState={(todo, state) =>
          void setState({ environmentId, input: { id: todo.id, state } })
        }
        onCreateIssue={setIssueFor}
      />
      {issueFor === null ? null : (
        <ThreadTodoTicketDialog
          environmentId={environmentId}
          todo={issueFor}
          onClose={() => setIssueFor(null)}
        />
      )}
    </>
  );
}
