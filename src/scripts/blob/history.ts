// Client half of the chat request contract (SCOPE §6.1). Framework-free, no runtime imports:
// the server's input module must never be bundled into the island (CLAUDE.md rule 3).
// Mirrors src/lib/server/input.ts; a unit test keeps the limits and rules in lockstep.

export type Turn = { role: "user" | "assistant"; content: string };

export const CLIENT_LIMITS = {
  maxTurns: 10,
  maxUserChars: 500,
  maxAssistantChars: 1500,
  maxBodyBytes: 8192,
} as const;

/** A fresh per-page session id; matches /^[A-Za-z0-9_-]{8,64}$/. */
export function newSessionId(): string {
  return crypto.randomUUID();
}

// Same character classes the server rejects. Lone surrogates become U+FFFD; the remaining
// forbidden controls (C0 except \t and \n, plus DEL) are dropped. Line breaks become \n.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Cleans and caps one turn so the server accepts it; null when nothing is left. */
function cleanContent(raw: string, maxChars: number): string | null {
  let text = raw
    .replace(LONE_SURROGATE, "�")
    .replace(/\r\n?/g, "\n")
    .replace(FORBIDDEN_CONTROLS, "")
    .normalize("NFC")
    .trim();
  // Count code points like the server. Re-normalize after a cut and repeat until stable.
  for (;;) {
    const points = [...text];
    if (points.length <= maxChars) break;
    text = points.slice(0, maxChars).join("").normalize("NFC").trim();
  }
  return text === "" ? null : text;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).byteLength;

/**
 * Builds the `POST /api/chat` body from the in-memory conversation.
 * Keeps the newest valid alternating run that starts and ends with a user turn (at most
 * `maxTurns`, so 9 in practice), then drops the oldest pairs until the body fits.
 * Returns null when the last turn is not a user turn of 1..500 chars after trimming.
 */
export function buildRequest(
  history: readonly Turn[],
  sessionId: string,
): { body: string; turns: Turn[] } | null {
  const last = history[history.length - 1];
  if (last === undefined || last.role !== "user") return null;
  const lastText = last.content.trim();
  if (lastText === "" || [...lastText].length > CLIENT_LIMITS.maxUserChars) {
    return null;
  }
  const lastClean = cleanContent(lastText, CLIENT_LIMITS.maxUserChars);
  if (lastClean === null) return null;

  // Walk back from the newest turn while roles alternate and content survives cleaning.
  const newestFirst: Turn[] = [{ role: "user", content: lastClean }];
  for (let i = history.length - 2; i >= 0; i--) {
    if (newestFirst.length >= CLIENT_LIMITS.maxTurns) break;
    const turn = history[i]!;
    const expected = newestFirst.length % 2 === 1 ? "assistant" : "user";
    if (turn.role !== expected) break;
    const max =
      turn.role === "user"
        ? CLIENT_LIMITS.maxUserChars
        : CLIENT_LIMITS.maxAssistantChars;
    const content = cleanContent(turn.content, max);
    if (content === null) break;
    newestFirst.push({ role: turn.role, content });
  }
  // Must start with a user turn: an even count means the oldest kept turn is an assistant.
  if (newestFirst.length % 2 === 0) newestFirst.pop();

  let turns = newestFirst.reverse();
  for (;;) {
    const body = JSON.stringify({ messages: turns, sessionId });
    if (utf8Bytes(body) <= CLIENT_LIMITS.maxBodyBytes) return { body, turns };
    if (turns.length === 1) return null;
    turns = turns.slice(2);
  }
}
