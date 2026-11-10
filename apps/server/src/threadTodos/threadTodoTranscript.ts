import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Messages either side of the note, so the writer sees how it came up rather than the newest turn. */
const MESSAGES_BEFORE = 8;
const MESSAGES_AFTER = 2;
const MAX_EXCERPT_CHARS = 24_000;

/**
 * The slice of conversation around the moment a todo was written. Anchored on the
 * note's own timestamp: the discussion that produced it is usually long past by the
 * time anyone converts it.
 */
export function threadTodoTranscriptExcerpt(
  messages: ReadonlyArray<Pick<OrchestrationV2ConversationMessage, "role" | "text" | "createdAt">>,
  writtenAt: string,
): string {
  const ordered = [...messages].sort(
    (a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt),
  );
  const anchor = Date.parse(writtenAt);
  const anchorIndex = Number.isNaN(anchor)
    ? ordered.length
    : ordered.findIndex((message) => DateTime.toEpochMillis(message.createdAt) > anchor);
  const end = anchorIndex === -1 ? ordered.length : anchorIndex;
  const slice = ordered.slice(Math.max(0, end - MESSAGES_BEFORE), end + MESSAGES_AFTER);

  const rendered = slice
    .filter((message) => message.text.trim() !== "")
    .map((message) => `${message.role}: ${message.text.trim()}`)
    .join("\n\n");
  // Trimmed from the front, so the messages nearest the note survive.
  return rendered.length <= MAX_EXCERPT_CHARS ? rendered : rendered.slice(-MAX_EXCERPT_CHARS);
}
