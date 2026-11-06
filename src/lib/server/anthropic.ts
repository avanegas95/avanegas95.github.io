// The only module that talks to @anthropic-ai/sdk (CLAUDE.md rule 6, SCOPE §5.3).
// Builds rule-6 params, streams text deltas, reports stop_reason + usage, and maps
// SDK errors by class (instanceof), never by message string. Logs nothing.
import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { CHAT_MODELS, type ChatEnv } from "./env.ts";

export const MAX_TOKENS = 1024;

// Shown when the model refuses (stop_reason "refusal"); P2-10 discards partial text,
// emits `reset`, sets mood `confused` and sends this instead.
export const REFUSAL_REPLY =
  "Oops, Blob can't help with that one. Blob is happiest talking about Anderson's work, projects and skills. " +
  "To reach Anderson directly, email him at avanegas95@gmail.com, or find him on LinkedIn or GitHub.";

const SONNET_BETA = "server-side-fallback-2026-07-01";

// Pinned: an ANTHROPIC_BASE_URL env must never redirect traffic (and the key).
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export function createClient(apiKey: string): Anthropic {
  if (!apiKey) throw new Error("Anthropic API key is missing");
  // logLevel "off": an ANTHROPIC_LOG=debug env must never dump request bodies or headers.
  return new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    maxRetries: 1,
    timeout: 30_000,
    logLevel: "off",
  });
}

type Turn = { role: "user" | "assistant"; content: string };

// Volatile values would break the byte-stable cache prefix (rule 6).
// Plain dates such as `2026-10-13` (KB `updated` fields) are fine: only a date WITH a
// time part, or an 8-4-4-4-12 hex UUID not embedded in a longer hex/dash run, matches.
const VOLATILE = [
  // ISO-8601 datetime with a time part
  /(?<![\d-])\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?(?![\d:])/,
  // UUID
  /(?<![0-9a-f-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])/i,
];

function assertLastTurnUser(
  messages: readonly { role?: unknown }[] | unknown,
): void {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }
  const last = messages[messages.length - 1] as { role?: unknown };
  if (last.role !== "user")
    throw new Error("final message must be role user (no prefill)");
}

const isSonnet = (model: unknown): boolean =>
  typeof model === "string" && model.startsWith("claude-sonnet-");

export function buildParams(
  model: ChatEnv["chatModel"],
  effort: ChatEnv["chatEffort"],
  system: Anthropic.TextBlockParam[],
  messages: Turn[],
): Record<string, unknown> {
  if (!(CHAT_MODELS as readonly string[]).includes(model)) {
    throw new Error("unsupported chat model");
  }
  assertLastTurnUser(messages);
  if (system.some((b) => VOLATILE.some((re) => re.test(b.text)))) {
    throw new Error("system prompt must not contain timestamps or IDs");
  }
  const params: Record<string, unknown> = {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort },
    system: system.map((b) => ({ ...b })),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (isSonnet(model)) {
    // Haiku 5.5 has no server-side fallback (a fallbacks list returns 400).
    params["betas"] = [SONNET_BETA];
    params["fallbacks"] = "default";
  }
  return params;
}

export type StreamOutcome = {
  stopReason: string | null;
  usage: Anthropic.Usage | null;
  errorClass?: string;
};

// `reset` fires once when a refusal is seen (it can arrive mid-stream after partial
// text): consumers discard what they streamed. P2-10 maps it to the SSE `reset` event.
export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "end"; outcome: StreamOutcome };

export type ErrorClass =
  | "BadRequestError"
  | "AuthenticationError"
  | "PermissionDeniedError"
  | "NotFoundError"
  | "RateLimitError"
  | "InternalServerError"
  | "APIConnectionTimeoutError"
  | "APIConnectionError"
  | "APIUserAbortError"
  | "APIError"
  | "AnthropicError"
  | "Unknown";

// Order matters: subclasses before APIError (APIConnectionError extends APIError in TS).
const CLASSES: [abstract new (...a: never[]) => unknown, ErrorClass][] = [
  [APIUserAbortError, "APIUserAbortError"],
  [APIConnectionTimeoutError, "APIConnectionTimeoutError"],
  [APIConnectionError, "APIConnectionError"],
  [BadRequestError, "BadRequestError"],
  [AuthenticationError, "AuthenticationError"],
  [PermissionDeniedError, "PermissionDeniedError"],
  [NotFoundError, "NotFoundError"],
  [RateLimitError, "RateLimitError"],
  [InternalServerError, "InternalServerError"],
  [APIError, "APIError"],
  [AnthropicError, "AnthropicError"],
];

export function errorClassOf(e: unknown): ErrorClass {
  for (const [cls, name] of CLASSES) if (e instanceof cls) return name;
  return "Unknown";
}

