// The SDK is fully mocked: no network, no real API (CLAUDE.md rule 5).
import { afterEach, describe, expect, it, vi } from "vitest";

const ctorSpy = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class SpyAnthropic extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      ctorSpy(opts);
    }
  }
  return { ...actual, default: SpyAnthropic, Anthropic: SpyAnthropic };
});

import Anthropic, {
  AnthropicError as AnthropicErrorCtor,
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
import {
  ChatStreamTimeoutError,
  ChatUpstreamError,
  MAX_TOKENS,
  STREAM_IDLE_MS,
  STREAM_TOTAL_MS,
  REFUSAL_REPLY,
  buildParams,
  causeCodeOf,
  ANTHROPIC_BASE_URL,
  createClient,
  errorClassOf,
  streamChat,
  upstreamCodeOf,
  type ChatStreamEvent,
} from "../../src/lib/server/anthropic.ts";
import { buildKb, loadKbSources } from "../../src/lib/kb.ts";

const FAKE_KEY = "sk-ant-fake-test-key-000";
const SYSTEM: Anthropic.TextBlockParam[] = [
  { type: "text", text: "You are Blob." },
  {
    type: "text",
    text: "KB",
    cache_control: { type: "ephemeral" },
  },
];
const MSGS = [
  { role: "user" as const, content: "Hi" },
  { role: "assistant" as const, content: "Hello!" },
  { role: "user" as const, content: "What does he do?" },
];

const BANNED = new Set([
  "thinking",
  "budget_tokens",
  "temperature",
  "top_p",
  "top_k",
  "tool_choice",
  "tools",
  "stop_sequences",
  "metadata",
]);

function bannedKeys(v: unknown, path = ""): string[] {
  if (Array.isArray(v))
    return v.flatMap((x, i) => bannedKeys(x, `${path}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v).flatMap(([k, x]) => [
      ...(BANNED.has(k) ? [`${path}.${k}`] : []),
      ...bannedKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

// ---------- fake SDK stream ----------

type Step = { event: unknown } | { throw: unknown };
type FakeOpts = {
  final?: () => Promise<unknown>;
  waitForAbort?: boolean;
};

const usageStart = {
  input_tokens: 1200,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 1100,
  cache_creation: null,
  inference_geo: null,
  output_tokens_details: null,
  server_tool_use: null,
};

const ev = {
  start: { type: "message_start", message: { usage: usageStart } },
  blockStart: {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  },
  text: (t: string) => ({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: t },
  }),
  thinking: {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "secret plan" },
  },
  ping: { type: "ping" },
  unknown: { type: "brand_new_event", payload: 1 },
  delta: (stop: string, out = 42) => ({
    type: "message_delta",
    delta: { stop_reason: stop, stop_sequence: null },
    usage: {
      input_tokens: null,
      output_tokens: out,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      output_tokens_details: null,
      server_tool_use: null,
    },
  }),
  stop: { type: "message_stop" },
};

function finalMsg(stop: string, out = 42) {
  return {
    stop_reason: stop,
    usage: { ...usageStart, output_tokens: out },
    content: [],
  };
}

function fakeStream(steps: Step[], opts: FakeOpts = {}, signal?: AbortSignal) {
  const abort = vi.fn();
  return {
    abort,
    finalMessage: vi.fn(
      opts.final ?? (() => Promise.resolve(finalMsg("end_turn"))),
    ),
    async *[Symbol.asyncIterator]() {
      for (const s of steps) {
        await Promise.resolve();
        if ("throw" in s) throw s.throw;
        yield s.event;
      }
      if (opts.waitForAbort && signal) {
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        }
        throw new APIUserAbortError();
      }
    },
  };
}

function fakeClient(steps: Step[], opts: FakeOpts = {}) {
  let last: ReturnType<typeof fakeStream> | undefined;
  const make = vi.fn((_p: unknown, o?: { signal?: AbortSignal }) => {
    last = fakeStream(steps, opts, o?.signal);
    return last;
  });
  const betaMake = vi.fn((_p: unknown, o?: { signal?: AbortSignal }) => {
    last = fakeStream(steps, opts, o?.signal);
    return last;
  });
  const client = {
    messages: { stream: make },
    beta: { messages: { stream: betaMake } },
  } as unknown as Anthropic;
  return { client, make, betaMake, stream: () => last! };
}

async function collect(it: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const haikuParams = () => buildParams("claude-haiku-5-5", "low", SYSTEM, MSGS);
const sig = () => new AbortController().signal;

const headers = new Headers();
const typed: [unknown, string][] = [
  [new BadRequestError(400, {}, "bad", headers), "BadRequestError"],
  [new AuthenticationError(401, {}, "auth", headers), "AuthenticationError"],
  [
    new PermissionDeniedError(403, {}, "perm", headers),
    "PermissionDeniedError",
  ],
  [new NotFoundError(404, {}, "nf", headers), "NotFoundError"],
  [new RateLimitError(429, {}, "rl", headers), "RateLimitError"],
  [new InternalServerError(500, {}, "ise", headers), "InternalServerError"],
  [
    new InternalServerError(529, {}, "overloaded", headers),
    "InternalServerError",
  ],
  [APIError.generate(503, {}, "svc", headers), "InternalServerError"],
  [new APIConnectionError({ message: "conn" }), "APIConnectionError"],
  [new APIConnectionTimeoutError(), "APIConnectionTimeoutError"],
  [new APIUserAbortError(), "APIUserAbortError"],
  [new APIError(undefined, {}, "x", undefined, "overloaded_error"), "APIError"],
  [new Error("plain"), "Unknown"],
  ["string", "Unknown"],
  [undefined, "Unknown"],
];

afterEach(() => {
  vi.restoreAllMocks();
  ctorSpy.mockClear();
});

// ---------- tests ----------

describe("createClient", () => {
  it("sets maxRetries 1 and timeout 30000 with the given key", () => {
    const c = createClient(FAKE_KEY);
    expect(c).toBeInstanceOf(Anthropic);
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(ctorSpy.mock.calls[0]![0]).toMatchObject({
      apiKey: FAKE_KEY,
      maxRetries: 1,
      timeout: 30_000,
      logLevel: "off",
    });
  });

  it("pins the base URL even when ANTHROPIC_BASE_URL is set in the env", () => {
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://evil.zz";
    try {
      const c = createClient(FAKE_KEY);
      expect(c.baseURL).toBe(ANTHROPIC_BASE_URL);
      expect(ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = prev;
    }
  });

  it("refuses an empty key without echoing anything", () => {
    expect(() => createClient("")).toThrow();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("never logs the key", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    createClient(FAKE_KEY);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(FAKE_KEY);
    }
  });
});

describe("buildParams", () => {
  it("Haiku params are exactly rule 1", () => {
    expect(haikuParams()).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: MAX_TOKENS,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: MSGS,
    });
    expect(MAX_TOKENS).toBe(1024);
  });

  it("Sonnet adds betas and fallbacks", () => {
    expect(buildParams("claude-sonnet-5-5", "medium", SYSTEM, MSGS)).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: MSGS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  });

  it.each(["low", "medium", "high"] as const)(
    "effort %s comes from the argument",
    (e) => {
      expect(
        buildParams("claude-haiku-5-5", e, SYSTEM, MSGS)["output_config"],
      ).toEqual({
        effort: e,
      });
    },
  );

  it("banned-key deep scan is empty for both models", () => {
    expect(bannedKeys(haikuParams())).toEqual([]);
    expect(
      bannedKeys(buildParams("claude-sonnet-5-5", "low", SYSTEM, MSGS)),
    ).toEqual([]);
  });

  it("throws when the last turn is the assistant (no prefill)", () => {
    expect(() =>
      buildParams("claude-haiku-5-5", "low", SYSTEM, [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Sure, here" },
      ]),
    ).toThrow();
    expect(() => buildParams("claude-haiku-5-5", "low", SYSTEM, [])).toThrow();
  });

  it("does not share mutable input arrays", () => {
    const p = haikuParams();
    expect(p["messages"]).not.toBe(MSGS);
    expect(p["system"]).not.toBe(SYSTEM);
  });

  it("rejects a model outside the allowlist", () => {
    expect(() =>
      buildParams("claude-opus-5-5" as "claude-haiku-5-5", "low", SYSTEM, MSGS),
    ).toThrow();
  });

  it("rejects an ID or timestamp in system", () => {
    for (const text of [
      "Today is 2026-10-13T10:00:00Z",
      "request 123e4567-e89b-12d3-a456-426614174000",
    ]) {
      expect(() =>
        buildParams("claude-haiku-5-5", "low", [{ type: "text", text }], MSGS),
      ).toThrow();
    }
  });
});

describe("streamChat", () => {
  it("uses messages.stream for Haiku with the signal, beta path for Sonnet", async () => {
    const h = fakeClient([
      { event: ev.start },
      { event: ev.delta("end_turn") },
    ]);
    const ac = new AbortController();
    await collect(streamChat(h.client, haikuParams(), ac.signal));
    expect(h.make).toHaveBeenCalledTimes(1);
    expect(h.betaMake).not.toHaveBeenCalled();
    // The SDK gets the stall guard's signal, linked to the caller's.
    const passed = (h.make.mock.calls[0]![1] as { signal: AbortSignal }).signal;
    expect(Object.keys(h.make.mock.calls[0]![1] as object)).toEqual(["signal"]);
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed.aborted).toBe(false); // linkage: see the stall guard tests

    const so = fakeClient([
      { event: ev.start },
      { event: ev.delta("end_turn") },
    ]);
    await collect(
      streamChat(
        so.client,
        buildParams("claude-sonnet-5-5", "low", SYSTEM, MSGS),
        sig(),
      ),
    );
    expect(so.betaMake).toHaveBeenCalledTimes(1);
    expect(so.make).not.toHaveBeenCalled();
    expect(so.betaMake.mock.calls[0]![0]).toMatchObject({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  });

  it("refuses to stream prefilled params", async () => {
    const f = fakeClient([]);
    const bad = {
      ...haikuParams(),
      messages: [{ role: "assistant", content: "x" }],
    };
    await expect(collect(streamChat(f.client, bad, sig()))).rejects.toThrow();
    expect(f.make).not.toHaveBeenCalled();
  });

  it("yields text deltas in order, ignoring thinking, ping and unknown events", async () => {
    const f = fakeClient(
      [
        { event: ev.start },
        { event: ev.ping },
        { event: ev.blockStart },
        { event: ev.thinking },
        { event: ev.text("Hel") },
        { event: ev.unknown },
        { event: ev.text("lo") },
        { event: ev.ping },
        { event: ev.text("!") },
        { event: ev.delta("end_turn") },
        { event: ev.stop },
      ],
      { final: () => Promise.resolve(finalMsg("end_turn", 7)) },
    );
    const out = await collect(streamChat(f.client, haikuParams(), sig()));
    expect(out).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "text", text: "!" },
      {
        type: "end",
        outcome: {
          stopReason: "end_turn",
          usage: { ...usageStart, output_tokens: 7 },
        },
      },
    ]);
  });

  it.each(["end_turn", "max_tokens", "stop_sequence", "pause_turn"])(
    "end carries stop_reason %s and usage incl. cache reads",
    async (stop) => {
      const f = fakeClient(
        [
          { event: ev.start },
          { event: ev.text("a") },
          { event: ev.delta(stop) },
        ],
        { final: () => Promise.resolve(finalMsg(stop)) },
      );
      const out = await collect(streamChat(f.client, haikuParams(), sig()));
      const end = out.at(-1)!;
      expect(end.type).toBe("end");
      if (end.type !== "end") return;
      expect(end.outcome.stopReason).toBe(stop);
      expect(end.outcome.usage?.cache_read_input_tokens).toBe(1100);
      expect(out.some((e) => e.type === "reset")).toBe(false);
    },
  );

  it("refusal mid-stream yields reset after partial text, then end, and drops later text", async () => {
    const f = fakeClient(
      [
        { event: ev.start },
        { event: ev.text("partial ") },
        { event: ev.text("answer") },
        { event: ev.delta("refusal", 5) },
        { event: ev.text("late") },
        { event: ev.stop },
      ],
      { final: () => Promise.resolve(finalMsg("refusal", 5)) },
    );
    const out = await collect(streamChat(f.client, haikuParams(), sig()));
    expect(out.map((e) => e.type)).toEqual(["text", "text", "reset", "end"]);
    const end = out.at(-1)!;
    if (end.type !== "end") throw new Error("no end");
    expect(end.outcome.stopReason).toBe("refusal");
    expect(end.outcome.usage?.cache_read_input_tokens).toBe(1100);
  });

  it("refusal only visible in finalMessage still yields one reset", async () => {
    const f = fakeClient([{ event: ev.start }, { event: ev.text("x") }], {
      final: () => Promise.resolve(finalMsg("refusal")),
    });
    const out = await collect(streamChat(f.client, haikuParams(), sig()));
    expect(out.map((e) => e.type)).toEqual(["text", "reset", "end"]);
  });

  it("falls back to last message_delta usage when finalMessage fails", async () => {
    const f = fakeClient(
      [
        { event: ev.start },
        { event: ev.text("a") },
        { event: ev.delta("max_tokens", 1024) },
      ],
      { final: () => Promise.reject(new Error("boom")) },
    );
    const out = await collect(streamChat(f.client, haikuParams(), sig()));
    const end = out.at(-1)!;
    if (end.type !== "end") throw new Error("no end");
    expect(end.outcome.stopReason).toBe("max_tokens");
    expect(end.outcome.usage).toMatchObject({
      input_tokens: 1200,
      output_tokens: 1024,
      cache_read_input_tokens: 1100,
    });
  });

  it.each(typed)("maps %s to errorClass %s", (e, name) => {
    expect(errorClassOf(e)).toBe(name);
  });

  it("does not misread APIConnectionError as a generic APIError", () => {
    const e = new APIConnectionError({ message: "down" });
    expect(e).toBeInstanceOf(APIError);
    expect(errorClassOf(e)).toBe("APIConnectionError");
  });

  it("maps classes to upstream vs unavailable codes", () => {
    for (const c of [
      "BadRequestError",
      "AuthenticationError",
      "PermissionDeniedError",
      "NotFoundError",
    ]) {
      expect(upstreamCodeOf(c)).toBe("unavailable");
    }
    for (const c of [
      "RateLimitError",
      "InternalServerError",
      "APIConnectionError",
      "APIConnectionTimeoutError",
      "APIError",
      "Unknown",
    ]) {
      expect(upstreamCodeOf(c)).toBe("upstream");
    }
  });

  it("an error before the first delta has beforeFirstToken true", async () => {
    const f = fakeClient([
      { event: ev.start },
      { throw: new RateLimitError(429, {}, "slow down", headers) },
    ]);
    const err = await collect(streamChat(f.client, haikuParams(), sig())).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatUpstreamError);
    const ce = err as ChatUpstreamError;
    expect(ce.errorClass).toBe("RateLimitError");
    expect(ce.beforeFirstToken).toBe(true);
    expect(ce.code).toBe("upstream");
    expect(ce.message).not.toContain("slow down");
  });

  it("a mid-stream overloaded_error event after a delta has beforeFirstToken false", async () => {
    const overloaded = new APIError(
      undefined,
      {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      },
      undefined,
      undefined,
      "overloaded_error",
    );
    const f = fakeClient([
      { event: ev.start },
      { event: ev.text("hi") },
      { throw: overloaded },
    ]);
    const seen: ChatStreamEvent[] = [];
    const err = await (async () => {
      for await (const e of streamChat(f.client, haikuParams(), sig()))
        seen.push(e);
    })().catch((e: unknown) => e);
    expect(seen).toEqual([{ type: "text", text: "hi" }]);
    expect(err).toBeInstanceOf(ChatUpstreamError);
    const ce = err as ChatUpstreamError;
    expect(ce.errorClass).toBe("APIError");
    expect(ce.beforeFirstToken).toBe(false);
    expect(ce.message).not.toContain("Overloaded");
  });

  it("an error thrown synchronously by stream() is wrapped", async () => {
    const client = {
      messages: {
        stream: () => {
          throw new AuthenticationError(401, {}, "invalid x-api-key", headers);
        },
      },
    } as unknown as Anthropic;
    const err = await collect(streamChat(client, haikuParams(), sig())).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatUpstreamError);
    expect((err as ChatUpstreamError).errorClass).toBe("AuthenticationError");
    expect((err as ChatUpstreamError).code).toBe("unavailable");
    expect((err as ChatUpstreamError).beforeFirstToken).toBe(true);
  });

  it("never logs anything on errors", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const f = fakeClient([
      { throw: new InternalServerError(500, {}, "x", headers) },
    ]);
    await collect(streamChat(f.client, haikuParams(), sig())).catch(() => {});
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("abort stops iteration and ends without throwing", async () => {
    const ac = new AbortController();
    const f = fakeClient([{ event: ev.start }, { event: ev.text("a") }], {
      waitForAbort: true,
    });
    const seen: ChatStreamEvent[] = [];
    for await (const e of streamChat(f.client, haikuParams(), ac.signal)) {
      seen.push(e);
      if (e.type === "text") ac.abort();
    }
    expect(seen.map((e) => e.type)).toEqual(["text", "end"]);
    const end = seen.at(-1)!;
    if (end.type !== "end") throw new Error("no end");
    expect(end.outcome).toMatchObject({
      stopReason: null,
      errorClass: "APIUserAbortError",
    });
    expect(end.outcome.usage?.input_tokens).toBe(1200);
    expect(f.stream().finalMessage).not.toHaveBeenCalled();
  });

  it("an already-aborted signal does not open a stream", async () => {
    const ac = new AbortController();
    ac.abort();
    const f = fakeClient([{ event: ev.text("a") }]);
    const out = await collect(streamChat(f.client, haikuParams(), ac.signal));
    expect(f.make).not.toHaveBeenCalled();
    expect(out).toEqual([
      {
        type: "end",
        outcome: {
          stopReason: null,
          usage: null,
          errorClass: "APIUserAbortError",
        },
      },
    ]);
  });

  it("breaking out early aborts the SDK stream", async () => {
    const f = fakeClient([
      { event: ev.start },
      { event: ev.text("a") },
      { event: ev.text("b") },
    ]);
    for await (const e of streamChat(f.client, haikuParams(), sig())) {
      if (e.type === "text") break;
    }
    expect(f.stream().abort).toHaveBeenCalled();
  });
});

describe("REFUSAL_REPLY", () => {
  it("is friendly third-person copy pointing to the contact options", () => {
    expect(REFUSAL_REPLY).toMatch(/Anderson/);
    expect(REFUSAL_REPLY).not.toMatch(/\bI'm Anderson\b|\bmy (resume|work)\b/i);
    expect(REFUSAL_REPLY).toMatch(/email|LinkedIn|GitHub/);
    expect(REFUSAL_REPLY.length).toBeLessThan(400);
  });
});

// ---------- real SDK MessageStream over a fake fetch (no network) ----------

function sse(frames: [string, unknown][]): string {
  return frames
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

const msgStart = {
  type: "message_start",
  message: {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    usage: usageStart,
  },
};

function realClient(body: string) {
  const fetch = vi.fn(async () => {
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // Small chunks so events arrive over several reads.
        for (let i = 0; i < bytes.length; i += 64)
          c.enqueue(bytes.slice(i, i + 64));
        c.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "request-id": "req_fake",
      },
    });
  });
  const client = new Anthropic({
    apiKey: FAKE_KEY,
    maxRetries: 0,
    logLevel: "off",
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { client, fetch };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function consume(it: AsyncIterable<ChatStreamEvent>, delayMs: number) {
  const seen: ChatStreamEvent[] = [];
  let error: unknown;
  try {
    for await (const e of it) {
      seen.push(e);
      if (delayMs) await sleep(delayMs);
    }
  } catch (e) {
    error = e;
  }
  return { seen, error };
}

describe("streamChat with the real SDK MessageStream", () => {
  const errorBody = sse([
    ["message_start", msgStart],
    ["content_block_start", ev.blockStart],
    ["content_block_delta", ev.text("Hello")],
    ["ping", { type: "ping" }],
    [
      "error",
      {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      },
    ],
  ]);

  it.each([
    ["fast", 0],
    ["slow", 50],
  ])(
    "a mid-stream SSE error surfaces as ChatUpstreamError (%s consumer)",
    async (_n, delay) => {
      const { client, fetch } = realClient(errorBody);
      const { seen, error } = await consume(
        streamChat(client, haikuParams(), sig()),
        delay,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([{ type: "text", text: "Hello" }]);
      expect(error).toBeInstanceOf(ChatUpstreamError);
      const ce = error as ChatUpstreamError;
      expect(ce.errorClass).toBe("APIError");
      expect(ce.beforeFirstToken).toBe(false);
      expect(ce.code).toBe("upstream");
      expect(ce.message).not.toContain("Overloaded");
    },
  );

  it("an SSE error before any text has beforeFirstToken true (slow consumer)", async () => {
    const { client } = realClient(
      sse([
        ["message_start", msgStart],
        [
          "error",
          { type: "error", error: { type: "overloaded_error", message: "x" } },
        ],
      ]),
    );
    const { seen, error } = await consume(
      streamChat(client, haikuParams(), sig()),
      50,
    );
    expect(seen).toEqual([]);
    expect(error).toBeInstanceOf(ChatUpstreamError);
    expect((error as ChatUpstreamError).beforeFirstToken).toBe(true);
  });

  it.each([
    ["fast", 0],
    ["slow", 50],
  ])(
    "a complete stream ends with stop_reason and usage (%s consumer)",
    async (_n, delay) => {
      const { client } = realClient(
        sse([
          ["message_start", msgStart],
          ["content_block_start", ev.blockStart],
          ["content_block_delta", ev.text("Hi ")],
          ["content_block_delta", ev.text("there")],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", ev.delta("end_turn", 9)],
          ["message_stop", ev.stop],
        ]),
      );
      const { seen, error } = await consume(
        streamChat(client, haikuParams(), sig()),
        delay,
      );
      expect(error).toBeUndefined();
      expect(seen.map((e) => e.type)).toEqual(["text", "text", "end"]);
      const end = seen.at(-1)!;
      if (end.type !== "end") throw new Error("no end");
      expect(end.outcome.stopReason).toBe("end_turn");
      expect(end.outcome.usage).toMatchObject({
        output_tokens: 9,
        cache_read_input_tokens: 1100,
      });
    },
  );
});

describe("abort during finalMessage", () => {
  it.each([
    ["rejects", true],
    ["resolves", false],
  ])("is reported as an abort when finalMessage %s", async (_n, rejects) => {
    const ac = new AbortController();
    const f = fakeClient([{ event: ev.start }, { event: ev.text("a") }], {
      final: () => {
        ac.abort();
        return rejects
          ? Promise.reject(new APIUserAbortError())
          : Promise.resolve(finalMsg("end_turn"));
      },
    });
    const out = await collect(streamChat(f.client, haikuParams(), ac.signal));
    expect(out.map((e) => e.type)).toEqual(["text", "end"]);
    const end = out.at(-1)!;
    if (end.type !== "end") throw new Error("no end");
    expect(end.outcome).toMatchObject({
      stopReason: null,
      errorClass: "APIUserAbortError",
    });
  });

  it("finalMessage failing with no message_delta stop_reason throws", async () => {
    const f = fakeClient([{ event: ev.start }, { event: ev.text("a") }], {
      final: () =>
        Promise.reject(
          new APIError(undefined, {}, "x", undefined, "overloaded_error"),
        ),
    });
    const err = await collect(streamChat(f.client, haikuParams(), sig())).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatUpstreamError);
    expect((err as ChatUpstreamError).beforeFirstToken).toBe(false);
  });
});

describe("volatile system content check", () => {
  const ok = (text: string) =>
    buildParams("claude-haiku-5-5", "low", [{ type: "text", text }], MSGS);

  it("accepts the real KB-built system text", () => {
    const kb = buildKb(loadKbSources());
    expect(kb.length).toBeGreaterThan(100);
    expect(() => ok(kb)).not.toThrow();
  });

  it.each([
    "updated: 2026-10-13",
    "From 2019-06-01 to 2024-12-31",
    "version 2026-10-13 12",
    "sha deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    "beta server-side-fallback-2026-07-01",
    "range 1234-5678",
  ])("does not false-positive on %j", (text) => {
    expect(() => ok(text)).not.toThrow();
  });

  it.each([
    "2026-10-13T10:00:00Z",
    "2026-10-13T10:00",
    "2026-10-13 10:00:00.123+02:00",
    "at 2026-10-13T23:59:59-0500.",
    "id 123E4567-E89B-12D3-A456-426614174000",
    "(f47ac10b-58cc-4372-a567-0e02b2c3d479)",
  ])("rejects %j", (text) => {
    expect(() => ok(text)).toThrow();
  });
});

describe("an SSE error after a message_delta stop_reason (real MessageStream)", () => {
  const overloadedFrame: [string, unknown] = [
    "error",
    {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    },
  ];
  const head: [string, unknown][] = [
    ["message_start", msgStart],
    ["content_block_start", ev.blockStart],
    ["content_block_delta", ev.text("partial")],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ];

  it.each([
    ["fast", 0],
    ["slow", 50],
  ])(
    "refusal then error: reset and a clean end{refusal} with usage (%s consumer)",
    async (_n, delay) => {
      const { client } = realClient(
        sse([
          ...head,
          ["message_delta", ev.delta("refusal", 6)],
          overloadedFrame,
        ]),
      );
      const { seen, error } = await consume(
        streamChat(client, haikuParams(), sig()),
        delay,
      );
      expect(error).toBeUndefined();
      expect(seen.map((e) => e.type)).toEqual(["text", "reset", "end"]);
      const end = seen.at(-1)!;
      if (end.type !== "end") throw new Error("no end");
      expect(end.outcome.stopReason).toBe("refusal");
      expect(end.outcome.errorClass).toBeUndefined();
      expect(end.outcome.usage).toMatchObject({
        input_tokens: 1200,
        output_tokens: 6,
        cache_read_input_tokens: 1100,
      });
    },
  );

  it.each([
    ["fast", 0],
    ["slow", 50],
  ])(
    "end_turn then error before message_stop: a clean end{end_turn} with usage (%s consumer)",
    async (_n, delay) => {
      const { client } = realClient(
        sse([
          ...head,
          ["message_delta", ev.delta("end_turn", 11)],
          overloadedFrame,
        ]),
      );
      const { seen, error } = await consume(
        streamChat(client, haikuParams(), sig()),
        delay,
      );
      expect(error).toBeUndefined();
      expect(seen.map((e) => e.type)).toEqual(["text", "end"]);
      const end = seen.at(-1)!;
      if (end.type !== "end") throw new Error("no end");
      expect(end.outcome.stopReason).toBe("end_turn");
      expect(end.outcome.errorClass).toBeUndefined();
      expect(end.outcome.usage).toMatchObject({
        input_tokens: 1200,
        output_tokens: 11,
        cache_read_input_tokens: 1100,
      });
    },
  );

  it.each([
    ["fast", 0],
    ["slow", 50],
  ])(
    "an error before any message_delta still throws (%s consumer)",
    async (_n, delay) => {
      const { client } = realClient(sse([...head, overloadedFrame]));
      const { seen, error } = await consume(
        streamChat(client, haikuParams(), sig()),
        delay,
      );
      expect(seen.map((e) => e.type)).toEqual(["text"]);
      expect(error).toBeInstanceOf(ChatUpstreamError);
      expect((error as ChatUpstreamError).beforeFirstToken).toBe(false);
    },
  );

  it("fake iterable: a throw after a stop_reason delta ends cleanly", async () => {
    const f = fakeClient(
      [
        { event: ev.start },
        { event: ev.text("a") },
        { event: ev.delta("end_turn", 3) },
        {
          throw: new APIError(
            undefined,
            {},
            "x",
            undefined,
            "overloaded_error",
          ),
        },
      ],
      { final: () => Promise.reject(new Error("stream errored")) },
    );
    const out = await collect(streamChat(f.client, haikuParams(), sig()));
    expect(out.at(-1)).toMatchObject({
      type: "end",
      outcome: { stopReason: "end_turn", usage: { output_tokens: 3 } },
    });
  });
});

// ---------- stream stall guard (P4-13e) ----------

describe("stream stall guard", () => {
  type Timed = { event: unknown; afterMs: number };

  // A stream whose events arrive on a (fake) clock. After the last event it either
  // completes or, with `hang`, never yields again and ignores abort: the guard must
  // not depend on the SDK honouring the signal.
  function timedClient(steps: Timed[], opts: { hang?: boolean } = {}) {
    const abort = vi.fn();
    const signals: AbortSignal[] = [];
    const make = vi.fn((_p: unknown, o?: { signal?: AbortSignal }) => {
      if (o?.signal) signals.push(o.signal);
      return {
        abort,
        finalMessage: () => Promise.resolve(finalMsg("end_turn")),
        async *[Symbol.asyncIterator]() {
          for (const s of steps) {
            await new Promise((r) => setTimeout(r, s.afterMs));
            yield s.event;
          }
          if (opts.hang) await new Promise<never>(() => {});
        },
      };
    });
    const client = {
      messages: { stream: make },
      beta: { messages: { stream: make } },
    } as unknown as Anthropic;
    return { client, abort, signals };
  }

  async function run(
    gen: AsyncIterable<ChatStreamEvent>,
    advanceMs: number,
  ): Promise<{ events: ChatStreamEvent[]; error: unknown; settledAt: number }> {
    const events: ChatStreamEvent[] = [];
    let error: unknown;
    let settledAt = -1;
    const t0 = Date.now();
    const p = (async () => {
      try {
        for await (const e of gen) events.push(e);
      } catch (e) {
        error = e;
      } finally {
        settledAt = Date.now() - t0;
      }
    })();
    for (let t = 0; t < advanceMs && settledAt < 0; t += 500) {
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(0);
    if (settledAt < 0) throw new Error("stream did not settle");
    await p;
    return { events, error, settledAt };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports the named limits (idle 20 s, total 60 s)", () => {
    expect(STREAM_IDLE_MS).toBe(20_000);
    expect(STREAM_TOTAL_MS).toBe(60_000);
    expect(STREAM_TOTAL_MS).toBeGreaterThan(STREAM_IDLE_MS);
  });

  it("message_start then nothing: aborts after the idle limit with a typed timeout", async () => {
    vi.useFakeTimers();
    const f = timedClient([{ event: ev.start, afterMs: 10 }], { hang: true });
    const { events, error, settledAt } = await run(
      streamChat(f.client, haikuParams(), sig()),
      STREAM_TOTAL_MS * 2,
    );
    expect(events).toEqual([]);
    expect(error).toBeInstanceOf(ChatStreamTimeoutError);
    expect(error).toBeInstanceOf(ChatUpstreamError);
    const e = error as ChatStreamTimeoutError;
    expect(e.reason).toBe("idle");
    expect(e.causeCode).toBe("stream_timeout");
    expect(e.errorClass).toBe("StreamTimeoutError");
    expect(e.code).toBe("upstream");
    expect(e.beforeFirstToken).toBe(true);
    // Fires at the idle limit, well before the total deadline.
    expect(settledAt).toBeGreaterThanOrEqual(STREAM_IDLE_MS);
    expect(settledAt).toBeLessThan(STREAM_IDLE_MS + 1_000);
    expect(f.abort).toHaveBeenCalled();
    expect(f.signals[0]!.aborted).toBe(true);
  });

  it("an idle stall after text reports beforeFirstToken false", async () => {
    vi.useFakeTimers();
    const f = timedClient(
      [
        { event: ev.start, afterMs: 10 },
        { event: ev.text("Hi"), afterMs: 10 },
      ],
      { hang: true },
    );
    const { events, error } = await run(
      streamChat(f.client, haikuParams(), sig()),
      STREAM_TOTAL_MS * 2,
    );
    expect(events).toEqual([{ type: "text", text: "Hi" }]);
    expect(error).toBeInstanceOf(ChatStreamTimeoutError);
    expect((error as ChatStreamTimeoutError).beforeFirstToken).toBe(false);
  });

  it("a slow but steady stream (an event every 5 s for 50 s) completes", async () => {
    vi.useFakeTimers();
    const steps: Timed[] = [{ event: ev.start, afterMs: 5_000 }];
    for (let i = 0; i < 8; i++)
      steps.push({ event: ev.text(`w${i} `), afterMs: 5_000 });
    steps.push({ event: ev.delta("end_turn"), afterMs: 5_000 });
    steps.push({ event: ev.stop, afterMs: 0 });
    const f = timedClient(steps);
    const { events, error, settledAt } = await run(
      streamChat(f.client, haikuParams(), sig()),
      STREAM_TOTAL_MS * 2,
    );
    expect(error).toBeUndefined();
    expect(settledAt).toBeGreaterThanOrEqual(50_000);
    expect(events.filter((e) => e.type === "text")).toHaveLength(8);
    expect(events.at(-1)).toMatchObject({
      type: "end",
      outcome: { stopReason: "end_turn" },
    });
    expect(f.abort).not.toHaveBeenCalled();
  });

  it("a steady stream past the total deadline aborts with reason total", async () => {
    vi.useFakeTimers();
    const steps: Timed[] = [{ event: ev.start, afterMs: 1_000 }];
    for (let i = 0; i < 40; i++)
      steps.push({ event: ev.text("x"), afterMs: 5_000 });
    const f = timedClient(steps);
    const { error, settledAt } = await run(
      streamChat(f.client, haikuParams(), sig()),
      STREAM_TOTAL_MS * 3,
    );
    expect(error).toBeInstanceOf(ChatStreamTimeoutError);
    expect((error as ChatStreamTimeoutError).reason).toBe("total");
    expect(settledAt).toBeGreaterThanOrEqual(STREAM_TOTAL_MS);
    expect(settledAt).toBeLessThan(STREAM_TOTAL_MS + 1_000);
    expect(f.abort).toHaveBeenCalled();
  });

  it("no event at all: the total deadline still ends the stream", async () => {
    vi.useFakeTimers();
    const f = timedClient([], { hang: true });
    const { error, settledAt } = await run(
      streamChat(f.client, haikuParams(), sig()),
      STREAM_TOTAL_MS * 2,
    );
    expect(error).toBeInstanceOf(ChatStreamTimeoutError);
    expect((error as ChatStreamTimeoutError).reason).toBe("total");
    expect(settledAt).toBeLessThan(STREAM_TOTAL_MS + 1_000);
  });

  it("a caller abort during a stall is an abort, not a timeout", async () => {
    vi.useFakeTimers();
    const f = timedClient([{ event: ev.start, afterMs: 10 }], { hang: true });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5_000);
    const { events, error } = await run(
      streamChat(f.client, haikuParams(), ac.signal),
      STREAM_TOTAL_MS * 2,
    );
    expect(error).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: "end",
      outcome: { stopReason: null, errorClass: "APIUserAbortError" },
    });
    // The caller's abort reaches the SDK through the guard's linked signal.
    expect(f.signals[0]!.aborted).toBe(true);
  });

  it("clears its timers once the stream ends", async () => {
    vi.useFakeTimers();
    const f = timedClient([
      { event: ev.start, afterMs: 10 },
      { event: ev.text("ok"), afterMs: 10 },
      { event: ev.delta("end_turn"), afterMs: 10 },
    ]);
    await run(streamChat(f.client, haikuParams(), sig()), 5_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a non-Anthropic cause is reduced to a short code, never a message", async () => {
    const cause = Object.assign(new Error("socket hang up sk-ant-secret"), {
      code: "UND_ERR_SOCKET",
    });
    const wrapped = Object.assign(new AnthropicErrorCtor("terminated"), {
      cause,
    });
    const f = fakeClient([{ event: ev.start }, { throw: wrapped }]);
    const err = await collect(streamChat(f.client, haikuParams(), sig())).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatUpstreamError);
    expect((err as ChatUpstreamError).errorClass).toBe("AnthropicError");
    expect((err as ChatUpstreamError).causeCode).toBe("UND_ERR_SOCKET");
    expect(JSON.stringify(err)).not.toContain("sk-ant");
    expect(String((err as Error).message)).not.toContain("socket");
  });

  it("a cause with an unsafe code falls back to its name, then to nothing", () => {
    const odd = Object.assign(new AnthropicErrorCtor("x"), {
      cause: { code: "has spaces and a key sk-ant-1", name: "TypeError" },
    });
    expect(causeCodeOf(odd)).toBe("TypeError");
    expect(causeCodeOf(new AnthropicErrorCtor("x"))).toBeUndefined();
    expect(causeCodeOf("string")).toBeUndefined();
  });
});
