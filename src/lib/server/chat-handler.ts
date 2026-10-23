// POST /api/chat orchestration (SCOPE §3, §5.3, §5.4, §6). Every control runs in order
// and fails closed: input -> env -> BotID -> rate limits -> budget -> stream.
// All dependencies are injected so tests never reach Anthropic, Upstash or BotID
// (CLAUDE.md rule 5). No env var toggles any control (rule 4): the only switches are
// the `testOnly` argument, which throws outside Vitest.
import type { APIContext, APIRoute } from "astro";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatEvent, ErrorCode, UsageBucket } from "../chat-events.ts";
import type { ModelMood } from "../moods.ts";
import { systemBlocks } from "../prompt.ts";
import {
  ChatUpstreamError,
  MAX_TOKENS,
  REFUSAL_REPLY,
  buildParams,
  errorClassOf,
  streamChat,
  type ChatStreamEvent,
} from "./anthropic.ts";
import { checkBot, type BotCheck } from "./botid.ts";
import { checkBudget, recordSpend, type BudgetStore } from "./budget.ts";
import type { ChatEnv, EnvResult } from "./env.ts";
import {
  parseChatRequest,
  type InputError,
  type InputResult,
} from "./input.ts";
import type { ChatMetric } from "./log.ts";
import { createMoodParser, type MoodParseResult } from "./mood-parser.ts";
import { costMicroUsd, worstCaseCostMicroUsd, type Usage } from "./pricing.ts";
import { checkRateLimits, type Limiters } from "./ratelimit.ts";
import { createScrubber, scrub } from "./scrub.ts";
import { SSE_HEADERS, encodeEvent, errorResponse } from "./sse.ts";

export type ChatDeps = {
  env(): EnvResult;
  botCheck: BotCheck;
  /** Keeps the function alive until the spend write settles (N-2). */
  waitUntil(p: Promise<unknown>): void;
  limiters(env: ChatEnv): Limiters;
  budgetStore(env: ChatEnv): BudgetStore;
  anthropic(env: ChatEnv): Anthropic;
  systemPrompt(): string;
  kbUrls(): readonly string[];
  log(m: ChatMetric): void;
  now(): number;
};

// There is no flag for input limits or scrubbing.
export type TestOnlyControls = {
  skipBotId?: true;
  skipRateLimit?: true;
  skipBudget?: true;
};

/** botid's fetch has no timeout of its own; a slow verdict counts as unavailable. */
export const BOT_TIMEOUT_MS = 3000;

// P2-02 categories -> HTTP status. Bodies carry only the generic `invalid` code.
const INPUT_STATUS: Record<InputError, number> = {
  method: 405,
  content_type: 415,
  too_large: 413,
  origin: 403,
  malformed: 400,
  invalid: 400,
};

const utf8 = new TextEncoder();
const byteLength = (s: string): number => utf8.encode(s).byteLength;

function withBotTimeout(check: BotCheck): BotCheck {
  return (request) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("BotID timeout")),
        BOT_TIMEOUT_MS,
      );
    });
    return Promise.race([
      Promise.resolve().then(() => check(request)),
      timeout,
    ]).finally(() => clearTimeout(timer));
  };
}

/**
 * Platform-derived client IP only (Astro `clientAddress`; Vercel overwrites XFF).
 * The getter throws when the address is unavailable. Never read XFF/X-Real-IP here.
 */
function clientIp(context: APIContext): string {
  try {
    const ip: unknown = context.clientAddress;
    return typeof ip === "string" && ip.trim() !== "" ? ip : "unknown";
  } catch {
    return "unknown";
  }
}

function envErrorClass(r: { missing: string[]; invalid: string[] }): string {
  // Names only, never values.
  return `EnvError(missing=${r.missing.join(",")};invalid=${r.invalid.join(",")})`;
}

function upstreamFailure(e: unknown): {
  code: "upstream" | "unavailable";
  errorClass: string;
} {
  if (e instanceof ChatUpstreamError)
    return { code: e.code, errorClass: e.errorClass };
  return { code: "upstream", errorClass: errorClassOf(e) };
}

type Run = {
  deps: ChatDeps;
  metric: ChatMetric;
  started: number;
  logged: boolean;
};

function finish(run: Run, status: number): void {
  if (run.logged) return;
  run.logged = true;
  run.metric.status = status;
  run.metric.latencyMs = run.deps.now() - run.started;
  try {
    run.deps.log(run.metric);
  } catch {
    // Logging must never break a response.
  }
}

function fail(
  run: Run,
  code: ErrorCode,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  run.metric.code = code;
  finish(run, status);
  // Only lowercase extra header keys (P2-08).
  return errorResponse(code, status, extraHeaders);
}

/** What one request may cost: the prompt size bound and the `max_tokens` actually sent. */
type ChargeBasis = {
  model: ChatEnv["chatModel"];
  promptBytes: number;
  maxTokens: number;
};

/**
 * Usage to bill for a stream that ended without a terminal stop_reason (client abort,
 * cancel or any other non-terminal end). The last usage seen is usually message_start's
 * (output_tokens ~ 1) while the model may keep generating, so output is billed at
 * max(reported, max_tokens) (P2-15). Invalid counts are left as-is so pricing rejects
 * them and the worst case applies.
 */
