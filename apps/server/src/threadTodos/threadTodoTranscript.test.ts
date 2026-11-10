import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { threadTodoTranscriptExcerpt } from "./threadTodoTranscript.ts";

type Message = Parameters<typeof threadTodoTranscriptExcerpt>[0][number];

const message = (role: "user" | "assistant", text: string, at: string): Message => ({
  role,
  text,
  createdAt: DateTime.makeUnsafe(at),
});

describe("threadTodoTranscriptExcerpt", () => {
  it("takes the discussion around the note, not the newest turn", () => {
    const messages = [
      message("user", "Add rate limiting", "2026-11-09T10:00:00.000Z"),
      message("assistant", "Quota is the infra team's call", "2026-11-09T10:01:00.000Z"),
      ...Array.from({ length: 20 }, (_, index) =>
        message(
          "user",
          `Unrelated ${String(index)}`,
          `2026-11-09T12:${String(index).padStart(2, "0")}:00.000Z`,
        ),
      ),
    ];
    const excerpt = threadTodoTranscriptExcerpt(messages, "2026-11-09T10:02:00.000Z");
    expect(excerpt).toContain("Quota is the infra team's call");
    expect(excerpt).not.toContain("Unrelated 19");
  });

  it("orders by time even when the records arrive out of order", () => {
    const excerpt = threadTodoTranscriptExcerpt(
      [
        message("assistant", "Second", "2026-11-09T10:01:00.000Z"),
        message("user", "First", "2026-11-09T10:00:00.000Z"),
      ],
      "2026-11-09T10:05:00.000Z",
    );
    expect(excerpt.indexOf("First")).toBeLessThan(excerpt.indexOf("Second"));
  });

  it("labels each line with its role, so the writer can tell who said what", () => {
    expect(
      threadTodoTranscriptExcerpt(
        [message("user", "Add rate limiting", "2026-11-09T10:00:00.000Z")],
        "2026-11-09T10:05:00.000Z",
      ),
    ).toBe("user: Add rate limiting");
  });

  it("drops empty messages rather than emitting bare role labels", () => {
    expect(
      threadTodoTranscriptExcerpt(
        [
          message("user", "   ", "2026-11-09T10:00:00.000Z"),
          message("assistant", "Done", "2026-11-09T10:01:00.000Z"),
        ],
        "2026-11-09T10:05:00.000Z",
      ),
    ).toBe("assistant: Done");
  });

  it("falls back to the tail when the note's timestamp is unreadable", () => {
    expect(
      threadTodoTranscriptExcerpt(
        [message("user", "Only message", "2026-11-09T10:00:00.000Z")],
        "not a date",
      ),
    ).toContain("Only message");
  });
});
