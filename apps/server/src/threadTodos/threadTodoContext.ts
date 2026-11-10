import { MAX_INJECTED_THREAD_TODOS, type ThreadTodo } from "@t3tools/contracts";

export interface ThreadTodoContextInput {
  /** The newest revision already delivered to this thread's agent, or null for all of it. */
  readonly deliveredThrough: number | null;
}

/**
 * The rows an agent sees at the start of a turn: everything still open, plus the
 * ones closed since it last looked, so a dismissal it wants to argue about arrives
 * exactly once.
 */
function selectInjectedThreadTodos(
  todos: ReadonlyArray<ThreadTodo>,
  input: ThreadTodoContextInput,
): ReadonlyArray<ThreadTodo> {
  const open: Array<ThreadTodo> = [];
  const closed: Array<ThreadTodo> = [];
  for (const todo of todos) {
    if (todo.state === "open") open.push(todo);
    else if (input.deliveredThrough === null || todo.revision > input.deliveredThrough)
      closed.push(todo);
  }
  // Open rows never lose their slot: a dropped one would look settled to the agent.
  return [...open, ...closed].slice(0, MAX_INJECTED_THREAD_TODOS);
}

function renderRow(todo: ThreadTodo): string {
  const tags = todo.tags.length === 0 ? "" : ` [${todo.tags.join(", ")}]`;
  const state = todo.state === "open" ? "" : ` (${todo.state})`;
  const author = todo.createdBy === "user" ? " (written by the user)" : "";
  return `- ${todo.id} | ${todo.text}${tags}${state}${author}`;
}

/**
 * The per-turn block. Empty when the thread has no todos, so a thread that never
 * grows one never pays for the feature.
 */
export function buildThreadTodoContext(
  todos: ReadonlyArray<ThreadTodo>,
  input: ThreadTodoContextInput,
): string {
  const selected = selectInjectedThreadTodos(todos, input);
  if (selected.length === 0) return "";

  const byGroup = new Map<string, Array<ThreadTodo>>();
  for (const todo of selected) {
    const existing = byGroup.get(todo.group);
    if (existing === undefined) byGroup.set(todo.group, [todo]);
    else existing.push(todo);
  }

  const lines: Array<string> = ["<thread_todos>"];
  for (const [group, rows] of byGroup) {
    lines.push(`## ${group}`, ...rows.map(renderRow));
  }
  const omitted = todos.filter((todo) => todo.state === "open").length - selected.length;
  if (omitted > 0) lines.push(`(${String(omitted)} more open todos not shown)`);
  lines.push(
    "Update these with t3_todo_write, reusing a group name above and passing the id of a row you change.",
    "You may close or discard a row. You cannot reopen one: say so in your reply and let the user decide.",
    "</thread_todos>",
  );
  return lines.join("\n");
}

/** The watermark to remember once a block is delivered. */
export function threadTodoWatermark(todos: ReadonlyArray<ThreadTodo>): number | null {
  let newest: number | null = null;
  for (const todo of todos) if (newest === null || todo.revision > newest) newest = todo.revision;
  return newest;
}