// Structurally a subset of P2-08's ErrorCode. `unavailable`: our config/account is
// broken (bad key, no permission, unknown model, bad request incl. a workspace spend
// limit); retrying won't help. Everything else is a transient `upstream` failure.
export type UpstreamErrorCode = "upstream" | "unavailable";
const UNAVAILABLE = new Set<string>([
  "BadRequestError",
  "AuthenticationError",
  "PermissionDeniedError",
  "NotFoundError",
]);
export function upstreamCodeOf(errorClass: string): UpstreamErrorCode {
  return UNAVAILABLE.has(errorClass) ? "unavailable" : "upstream";
}

export class ChatUpstreamError extends Error {
  readonly errorClass: string;
  readonly beforeFirstToken: boolean;
  readonly code: UpstreamErrorCode;
  /** Short diagnostic code (e.g. `UND_ERR_SOCKET`, `stream_timeout`); never a message. */
  readonly causeCode: string | undefined;
  constructor(
    errorClass: string,
    beforeFirstToken: boolean,
    causeCode?: string,
  ) {
    // Generic message only: SDK messages may echo request details and never reach clients.
    super(`Anthropic upstream error (${errorClass})`);
    this.name = "ChatUpstreamError";
    this.errorClass = errorClass;
    this.beforeFirstToken = beforeFirstToken;
    this.code = upstreamCodeOf(errorClass);
    this.causeCode = causeCode;
  }
}

/** No SSE event for this long while waiting on the stream (after the first event). */
export const STREAM_IDLE_MS = 20_000;
/** Wall-clock cap on a whole stream; stays under the Vercel function's max duration. */
export const STREAM_TOTAL_MS = 60_000;

export type StreamTimeoutReason = "idle" | "total";

/**
 * The stall guard ended the stream. A transient `upstream` failure: the endpoint maps
 * it to the same safe client error as any other upstream failure.
 */
export class ChatStreamTimeoutError extends ChatUpstreamError {
  readonly reason: StreamTimeoutReason;
  constructor(reason: StreamTimeoutReason, beforeFirstToken: boolean) {
    super("StreamTimeoutError", beforeFirstToken, "stream_timeout");
    this.name = "ChatStreamTimeoutError";
    this.reason = reason;
  }
}

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * `e.cause.code`, else `e.cause.name`, when it is a short identifier. The SDK wraps
 * transport errors (undici `terminated`, socket resets) as a bare AnthropicError with
 * the original as `cause`. Never returns a message.
 */
export function causeCodeOf(e: unknown): string | undefined {
  const cause =
    e && typeof e === "object" ? (e as { cause?: unknown }).cause : undefined;
  if (!cause || typeof cause !== "object") return undefined;
  for (const key of ["code", "name"] as const) {
    const v = (cause as Record<string, unknown>)[key];
    if (typeof v === "string" && SAFE_CODE.test(v)) return v;
  }
  return undefined;
}

const upstreamError = (e: unknown, beforeFirstToken: boolean) =>
  new ChatUpstreamError(errorClassOf(e), beforeFirstToken, causeCodeOf(e));

type SdkStream = AsyncIterable<unknown> & {
  finalMessage(): Promise<{
    stop_reason?: string | null;
    usage?: Anthropic.Usage;
  }>;
  abort?(): void;
};

type Ev = {
  type?: string;
  message?: { usage?: Anthropic.Usage };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: Partial<Record<keyof Anthropic.Usage, unknown>>;
};

function mergeDeltaUsage(
  base: Anthropic.Usage | null,
  delta: Ev["usage"],
): Anthropic.Usage | null {
  if (!delta) return base;
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(delta))
    if (v !== null && v !== undefined) merged[k] = v;
  return merged as unknown as Anthropic.Usage;
}

