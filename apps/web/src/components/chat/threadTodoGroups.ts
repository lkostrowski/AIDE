import type { ThreadTodo } from "@t3tools/contracts";

export interface ThreadTodoGroup {
  readonly name: string;
  readonly todos: ReadonlyArray<ThreadTodo>;
  readonly openCount: number;
}

const STATE_ORDER = { open: 0, done: 1, discarded: 2 } as const;

/**
 * Groups in the order they first appear and rows open-first within each, so neither
 * jumps while the user is reading. Closed work sinks instead of disappearing.
 */
export function groupThreadTodos(todos: ReadonlyArray<ThreadTodo>): ReadonlyArray<ThreadTodoGroup> {
  const byName = new Map<string, Array<ThreadTodo>>();
  for (const todo of todos) {
    const existing = byName.get(todo.group);
    if (existing === undefined) byName.set(todo.group, [todo]);
    else existing.push(todo);
  }
  return [...byName].map(([name, rows]) => ({
    name,
    todos: [...rows].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]),
    openCount: rows.filter((todo) => todo.state === "open").length,
  }));
}

export function openThreadTodoCount(todos: ReadonlyArray<ThreadTodo>): number {
  return todos.filter((todo) => todo.state === "open").length;
}

/**
 * Mirrors the server's resolution in `ThreadTodoTicketService`: a ticket already on
 * this thread wins, else the only initiative covering its project. Used to decide
 * whether to offer "create issue", never to pick the initiative itself.
 */
export function threadInitiativeExists(
  board: {
    readonly initiatives: ReadonlyArray<{ readonly projectIds: ReadonlyArray<string> }>;
    readonly tickets: ReadonlyArray<{ readonly threadIds: ReadonlyArray<string> }>;
  },
  threadId: string,
  projectId: string,
): boolean {
  if (board.tickets.some((ticket) => ticket.threadIds.includes(threadId))) return true;
  return (
    board.initiatives.filter((initiative) => initiative.projectIds.includes(projectId)).length === 1
  );
}