function nonTerminalUsage(usage: Usage, maxTokens: number): Usage {
  const out = usage.output_tokens;
  if (!Number.isSafeInteger(out) || out < 0) return usage;
  return { ...usage, output_tokens: Math.max(out, maxTokens) };
}

/**
 * Charges one request: real usage, else (or if usage is unusable) the worst case.
 * `terminal` is false when the stream ended without a stop_reason; output is then
 * billed at no less than `max_tokens`. Never charges less than the reported usage.
 */
async function charge(
  run: Run,
  store: BudgetStore | null,
  basis: ChargeBasis,
  usage: Usage | null,
  terminal: boolean,
): Promise<void> {
  const { metric } = run;
  const { model, promptBytes, maxTokens } = basis;
  let micro: number | undefined;
  if (usage) {
    try {
      micro = costMicroUsd(
        model,
        terminal ? usage : nonTerminalUsage(usage, maxTokens),
      );
      metric.inputTokens = usage.input_tokens;
      metric.outputTokens = usage.output_tokens;
      metric.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      metric.cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
    } catch {
      micro = undefined;
    }
  }
  // Never record 0 for a request whose usage is unknown (P2-05).
  micro ??= worstCaseCostMicroUsd(model, promptBytes, maxTokens);
  metric.costMicroUsd = micro;
  if (!store) return;
  try {
    await recordSpend(store, micro, new Date(run.deps.now()));
  } catch {
    metric.errorClass = metric.errorClass
      ? `${metric.errorClass}+BudgetRecordError`
      : "BudgetRecordError";
  }
}

/**
 * Charges under `waitUntil` so the spend write survives the response ending first
 * (client abort, cancel) and the function freezing (N-2). Never rejects.
 */
function chargeLive(
  run: Run,
  store: BudgetStore | null,
  basis: ChargeBasis,
  usage: Usage | null,
  terminal: boolean,
): Promise<void> {
  const p = charge(run, store, basis, usage, terminal);
  run.deps.waitUntil(p);
  return p;
}

export function createChatHandler(
  deps: ChatDeps,
  testOnly?: TestOnlyControls,
): APIRoute {
  if (testOnly !== undefined && process.env["VITEST"] !== "true") {
    throw new Error("testOnly controls are only allowed under Vitest");
  }
  const skip: TestOnlyControls = Object.freeze({ ...testOnly });
  const botCheck = withBotTimeout(deps.botCheck);

  return async (context) => {
    const run: Run = {
      deps,
      metric: { evt: "chat", status: 0 },
      started: deps.now(),
      logged: false,
    };
    try {
      return await handle(run, skip, botCheck, context);
    } catch (e) {
      // Unexpected failure before the stream: a generic 503, never details.
      run.metric.errorClass ??= errorClassOf(e);
      return fail(run, "unavailable", 503);
    }
  };
}

