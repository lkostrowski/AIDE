import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type ThreadTodo, ThreadTodoId } from "@t3tools/contracts";

import { buildThreadTodoContext, threadTodoWatermark } from "./threadTodoContext.ts";

const todo = ({
  id,
  ...input
}: Omit<Partial<ThreadTodo>, "id"> & { readonly id: string }): ThreadTodo => ({
  threadId: ThreadId.make("thread:1"),
  group: "Infra",
  text: "Ask infra about the quota",
  tags: [],
  state: "open",
  ticketId: null,
  createdBy: "agent",
  creationSource: "mcp",
  createdAt: "2026-11-09T10:00:00.000Z",
  updatedAt: "2026-11-09T10:00:00.000Z",
  revision: 1,
  ...input,
  id: ThreadTodoId.make(id),
});

describe("buildThreadTodoContext", () => {
  it("is empty without todos, so a thread that never grows one pays nothing", () => {
    expect(buildThreadTodoContext([], { deliveredThrough: null })).toBe("");
  });

  it("groups open rows and marks who wrote each one", () => {
    const block = buildThreadTodoContext(
      [
        todo({ id: "todo:1" }),
        todo({ id: "todo:2", group: "Docs", text: "Update the setup page" }),
        todo({ id: "todo:3", group: "Yours", text: "Pick a name", createdBy: "user" }),
      ],
      { deliveredThrough: null },
    );
    expect(block).toContain("## Infra");
    expect(block).toContain("## Docs");
    expect(block).toContain("- todo:3 | Pick a name (written by the user)");
  });

  it("renders tags", () => {
    expect(
      buildThreadTodoContext([todo({ id: "todo:1", tags: ["you", "infra"] })], {
        deliveredThrough: null,
      }),
    ).toContain("[you, infra]");
  });

  it("carries a closure the agent has not seen, so it can object to one", () => {
    const block = buildThreadTodoContext(
      [todo({ id: "todo:1", state: "discarded", revision: 7 })],
      { deliveredThrough: 6 },
    );
    expect(block).toContain("- todo:1 | Ask infra about the quota (discarded)");
  });

  it("leaves out a closure already delivered, so the list is not re-sent unchanged", () => {
    expect(
      buildThreadTodoContext([todo({ id: "todo:1", state: "done", revision: 6 })], {
        deliveredThrough: 6,
      }),
    ).toBe("");
  });

  it("keeps an open row even once it has been delivered", () => {
    expect(
      buildThreadTodoContext([todo({ id: "todo:1", revision: 1 })], { deliveredThrough: 99 }),
    ).toContain("- todo:1 |");
  });

  it("caps the block and says how many open rows it left out", () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      todo({ id: `todo:${String(index)}`, text: `Item ${String(index)}` }),
    );
    const block = buildThreadTodoContext(many, { deliveredThrough: null });
    expect(block).toContain("(5 more open todos not shown)");
    expect(block).not.toContain("Item 44");
  });
});

describe("threadTodoWatermark", () => {
  it("is the newest edit, so a later change re-opens the gate", () => {
    expect(
      threadTodoWatermark([
        todo({ id: "todo:1", revision: 3 }),
        todo({ id: "todo:2", revision: 9 }),
      ]),
    ).toBe(9);
  });

  it("is null without todos", () => {
    expect(threadTodoWatermark([])).toBeNull();
  });
});
