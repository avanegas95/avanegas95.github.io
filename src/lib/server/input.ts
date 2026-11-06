import { z } from "astro/zod";

export const LIMITS = {
  maxBodyBytes: 8192,
  maxTurns: 10,
  maxUserChars: 500,
  maxAssistantChars: 1500,
  maxSessionIdChars: 64,
} as const;

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatRequest = { messages: ChatTurn[]; sessionId: string };
export type InputError =
  "method" | "content_type" | "too_large" | "malformed" | "invalid" | "origin";
export type InputResult =
  { ok: true; value: ChatRequest } | { ok: false; error: InputError };

const fail = (error: InputError): InputResult => ({ ok: false, error });

// Raw shape only; content rules are applied after normalization below.
const turnSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const requestSchema = z.strictObject({
  messages: z.array(turnSchema).min(1).max(LIMITS.maxTurns),
  sessionId: z
    .string()
    .min(8)
    .max(LIMITS.maxSessionIdChars)
    .regex(/^[A-Za-z0-9_-]+$/),
});

// C0 controls except \t (0x09) and \n (0x0A), plus DEL.
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isJsonContentType(header: string | null): boolean {
  if (header === null) return false;
  const [type, ...params] = header
    .split(";")
    .map((p) => p.trim().toLowerCase());
  if (type !== "application/json") return false;
  return params.every((p) => p === "charset=utf-8");
}

function isSameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

/** Reads at most maxBodyBytes; returns null if the limit is exceeded. */
async function readBody(request: Request): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared.trim()) &&
    Number(declared) > LIMITS.maxBodyBytes
  ) {
    return null;
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// User turns only: bidi controls and C1 controls.
const USER_FORBIDDEN =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u0080-\u009F]/;
// Whitespace, every Default_Ignorable code point (zero-width and format
// characters, fillers, tag characters, variation selectors) and the braille
// blank U+2800: a user turn with only these is empty (P4-15, F-IN-1).
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}\u2800]/gu;

function normalizeContent(raw: string, role: ChatTurn["role"]): string | null {
  if (LONE_SURROGATE.test(raw)) return null;
  const text = raw.normalize("NFC").replace(/\r\n/g, "\n");
  if (FORBIDDEN_CONTROLS.test(text)) return null;
  if (text.trim() === "") return null;
  if (role === "user") {
    if (USER_FORBIDDEN.test(text)) return null;
    if (text.replace(INVISIBLE, "") === "") return null;
  }
  return text;
}

/**
 * Validates a chat request. Pure: no logging, no env, no network. Error results
 * carry only a category, never any request text.
 */
export async function parseChatRequest(request: Request): Promise<InputResult> {
  if (request.method !== "POST") return fail("method");
  if (!isJsonContentType(request.headers.get("content-type")))
    return fail("content_type");

  const origin = request.headers.get("origin");
  if (origin !== null && !isSameOrigin(origin, request.url))
    return fail("origin");

  const bytes = await readBody(request);
  if (bytes === null) return fail("too_large");

  let json: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    json = JSON.parse(text);
  } catch {
    return fail("malformed");
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return fail("invalid");

  const { messages, sessionId } = parsed.data;
  const turns: ChatTurn[] = [];
  for (const [i, m] of messages.entries()) {
    // Roles must alternate, starting with user; last turn must be user.
    if (m.role !== (i % 2 === 0 ? "user" : "assistant")) return fail("invalid");
    const content = normalizeContent(m.content, m.role);
    if (content === null) return fail("invalid");
    const max =
      m.role === "user" ? LIMITS.maxUserChars : LIMITS.maxAssistantChars;
    if ([...content].length > max) return fail("invalid");
    turns.push({ role: m.role, content });
  }
  if (turns[turns.length - 1]!.role !== "user") return fail("invalid");

  return { ok: true, value: { messages: turns, sessionId } };
}