async function handle(
  run: Run,
  skip: TestOnlyControls,
  botCheck: BotCheck,
  context: APIContext,
): Promise<Response> {
  const { deps, metric } = run;
  const { request } = context;

  // 1. Input (P2-02). readBody can reject on a broken or already-read body.
  let input: InputResult;
  try {
    input = await parseChatRequest(request);
  } catch {
    input = { ok: false, error: "malformed" };
  }
  if (!input.ok) {
    metric.errorClass = `InputError(${input.error})`;
    return fail(
      run,
      "invalid",
      INPUT_STATUS[input.error],
      input.error === "method" ? { allow: "POST" } : undefined,
    );
  }
  const { messages } = input.value;
  metric.turns = messages.length;

  // 2. Config. Clients are built only after this succeeds.
  const envResult = deps.env();
  if (!envResult.ok) {
    metric.errorClass = envErrorClass(envResult);
    return fail(run, "unavailable", 503);
  }
  const env = envResult.env;
  metric.model = env.chatModel;

  // 3. BotID.
  if (!skip.skipBotId) {
    const bot = await checkBot(botCheck, request);
    if (!bot.ok) {
      return bot.reason === "bot"
        ? fail(run, "bot", 403)
        : fail(run, "unavailable", 503);
    }
  }

  // 4. Rate limits: per-IP minute, per-IP day, then global (sequential).
  if (!skip.skipRateLimit) {
    let limiters: Limiters;
    try {
      limiters = deps.limiters(env);
    } catch {
      metric.errorClass = "LimiterInitError";
      return fail(run, "unavailable", 503);
    }
    const rl = await checkRateLimits(
      limiters,
      clientIp(context),
      env.ipHashSalt,
      deps.now,
    );
    if (!rl.ok) {
      return rl.reason === "rate_limited"
        ? fail(run, "rate_limited", 429, {
            "retry-after": String(rl.retryAfterSec),
          })
        : fail(run, "unavailable", 503);
    }
  }

  // 5. Daily spend kill switch.
  let store: BudgetStore | null = null;
  let bucket: UsageBucket = "ok";
  if (!skip.skipBudget) {
    try {
      store = deps.budgetStore(env);
    } catch {
      metric.errorClass = "BudgetInitError";
      return fail(run, "unavailable", 503);
    }
    const budget = await checkBudget(
      store,
      env.dailyBudgetUsd,
      new Date(deps.now()),
    );
    if (!budget.ok) return fail(run, budget.reason, 503);
    bucket = budget.bucket;
  }

  // 6. Build the request.
  let client: Anthropic;
  let params: Record<string, unknown>;
  let allowedUrls: readonly string[];
  let promptBytes: number;
  try {
    const prompt = deps.systemPrompt();
    params = buildParams(
      env.chatModel,
      env.chatEffort,
      systemBlocks(prompt),
      messages,
    );
    allowedUrls = deps.kbUrls();
    client = deps.anthropic(env);
    // Strict upper bound on prompt tokens: UTF-8 bytes of system+KB and the turns
    // (the JSON framing over-counts the per-message overhead).
    promptBytes = byteLength(prompt) + byteLength(JSON.stringify(messages));
  } catch (e) {
    metric.errorClass = errorClassOf(e);
    return fail(run, "unavailable", 503);
  }

  // The max_tokens actually sent bounds what the model can generate.
  const sentMax = params["max_tokens"];
  const basis: ChargeBasis = {
    model: env.chatModel,
    promptBytes,
    maxTokens:
      typeof sentMax === "number" &&
      Number.isSafeInteger(sentMax) &&
      sentMax > 0
        ? sentMax
        : MAX_TOKENS,
  };

  // 7. Stream. From here on every path is charged.
  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  if (request.signal.aborted) ac.abort();
  else request.signal.addEventListener("abort", onAbort, { once: true });
  const unlink = (): void =>
    request.signal.removeEventListener("abort", onAbort);

  const gen = streamChat(client, params, ac.signal);
  let first: IteratorResult<ChatStreamEvent, void>;
  try {
    first = await gen.next();
  } catch (e) {
    // Failed before the first token: a JSON error, not a stream.
    unlink();
    const f = upstreamFailure(e);
    metric.errorClass = f.errorClass;
    await chargeLive(run, store, basis, null, false);
    return fail(run, f.code, f.code === "unavailable" ? 503 : 502);
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller);
    },
    cancel() {
      ac.abort();
    },
  });

  async function pump(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<void> {
    let open = true;
    const send = (e: ChatEvent): void => {
      const frame = utf8.encode(encodeEvent(e));
      if (!open) return;
      try {
        controller.enqueue(frame);
      } catch {
        open = false; // client went away
        return;
      }
      if (e.event === "delta" && metric.ttfbMs === undefined) {
        metric.ttfbMs = deps.now() - run.started;
      }
    };

    const parser = createMoodParser();
    const scrubber = createScrubber({ allowedUrls });
    let moodSent = false;
    let refused = false;
    let usage: Usage | null = null;
    let terminal = false;

    const sendMood = (mood: ModelMood): void => {
      moodSent = true;
      metric.mood = mood;
      send({ event: "mood", data: { mood } });
    };
    const sendText = (text: string): void => {
      if (text !== "") send({ event: "delta", data: { text } });
    };
    // Mood parser -> scrubber -> delta. The parser only releases text with a mood.
    const feed = (r: MoodParseResult): void => {
      if (r.mood && !moodSent) sendMood(r.mood);
      if (r.text !== "") sendText(scrubber.push(r.text));
    };
    const refuse = (): void => {
      // Discard what was streamed; the scrubber's held tail is dropped with it.
      refused = true;
      send({ event: "reset", data: {} });
      sendMood("confused");
      sendText(scrub(REFUSAL_REPLY, { allowedUrls }));
    };

    try {
      let next = first;
      while (!next.done) {
        const ev = next.value;
        if (ev.type === "text") {
          if (!refused) feed(parser.push(ev.text));
        } else if (ev.type === "reset") {
          // The adapter emits this once; never emit a second reset at `end`.
          if (!refused) refuse();
        } else {
          const { stopReason, usage: u, errorClass } = ev.outcome;
          usage = u;
          terminal = stopReason !== null;
          if (stopReason !== null) metric.stopReason = stopReason;
          if (errorClass) metric.errorClass = errorClass;
          if (stopReason === null) break; // aborted: the client is gone
          if (stopReason === "refusal" && !refused) refuse();
          if (!refused) {
            feed(parser.end());
            sendText(scrubber.flush());
          }
          send({ event: "done", data: { usageBucket: bucket } });
          break;
        }
        next = await gen.next();
      }
    } catch (e) {
      const f = upstreamFailure(e);
      metric.errorClass = f.errorClass;
      metric.code = f.code;
      try {
        send({ event: "error", data: { code: f.code } });
      } catch {
        // nothing more to say
      }
    } finally {
      unlink();
      // Charged even on refusal, upstream error or client abort; a non-terminal end
      // bills output at no less than max_tokens.
      await chargeLive(run, store, basis, usage, terminal);
      finish(run, 200);
      try {
        controller.close();
      } catch {
        // already cancelled
      }
    }
  }

  return new Response(body, { status: 200, headers: { ...SSE_HEADERS } });
}
