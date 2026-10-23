// SSE chat client (SCOPE §5.4, §6.1). Framework-free and DOM-free; the UI (P3-09) owns
// rendering. Exactly one terminal callback per call, unless the caller aborts.
import type { ChatEvent, ErrorCode, UsageBucket } from "../../lib/chat-events";
import { isModelMood, type ModelMood } from "../../lib/moods";

export type ClientErrorCode = ErrorCode | "network";

export type StreamHandlers = {
  onMood(m: ModelMood): void;
  onDelta(text: string): void;
  onReset(): void;
  onDone(bucket: UsageBucket): void;
  onError(code: ClientErrorCode): void;
};

export type StreamOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
};

const CHAT_URL = "/api/chat";
const FIRST_BYTE_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// SSE framing (WHATWG "event stream interpretation"), fed already-decoded text.
// ---------------------------------------------------------------------------

export function createSseParser(): {
  push(chunk: string): { event: string; data: string }[];
} {
  let buffer = "";
  let skipLeadingLf = false; // the previous chunk ended in \r, which may be half of \r\n
  let eventName = "";
  let dataLines: string[] = [];

  function line(text: string, out: { event: string; data: string }[]): void {
    if (text === "") {
      if (dataLines.length > 0) {
        out.push({ event: eventName || "message", data: dataLines.join("\n") });
      }
      eventName = "";
      dataLines = [];
      return;
    }
    if (text.startsWith(":")) return; // comment
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    // id, retry and unknown fields are ignored.
  }

  return {
    push(chunk) {
      const out: { event: string; data: string }[] = [];
      buffer += chunk;
      if (skipLeadingLf && buffer.startsWith("\n")) buffer = buffer.slice(1);
      skipLeadingLf = false;
      for (;;) {
        const m = /\r\n|\r|\n/.exec(buffer);
        if (m === null) break;
        line(buffer.slice(0, m.index), out);
        buffer = buffer.slice(m.index + m[0].length);
        if (m[0] === "\r" && buffer === "") skipLeadingLf = true;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Payload guards. Hand-written (no zod in the island budget); kept together here so a
// later swap to zod/mini only touches this section. They accept exactly the shapes in
// src/lib/chat-events.ts: known keys only, typed values.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const ERROR_CODES: readonly ErrorCode[] = [
  "rate_limited",
  "budget",
  "bot",
  "upstream",
  "invalid",
  "unavailable",
];
const USAGE_BUCKETS: readonly UsageBucket[] = ["ok", "warm", "hot"];
const EVENT_NAMES = new Set(["mood", "delta", "reset", "done", "error"]);

function isRecord(v: unknown): v is Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A plain object whose own keys are exactly `keys`. */
function hasExactKeys(v: unknown, keys: readonly string[]): v is Json {
  if (!isRecord(v)) return false;
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}

function isErrorCode(v: unknown): v is ErrorCode {
  return (
    typeof v === "string" && (ERROR_CODES as readonly string[]).includes(v)
  );
}

function isUsageBucket(v: unknown): v is UsageBucket {
  return (
    typeof v === "string" && (USAGE_BUCKETS as readonly string[]).includes(v)
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isKnownEventName(name: string): boolean {
  return EVENT_NAMES.has(name);
}

/** Validates one SSE frame. Null for unknown event names or invalid data. */
export function toChatEvent(raw: {
  event: string;
  data: string;
}): ChatEvent | null {
  if (!isKnownEventName(raw.event)) return null;
  const d = parseJson(raw.data);
  switch (raw.event) {
    case "mood":
      return hasExactKeys(d, ["mood"]) &&
        typeof d["mood"] === "string" &&
        isModelMood(d["mood"])
        ? { event: "mood", data: { mood: d["mood"] } }
        : null;
    case "delta":
      return hasExactKeys(d, ["text"]) && typeof d["text"] === "string"
        ? { event: "delta", data: { text: d["text"] } }
        : null;
    case "reset":
      return hasExactKeys(d, []) ? { event: "reset", data: {} } : null;
    case "done":
      return hasExactKeys(d, ["usageBucket"]) && isUsageBucket(d["usageBucket"])
        ? { event: "done", data: { usageBucket: d["usageBucket"] } }
        : null;
    case "error":
      return hasExactKeys(d, ["code"]) && isErrorCode(d["code"])
        ? { event: "error", data: { code: d["code"] } }
        : null;
    default:
      return null;
  }
}

/** Code from a non-2xx `{ error: { code } }` body; anything else is `upstream`. */
export function errorCodeFromBody(text: string): ErrorCode {
  const body = parseJson(text);
  if (!hasExactKeys(body, ["error"])) return "upstream";
  const inner = body["error"];
  if (!hasExactKeys(inner, ["code"]) || !isErrorCode(inner["code"])) {
    return "upstream";
  }
  return inner["code"];
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const TIMEOUT = Symbol("timeout");
const ABORTED = Symbol("aborted");
type Raced<T> = T | typeof TIMEOUT | typeof ABORTED;

function isEventStream(contentType: string | null): boolean {
  if (contentType === null) return false;
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return type === "text/event-stream";
}

export async function streamChat(
  body: string,
  h: StreamHandlers,
  opts: StreamOptions = {},
): Promise<void> {
  const signal = opts.signal;
  if (signal?.aborted) return;
  const firstByteMs = opts.firstByteTimeoutMs ?? FIRST_BYTE_TIMEOUT_MS;
  const idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;

  // Aborts the request on caller abort, timeout or terminal event.
  const ctrl = new AbortController();
  let abortWaiters: (() => void)[] = [];
  const onCallerAbort = (): void => {
    ctrl.abort();
    for (const w of abortWaiters) w();
    abortWaiters = [];
  };
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  // Races a promise against a timeout and the caller's signal. Swallows late rejections.
  function race<T>(p: Promise<T>, ms: number): Promise<Raced<T>> {
    return new Promise<Raced<T>>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abortWaiters = abortWaiters.filter((w) => w !== onAbort);
        fn();
      };
      const onAbort = (): void => settle(() => resolve(ABORTED));
      const timer = setTimeout(() => settle(() => resolve(TIMEOUT)), ms);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      abortWaiters.push(onAbort);
      p.then(
        (v) => settle(() => resolve(v)),
        (e: unknown) => settle(() => reject(e)),
      );
    });
  }

  let finished = false;
  const terminal = (fn: () => void): void => {
    if (finished) return;
    finished = true;
    if (signal?.aborted) return;
    fn();
  };
  const fail = (code: ClientErrorCode): void => terminal(() => h.onError(code));

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: ctrl.signal,
    };
    // Resolve fetch at call time so BotID's patched globalThis.fetch applies.
    const request = opts.fetchImpl
      ? opts.fetchImpl(CHAT_URL, init)
      : globalThis.fetch(CHAT_URL, init);

    let res: Response | typeof TIMEOUT | typeof ABORTED;
    try {
      res = await race(request, firstByteMs);
    } catch {
      return fail("network");
    }
    if (res === ABORTED) return;
    if (res === TIMEOUT) return fail("network");

    if (!res.ok) {
      let text: string | typeof TIMEOUT | typeof ABORTED;
      try {
        text = await race(res.text(), idleMs);
      } catch {
        return fail("upstream");
      }
      if (text === ABORTED) return;
      return fail(text === TIMEOUT ? "network" : errorCodeFromBody(text));
    }
    if (!isEventStream(res.headers.get("content-type")) || res.body === null) {
      res.body?.cancel().catch(() => undefined);
      return fail("upstream");
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = createSseParser();

    // Returns true once a terminal callback has fired.
    const handle = (frames: { event: string; data: string }[]): boolean => {
      for (const frame of frames) {
        if (finished || signal?.aborted) return true;
        if (!isKnownEventName(frame.event)) continue;
        const ev = toChatEvent(frame);
        if (ev === null) {
          fail("upstream");
          return true;
        }
        switch (ev.event) {
          case "mood":
            h.onMood(ev.data.mood);
            break;
          case "delta":
            h.onDelta(ev.data.text);
            break;
          case "reset":
            h.onReset();
            break;
          case "done":
            terminal(() => h.onDone(ev.data.usageBucket));
            return true;
          case "error":
            fail(ev.data.code);
            return true;
        }
      }
      return finished;
    };

    for (;;) {
      let chunk: Raced<ReadableStreamReadResult<Uint8Array>>;
      try {
        chunk = await race(reader.read(), idleMs);
      } catch {
        return fail("network");
      }
      if (chunk === ABORTED) return;
      if (chunk === TIMEOUT) return fail("network");
      if (chunk.done) {
        handle(parser.push(decoder.decode()));
        return fail("upstream"); // no-op if the stream already ended with done/error
      }
      if (handle(parser.push(decoder.decode(chunk.value, { stream: true })))) {
        return;
      }
    }
  } catch {
    // A handler threw; still close out with a single terminal callback.
    fail("upstream");
  } finally {
    signal?.removeEventListener("abort", onCallerAbort);
    finished = true;
    if (reader !== undefined) reader.cancel().catch(() => undefined);
    ctrl.abort();
  }
}
