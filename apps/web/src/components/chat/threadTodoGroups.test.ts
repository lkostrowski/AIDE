import { ThreadId, type ThreadTodo, ThreadTodoId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupThreadTodos, threadInitiativeExists } from "./threadTodoGroups";

const todo = ({
  id,
  ...input
}: Omit<Partial<ThreadTodo>, "id"> & { readonly id: string }): ThreadTodo => ({
  threadId: ThreadId.make("thread:1"),
  group: "Infra",
  text: "Ask infra about the quota",
  tags: [],
  state: "open",
  revision: 1,
  ticketId: null,
  createdBy: "agent",
  creationSource: "mcp",
  createdAt: "2026-11-09T10:00:00.000Z",
  updatedAt: "2026-11-09T10:00:00.000Z",
  ...input,
  id: ThreadTodoId.make(id),
});

describe("groupThreadTodos", () => {
  it("keeps groups in the order they first appear, so no row jumps while being read", () => {
    const groups = groupThreadTodos([
      todo({ id: "todo:1", group: "Infra" }),
      todo({ id: "todo:2", group: "Docs" }),
      todo({ id: "todo:3", group: "Infra" }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["Infra", "Docs"]);
    expect(groups[0]?.todos).toHaveLength(2);
  });

  it("sinks closed rows below open ones without dropping them", () => {
    const groups = groupThreadTodos([
      todo({ id: "todo:1", state: "discarded" }),
      todo({ id: "todo:2", state: "done" }),
      todo({ id: "todo:3", state: "open" }),
    ]);
    expect(groups[0]?.todos.map((row) => row.id)).toEqual(["todo:3", "todo:2", "todo:1"]);
  });

  it("counts only open rows, so a finished group reads as finished", () => {
    const groups = groupThreadTodos([
      todo({ id: "todo:1", state: "done" }),
      todo({ id: "todo:2", state: "open" }),
    ]);
    expect(groups[0]?.openCount).toBe(1);
  });
});

describe("threadInitiativeExists", () => {
  const initiative = (projectIds: ReadonlyArray<string>) => ({ projectIds });

  it("finds one through a ticket already on the thread", () => {
    expect(
      threadInitiativeExists(
        { initiatives: [], tickets: [{ threadIds: ["thread:1"] }] },
        "thread:1",
        "project:1",
      ),
    ).toBe(true);
  });

  it("finds the only initiative covering the project", () => {
    expect(
      threadInitiativeExists(
        { initiatives: [initiative(["project:1"]), initiative(["project:2"])], tickets: [] },
        "thread:1",
        "project:1",
      ),
    ).toBe(true);
  });

  it("stays undecided when two initiatives cover the project", () => {
    expect(
      threadInitiativeExists(
        { initiatives: [initiative(["project:1"]), initiative(["project:1"])], tickets: [] },
        "thread:1",
        "project:1",
      ),
    ).toBe(false);
  });

  it("stays undecided when none covers it", () => {
    expect(
      threadInitiativeExists(
        { initiatives: [initiative(["project:2"])], tickets: [] },
        "thread:1",
        "project:1",
      ),
    ).toBe(false);
  });
});