export async function* streamChat(
  client: Anthropic,
  params: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  assertLastTurnUser(params["messages"]);
  const aborted = (usage: Anthropic.Usage | null): ChatStreamEvent => ({
    type: "end",
    outcome: { stopReason: null, usage, errorClass: "APIUserAbortError" },
  });
  if (signal.aborted) {
    yield aborted(null);
    return;
  }

  // Stall guard (P4-13e). The SDK's `timeout` only covers the wait for response
  // headers; after that a stalled body can hang for minutes. The SDK gets its own
  // signal (linked to the caller's) so a timeout can abort the request, and every
  // read is raced against the guard so it ends even if the transport ignores abort.
  const guard = new AbortController();
  let timedOut: StreamTimeoutReason | null = null;
  let stream: SdkStream | undefined;
  let rejectGuard!: (e: unknown) => void;
  const tripped = new Promise<never>((_, reject) => {
    rejectGuard = reject;
  });
  tripped.catch(() => {}); // observed via Promise.race; never unhandled
  // A caller abort reaches the SDK through the guard's signal; the read then fails
  // with the SDK's own abort error, after anything it had already buffered.
  const onCallerAbort = (): void => guard.abort();
  signal.addEventListener("abort", onCallerAbort, { once: true });
  // After a caller abort the deadline still ends a read the transport never settles,
  // but the outcome stays an abort, not a timeout.
  const trip = (reason: StreamTimeoutReason): void => {
    if (timedOut) return;
    if (!signal.aborted) timedOut = reason;
    rejectGuard(new Error("stream_timeout"));
    guard.abort();
    stream?.abort?.();
  };
  const totalTimer = setTimeout(() => trip("total"), STREAM_TOTAL_MS);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = (): void => {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    signal.removeEventListener("abort", onCallerAbort);
  };

  // Idle is measured only while waiting on upstream (a slow consumer is not a
  // stall), and only after the first event: until then the SDK's header timeout and
  // its one retry apply, bounded by the total deadline.
  let sawEvent = false;
  const read = async <T>(p: Promise<T>): Promise<T> => {
    if (sawEvent) idleTimer = setTimeout(() => trip("idle"), STREAM_IDLE_MS);
    try {
      return await Promise.race([p, tripped]);
    } finally {
      clearTimeout(idleTimer);
    }
  };

  try {
    // The SDK's generic Params types can't see a Record; the shape is built by buildParams.
    const opts = { signal: guard.signal };
    stream = (isSonnet(params["model"])
      ? client.beta.messages.stream(params as never, opts)
      : client.messages.stream(params as never, opts)) as unknown as SdkStream;
  } catch (e) {
    cleanup();
    throw upstreamError(e, true);
  }
  const sdk = stream;

  let sentText = false;
  let refused = false;
  let completed = false;
  let stopReason: string | null = null;
  let sawDeltaStop = false;
  let usage: Anthropic.Usage | null = null;
  const timeoutError = (): ChatStreamTimeoutError =>
    new ChatStreamTimeoutError(timedOut ?? "total", !sentText);

  const it = sdk[Symbol.asyncIterator]();
  let iterDone = false;
  try {
    try {
      for (;;) {
        const r = await read(it.next());
        if (r.done) {
          iterDone = true;
          break;
        }
        sawEvent = true;
        const ev = r.value as Ev;
        if (signal.aborted) {
          // Still meter usage that arrived with the abort (never under-charge).
          if (ev.type === "message_start") usage = ev.message?.usage ?? usage;
          else if (ev.type === "message_delta")
            usage = mergeDeltaUsage(usage, ev.usage);
          break;
        }
        if (ev.type === "message_start") {
          usage = ev.message?.usage ?? usage;
        } else if (ev.type === "content_block_delta") {
          if (refused || ev.delta?.type !== "text_delta" || !ev.delta.text)
            continue;
          sentText = true;
          yield { type: "text", text: ev.delta.text };
        } else if (ev.type === "message_delta") {
          if (ev.delta?.stop_reason) sawDeltaStop = true;
          stopReason = ev.delta?.stop_reason ?? stopReason;
          usage = mergeDeltaUsage(usage, ev.usage);
          if (stopReason === "refusal" && !refused) {
            refused = true;
            yield { type: "reset" };
          }
        }
        // ping, content_block_start/stop, message_stop and unknown types are ignored.
      }
    } catch (e) {
      if (signal.aborted || (!timedOut && e instanceof APIUserAbortError)) {
        completed = true;
        yield aborted(usage);
        return;
      }
      // A stop_reason already arrived: the reply is complete (an error after the
      // final message_delta, e.g. before message_stop, loses nothing). Fall through so
      // the outcome is a clean `end` with that stop_reason and message_delta usage.
      if (!sawDeltaStop) {
        throw timedOut ? timeoutError() : upstreamError(e, !sentText);
      }
    }

    if (signal.aborted) {
      completed = true;
      yield aborted(usage);
      return;
    }

    if (!timedOut) {
      try {
        const final = await read(sdk.finalMessage());
        stopReason = final.stop_reason ?? stopReason;
        usage = final.usage ?? usage;
      } catch (e) {
        if (signal.aborted || (!timedOut && e instanceof APIUserAbortError)) {
          completed = true;
          yield aborted(usage);
          return;
        }
        // MessageStream's iterator only rejects a reader that is already waiting: a
        // mid-stream SSE `error` hitting a slow consumer just ends the loop and the
        // error surfaces here. With no message_delta stop_reason the reply is truncated.
        if (!sawDeltaStop) {
          throw timedOut ? timeoutError() : upstreamError(e, !sentText);
        }
        // Otherwise keep the last message_delta stop_reason and usage.
      }
    }
    if (signal.aborted) {
      completed = true;
      yield aborted(usage);
      return;
    }
    if (stopReason === "refusal" && !refused) {
      refused = true;
      yield { type: "reset" };
    }
    completed = true;
    cleanup();
    yield { type: "end", outcome: { stopReason, usage } };
  } finally {
    cleanup();
    // Consumer stopped early (client gone) or the guard fired: stop the upstream request.
    if (!completed) {
      sdk.abort?.();
      // Don't await: a stalled iterator may never settle.
      if (!iterDone) void Promise.resolve(it.return?.()).catch(() => {});
    }
  }
}
