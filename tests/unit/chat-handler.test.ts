// POST /api/chat orchestration against injected fakes. The SDK, Upstash and BotID
// modules are mocked so that reaching any real client records a failure (rule 5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reached = vi.hoisted(() => [] as string[]);

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Forbidden {
    constructor() {
      reached.push("anthropic");
      throw new Error("real Anthropic client constructed in a test");
    }
  }
  return { ...actual, default: Forbidden, Anthropic: Forbidden };
});
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      reached.push("redis");
      throw new Error("real Redis constructed in a test");
    }
  },
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    constructor() {
      reached.push("ratelimit");
      throw new Error("real Ratelimit constructed in a test");
    }
    static slidingWindow() {
      reached.push("ratelimit");
      throw new Error("real Ratelimit used in a test");
    }
  },
}));
vi.mock("botid/server", () => ({
  checkBotId: async () => {
    reached.push("botid");
    throw new Error("real BotID reached in a test");
  },
}));

import type Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  InternalServerError,
} from "@anthropic-ai/sdk";
import type { APIContext } from "astro";
import {
  BOT_TIMEOUT_MS,
  createChatHandler,
  type ChatDeps,
  type TestOnlyControls,
} from "../../src/lib/server/chat-handler.ts";
import {
  MAX_TOKENS,
  REFUSAL_REPLY,
  STREAM_IDLE_MS,
} from "../../src/lib/server/anthropic.ts";
import type { BudgetStore } from "../../src/lib/server/budget.ts";
import { getEnv, type ChatEnv } from "../../src/lib/server/env.ts";
import type { ChatMetric } from "../../src/lib/server/log.ts";
import {
  costMicroUsd,
  worstCaseCostMicroUsd,
} from "../../src/lib/server/pricing.ts";
import { hashIp, type Limiter } from "../../src/lib/server/ratelimit.ts";
import { scrub } from "../../src/lib/server/scrub.ts";
import { SSE_HEADERS } from "../../src/lib/server/sse.ts";

// ---------- fixtures ----------

const SECRET_KEY = "sk-ant-SENTINEL-KEY-0000";
const SALT = "s".repeat(40);
const ENV: ChatEnv = {
  anthropicApiKey: SECRET_KEY,
  upstashUrl: "https://upstash.test",
  upstashToken: "SENTINEL-TOKEN",
  ipHashSalt: SALT,
  chatModel: "claude-haiku-5-5",
  chatEffort: "low",
  dailyBudgetUsd: 1,
};
const IP = "203.0.113.77";
const QUESTION = "SENTINEL-QUESTION what does Anderson test?";
const SESSION = "session_SENTINEL_1234";
const SYSTEM_PROMPT = "You are Blob. KB: https://github.com/avanegas95";
const KB_URLS = ["https://github.com/avanegas95"];
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

const BODY = {
  messages: [{ role: "user", content: QUESTION }],
  sessionId: SESSION,
};

type Ev = Record<string, unknown>;
const start = (input = 1200): Ev => ({
  type: "message_start",
  message: {
    usage: {
      input_tokens: input,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
});
const text = (t: string): Ev => ({
  type: "content_block_delta",
  delta: { type: "text_delta", text: t },
});
const stop = (reason: string, out = 40): Ev => ({
  type: "message_delta",
  delta: { stop_reason: reason },
  usage: { output_tokens: out },
});
const USAGE = {
  input_tokens: 200,
  output_tokens: 40,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 0,
};

type Step = Ev | { throw: unknown } | { hang: true };
type Script = {
  steps: Step[];
  final?: () => Promise<unknown>;
  throwOnCreate?: unknown;
};

function fakeAnthropic(script: Script) {
  const signals: AbortSignal[] = [];
  const params: Record<string, unknown>[] = [];
  const abort = vi.fn();
  const make = vi.fn(
    (p: Record<string, unknown>, o: { signal: AbortSignal }) => {
      if (script.throwOnCreate) throw script.throwOnCreate;
      params.push(p);
      signals.push(o.signal);
      const signal = o.signal;
      return {
        abort,
        finalMessage:
          script.final ??
          (() => Promise.resolve({ stop_reason: "end_turn", usage: USAGE })),
        async *[Symbol.asyncIterator]() {
          for (const s of script.steps) {
            await Promise.resolve();
            if ("throw" in s) throw s.throw;
            if ("hang" in s) {
              await new Promise<void>((_, reject) => {
                const fail = () => reject(new APIUserAbortError());
                if (signal.aborted) fail();
                else signal.addEventListener("abort", fail, { once: true });
              });
            }
            yield s;
          }
        },
      };
    },
  );
  const client = {
    messages: { stream: make },
    beta: { messages: { stream: make } },
  } as unknown as Anthropic;
  return { client, make, signals, params, abort };
}

const pass = (): Limiter => ({
  limit: vi.fn(async () => ({ success: true, reset: NOW + 60_000 })),
});
const deny = (resetInMs: number): Limiter => ({
  limit: vi.fn(async () => ({ success: false, reset: NOW + resetInMs })),
});

function memStore(initial: unknown = null) {
  let value = initial;
  const store = {
    get: vi.fn(async () => value),
    incrby: vi.fn(async (_k: string, n: number) => {
      value = (typeof value === "number" ? value : 0) + n;
      return value as number;
    }),
    expire: vi.fn(async () => 1),
  };
  return store satisfies BudgetStore;
}

type Harness = {
  deps: ChatDeps;
  sdk: ReturnType<typeof fakeAnthropic>;
  store: ReturnType<typeof memStore>;
  limiters: { ipMinute: Limiter; ipDay: Limiter; globalDay: Limiter };
  logs: ChatMetric[];
  botCheck: ReturnType<typeof vi.fn>;
  waitUntil: ReturnType<typeof vi.fn<(p: Promise<unknown>) => void>>;
};

function harness(
  script: Script = {
    steps: [start(), text("<mood>excited</mood> Hi there."), stop("end_turn")],
  },
  over: Partial<ChatDeps> = {},
): Harness {
  const sdk = fakeAnthropic(script);
  const store = memStore();
  const limiters = { ipMinute: pass(), ipDay: pass(), globalDay: pass() };
  const logs: ChatMetric[] = [];
  const botCheck = vi.fn(async () => ({ isBot: false }));
  const waitUntil = vi.fn<(p: Promise<unknown>) => void>();
  const deps: ChatDeps = {
    env: () => ({ ok: true, env: ENV }),
    botCheck,
    waitUntil,
    limiters: () => limiters,
    budgetStore: () => store,
    anthropic: () => sdk.client,
    systemPrompt: () => SYSTEM_PROMPT,
    kbUrls: () => KB_URLS,
    log: (m) => logs.push(structuredClone(m)),
    now: () => NOW,
    ...over,
  };
  return { deps, sdk, store, limiters, logs, botCheck, waitUntil };
}

function request(
  init: {
    body?: unknown;
    raw?: BodyInit;
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Request {
  const method = init.method ?? "POST";
  return new Request("https://site.test/api/chat", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://site.test",
      ...init.headers,
    },
    ...(method === "GET" || method === "HEAD"
      ? {}
      : {
          body: init.raw ?? JSON.stringify(init.body ?? BODY),
          duplex: "half",
        }),
    ...(init.signal ? { signal: init.signal } : {}),
  } as RequestInit);
}

function ctx(req: Request, ip: string | (() => string) = IP): APIContext {
  return {
    request: req,
    get clientAddress() {
      return typeof ip === "function" ? ip() : ip;
    },
  } as unknown as APIContext;
}

async function call(
  h: Harness,
  req: Request = request(),
  testOnly?: TestOnlyControls,
  ip?: string | (() => string),
): Promise<Response> {
  const handler = createChatHandler(h.deps, testOnly);
  return handler(ctx(req, ip));
}

type Sse = { event: string; data: Record<string, unknown> };
function parseSse(body: string): Sse[] {
  return body
    .split("\n\n")
    .filter((b) => b.trim() !== "")
    .map((b) => {
      const [e, d] = b.split("\n");
      return {
        event: e!.replace(/^event: /, ""),
        data: JSON.parse(d!.replace(/^data: /, "")) as Record<string, unknown>,
      };
    });
}
const deltas = (evs: Sse[]): string =>
  evs
    .filter((e) => e.event === "delta")
    .map((e) => e.data["text"])
    .join("");

async function readSse(res: Response): Promise<Sse[]> {
  return parseSse(await res.text());
}

const worstCase = () =>
  worstCaseCostMicroUsd(
    ENV.chatModel,
    new TextEncoder().encode(SYSTEM_PROMPT).byteLength +
      new TextEncoder().encode(JSON.stringify(BODY.messages)).byteLength,
    MAX_TOKENS,
  );

function expectNoSecretsLogged(logs: ChatMetric[]): void {
  const line = JSON.stringify(logs);
  for (const s of [QUESTION, "SENTINEL", IP, SESSION, SECRET_KEY, SALT])
    expect(line).not.toContain(s);
  expect(line).not.toContain(hashIp(IP, SALT));
}

beforeEach(() => {
  reached.length = 0;
});
afterEach(() => {
  expect(reached).toEqual([]);
  vi.useRealTimers();
});

// ---------- happy path ----------

describe("happy path", () => {
  it("streams mood, scrubbed deltas and done; charges real usage; logs one metric", async () => {
    const h = harness({
      steps: [
        start(),
        text("<mood>exc"),
        text("ited</mood> Anderson "),
        text("builds test "),
        text("rigs."),
        stop("end_turn"),
      ],
    });
    const res = await call(h);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toEqual(SSE_HEADERS);
    const evs = await readSse(res);
    expect(evs[0]).toEqual({ event: "mood", data: { mood: "excited" } });
    expect(evs.at(-1)).toEqual({ event: "done", data: { usageBucket: "ok" } });
    expect(evs.filter((e) => e.event === "mood")).toHaveLength(1);
    expect(deltas(evs)).toBe("Anderson builds test rigs.");

    const cost = costMicroUsd(ENV.chatModel, USAGE);
    expect(h.store.incrby).toHaveBeenCalledOnce();
    expect(h.store.incrby).toHaveBeenCalledWith(
      "pv3:blob:spend:2026-10-13",
      cost,
    );
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({
      evt: "chat",
      status: 200,
      mood: "excited",
      model: "claude-haiku-5-5",
      turns: 1,
      stopReason: "end_turn",
      costMicroUsd: cost,
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 1000,
    });
    expect(h.logs[0]!.latencyMs).toBeTypeOf("number");
    expect(h.logs[0]!.ttfbMs).toBeTypeOf("number");
    expectNoSecretsLogged(h.logs);
  });

  it("sends rule-6 params with the cached system block and the turns", async () => {
    const h = harness();
    await (await call(h)).text();
    expect(h.sdk.make).toHaveBeenCalledOnce();
    const p = h.sdk.params[0]!;
    expect(p["model"]).toBe("claude-haiku-5-5");
    expect(p["max_tokens"]).toBe(MAX_TOKENS);
    expect(p["output_config"]).toEqual({ effort: "low" });
    expect(p["system"]).toEqual([
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ]);
    expect(p["messages"]).toEqual([{ role: "user", content: QUESTION }]);
  });

  it("keys per-IP limits by the HMAC of clientAddress, global by a constant", async () => {
    const h = harness();
    await (await call(h)).text();
    const key = hashIp(IP, SALT);
    expect(h.limiters.ipMinute.limit).toHaveBeenCalledWith(key);
    expect(h.limiters.ipDay.limit).toHaveBeenCalledWith(key);
    expect(h.limiters.globalDay.limit).toHaveBeenCalledWith("all");
  });

  it("uses 'unknown' when clientAddress throws", async () => {
    const h = harness();
    const res = await call(h, request(), undefined, () => {
      throw new Error("ClientAddressNotAvailable");
    });
    await res.text();
    expect(res.status).toBe(200);
    expect(h.limiters.ipMinute.limit).toHaveBeenCalledWith(
      hashIp("unknown", SALT),
    );
  });

  it("emits the default mood when the reply has no tag, and on an empty reply", async () => {
    const h = harness({
      steps: [start(), text("Plain answer."), stop("end_turn")],
    });
    const evs = await readSse(await call(h));
    expect(evs[0]).toEqual({ event: "mood", data: { mood: "happy" } });
    expect(deltas(evs)).toBe("Plain answer.");

    const empty = harness({ steps: [start(), stop("end_turn")] });
    const evs2 = await readSse(await call(empty));
    expect(evs2.map((e) => e.event)).toEqual(["mood", "done"]);
  });

  it("reports the budget bucket in done", async () => {
    const h = harness();
    h.store.get.mockResolvedValue(950_000);
    const evs = await readSse(await call(h));
    expect(evs.at(-1)).toEqual({ event: "done", data: { usageBucket: "hot" } });
  });

  it("max_tokens ends with done", async () => {
    const h = harness({
      steps: [
        start(),
        text("<mood>proud</mood> Long answer"),
        stop("max_tokens"),
      ],
      final: () => Promise.resolve({ stop_reason: "max_tokens", usage: USAGE }),
    });
    const evs = await readSse(await call(h));
    expect(evs.at(-1)!.event).toBe("done");
    expect(deltas(evs)).toBe("Long answer");
    expect(h.logs[0]!.stopReason).toBe("max_tokens");
  });

  it("uses the beta endpoint path for Sonnet", async () => {
    const h = harness(undefined, {
      env: () => ({
        ok: true,
        env: { ...ENV, chatModel: "claude-sonnet-5-5" },
      }),
    });
    const evs = await readSse(await call(h));
    expect(evs.at(-1)!.event).toBe("done");
    expect(h.sdk.params[0]!["betas"]).toBeDefined();
  });
});

// ---------- negative test per §6 control ----------

describe("controls reject before the SDK is called", () => {
  async function rejected(
    h: Harness,
    res: Response,
    status: number,
    code: string,
  ): Promise<void> {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: { code } });
    expect(h.sdk.make).not.toHaveBeenCalled();
    expect(h.store.incrby).not.toHaveBeenCalled();
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ status, code });
    expectNoSecretsLogged(h.logs);
  }

  it("oversized body -> 413", async () => {
    const h = harness();
    const raw = JSON.stringify({ ...BODY, pad: "x".repeat(9000) });
    await rejected(h, await call(h, request({ raw })), 413, "invalid");
  });

  it("11 turns -> 400", async () => {
    const h = harness();
    const messages = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "hi",
    }));
    await rejected(
      h,
      await call(h, request({ body: { messages, sessionId: SESSION } })),
      400,
      "invalid",
    );
  });

  it("501-char message -> 400", async () => {
    const h = harness();
    const body = {
      messages: [{ role: "user", content: "a".repeat(501) }],
      sessionId: SESSION,
    };
    await rejected(h, await call(h, request({ body })), 400, "invalid");
  });

  it("malformed JSON -> 400", async () => {
    const h = harness();
    await rejected(h, await call(h, request({ raw: "{nope" })), 400, "invalid");
  });

  it("a body stream that errors -> 400, not 500", async () => {
    const h = harness();
    const raw = new ReadableStream({
      pull(c) {
        c.error(new Error("client aborted upload"));
      },
    });
    await rejected(h, await call(h, request({ raw })), 400, "invalid");
  });

  it("wrong content type -> 415", async () => {
    const h = harness();
    const req = request({ headers: { "content-type": "text/plain" } });
    await rejected(h, await call(h, req), 415, "invalid");
  });

  it("cross-site origin -> 403", async () => {
    const h = harness();
    const req = request({ headers: { origin: "https://evil.example" } });
    await rejected(h, await call(h, req), 403, "invalid");
  });

  it("GET -> 405 with allow: POST", async () => {
    const h = harness();
    const res = await call(h, request({ method: "GET" }));
    expect(res.headers.get("allow")).toBe("POST");
    await rejected(h, res, 405, "invalid");
  });

  it("bot -> 403", async () => {
    const h = harness();
    h.botCheck.mockResolvedValue({ isBot: true });
    await rejected(h, await call(h), 403, "bot");
    expect(h.limiters.ipMinute.limit).not.toHaveBeenCalled();
  });

  it("BotID throwing -> 503 unavailable", async () => {
    const h = harness();
    h.botCheck.mockRejectedValue(new Error("botid down"));
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("BotID never answering -> 503 after the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    h.botCheck.mockReturnValue(new Promise(() => undefined));
    const pending = call(h);
    await vi.advanceTimersByTimeAsync(BOT_TIMEOUT_MS);
    await rejected(h, await pending, 503, "unavailable");
  });

  it.each([
    ["ipMinute", 30_000, "30"],
    ["ipDay", 3_600_000, "3600"],
    ["globalDay", 1_500, "2"],
  ] as const)("%s limit -> 429 with retry-after", async (which, ms, after) => {
    const h = harness();
    h.limiters[which] = deny(ms);
    const res = await call(h);
    expect(res.headers.get("retry-after")).toBe(after);
    await rejected(h, res, 429, "rate_limited");
  });

  it("per-IP limit stops before the global limit is consumed", async () => {
    const h = harness();
    h.limiters.ipMinute = deny(10_000);
    await (await call(h)).text();
    expect(h.limiters.globalDay.limit).not.toHaveBeenCalled();
  });

  it("Redis throwing in a limiter -> 503 unavailable", async () => {
    const h = harness();
    h.limiters.ipDay = {
      limit: vi.fn(async () => Promise.reject(new Error("redis"))),
    };
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("limiter factory throwing -> 503 unavailable", async () => {
    const h = harness(undefined, {
      limiters: () => {
        throw new Error("bad url");
      },
    });
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("budget spent -> 503 budget", async () => {
    const h = harness();
    h.store.get.mockResolvedValue(1_000_000);
    await rejected(h, await call(h), 503, "budget");
  });

  it("DAILY_BUDGET_USD=0.01 with a 10,000-micro store -> 503 budget", async () => {
    const env = getEnv({
      ANTHROPIC_API_KEY: SECRET_KEY,
      KV_REST_API_URL: "https://upstash.test",
      KV_REST_API_TOKEN: "SENTINEL-TOKEN",
      IP_HASH_SALT: SALT,
      DAILY_BUDGET_USD: "0.01",
    });
    expect(env.ok).toBe(true);
    const h = harness(undefined, { env: () => env });
    h.store.get.mockResolvedValue("10000");
    await rejected(h, await call(h), 503, "budget");
  });

  it("Redis throwing in the budget store -> 503 unavailable", async () => {
    const h = harness();
    h.store.get.mockRejectedValue(new Error("redis down"));
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("budget store factory throwing -> 503 unavailable", async () => {
    const h = harness(undefined, {
      budgetStore: () => {
        throw new Error("bad url");
      },
    });
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("empty env -> 503 unavailable, logs missing names only", async () => {
    const h = harness(undefined, { env: () => getEnv({}) });
    const anthropic = vi.fn(() => h.sdk.client);
    h.deps.anthropic = anthropic;
    await rejected(h, await call(h), 503, "unavailable");
    expect(h.botCheck).not.toHaveBeenCalled();
    expect(anthropic).not.toHaveBeenCalled();
    expect(h.logs[0]!.errorClass).toContain("ANTHROPIC_API_KEY");
    expect(h.logs[0]!.errorClass).toContain("IP_HASH_SALT");
  });

  it("partial env never logs a present secret's value", async () => {
    const h = harness(undefined, {
      env: () =>
        getEnv({
          ANTHROPIC_API_KEY: SECRET_KEY,
          KV_REST_API_URL: "https://upstash.test",
          KV_REST_API_TOKEN: "SENTINEL-TOKEN",
          IP_HASH_SALT: "too-short-SENTINEL",
        }),
    });
    await rejected(h, await call(h), 503, "unavailable");
    expect(h.logs[0]!.errorClass).toContain("IP_HASH_SALT");
  });

  it("Anthropic client factory throwing -> 503 unavailable", async () => {
    const h = harness(undefined, {
      anthropic: () => {
        throw new Error("no key");
      },
    });
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("an unexpected throw in a dep -> generic 503", async () => {
    const h = harness(undefined, {
      env: () => {
        throw new Error("boom SENTINEL");
      },
    });
    await rejected(h, await call(h), 503, "unavailable");
  });

  it("a throwing logger never breaks the response", async () => {
    const h = harness(undefined, {
      log: () => {
        throw new Error("sink down");
      },
    });
    h.botCheck.mockResolvedValue({ isBot: true });
    expect((await call(h)).status).toBe(403);
  });
});

// ---------- output scrubbing ----------

describe("scrubbing end to end", () => {
  it("strips a phone number and a non-allowlisted URL split across deltas", async () => {
    // Built at runtime so no phone literal lives in the repo (rule 2).
    const phone = ["(617)", " 555", "-0", "199"].join("");
    const evil = ["https://", "evil", ".example", "/x"];
    const h = harness({
      steps: [
        start(),
        text("<mood>happy</mood> Call "),
        text(phone.slice(0, 7)),
        text(phone.slice(7) + " or visit "),
        text(evil[0]! + evil[1]!),
        text(evil[2]! + evil[3]! + " today. See "),
        text("https://github.com/avanegas95 too."),
        stop("end_turn"),
      ],
    });
    const body = await (await call(h)).text();
    const out = deltas(parseSse(body));
    // Check the joined text: the raw body splits values across frames.
    for (const s of [body, out]) {
      expect(s).not.toContain(phone);
      expect(s).not.toContain("555");
      expect(s).not.toContain("0199");
      expect(s).not.toContain("evil");
    }
    expect(out).toContain("https://github.com/avanegas95");
    expect(out).toContain("Call ");
  });

  it("passes kbUrls() to the scrubber as the allowlist", async () => {
    const kbOnly = "https://kb-only.example/page";
    const script = (): Script => ({
      steps: [
        start(),
        text(`<mood>happy</mood> See ${kbOnly} now.`),
        stop("end_turn"),
      ],
    });
    const allowed = harness(script(), { kbUrls: () => [kbOnly] });
    expect(deltas(await readSse(await call(allowed)))).toContain(kbOnly);
    const denied = harness(script());
    expect(deltas(await readSse(await call(denied)))).not.toContain("kb-only");
  });
});

// ---------- refusal, upstream errors, abort ----------

describe("stream outcomes", () => {
  it("refusal after 2 deltas -> reset, confused, canned reply, done; still charged", async () => {
    const h = harness({
      steps: [
        start(),
        text("<mood>happy</mood> Sure, here is "),
        text("something "),
        stop("refusal"),
      ],
      final: () => Promise.resolve({ stop_reason: "refusal", usage: USAGE }),
    });
    const evs = await readSse(await call(h));
    const i = evs.findIndex((e) => e.event === "reset");
    expect(i).toBeGreaterThan(0);
    expect(evs.filter((e) => e.event === "reset")).toHaveLength(1);
    expect(evs.slice(i)).toEqual([
      { event: "reset", data: {} },
      { event: "mood", data: { mood: "confused" } },
      {
        event: "delta",
        data: { text: scrub(REFUSAL_REPLY, { allowedUrls: KB_URLS }) },
      },
      { event: "done", data: { usageBucket: "ok" } },
    ]);
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      costMicroUsd(ENV.chatModel, USAGE),
    );
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({
      mood: "confused",
      stopReason: "refusal",
    });
  });

  it("refusal before any text still sends the canned reply", async () => {
    const h = harness({
      steps: [start(), stop("refusal")],
      final: () => Promise.resolve({ stop_reason: "refusal", usage: USAGE }),
    });
    const evs = await readSse(await call(h));
    expect(evs.map((e) => e.event)).toEqual(["reset", "mood", "delta", "done"]);
  });

  it("SDK error before the first token -> JSON 502 upstream; charged worst case", async () => {
    const h = harness({
      steps: [
        { throw: new InternalServerError(500, {}, "ise", new Headers()) },
      ],
    });
    const res = await call(h);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: { code: "upstream" } });
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({
      status: 502,
      code: "upstream",
      errorClass: "InternalServerError",
    });
  });

  it("stream() throwing synchronously -> JSON 502 upstream", async () => {
    const h = harness({
      steps: [],
      throwOnCreate: new APIConnectionError({ message: "conn" }),
    });
    const res = await call(h);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "upstream" } });
  });

  it("a stream that stalls after message_start -> stall guard -> JSON 502 upstream; charged worst case", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // `hang` only ends when the SDK signal aborts: the stall guard must do it.
      const h = harness({ steps: [start(), { hang: true }] });
      const pending = call(h);
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS + 1);
      const res = await pending;
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: { code: "upstream" } });
      expect(h.sdk.signals[0]!.aborted).toBe(true);
      expect(h.store.incrby).toHaveBeenCalledWith(
        expect.any(String),
        worstCase(),
      );
      expect(h.logs[0]).toMatchObject({
        status: 502,
        code: "upstream",
        errorClass: "StreamTimeoutError",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("auth error before the first token -> 503 unavailable", async () => {
    const h = harness({
      steps: [
        { throw: new AuthenticationError(401, {}, "auth", new Headers()) },
      ],
    });
    const res = await call(h);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "unavailable" } });
  });

  it("SDK error after the first token -> SSE error upstream and close; charged", async () => {
    const h = harness({
      steps: [
        start(),
        text("<mood>happy</mood> Anderson is a "),
        { throw: new APIConnectionError({ message: "reset" }) },
      ],
    });
    const res = await call(h);
    expect(res.status).toBe(200);
    const evs = await readSse(res);
    expect(evs.at(-1)).toEqual({ event: "error", data: { code: "upstream" } });
    expect(evs.some((e) => e.event === "done")).toBe(false);
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({
      status: 200,
      code: "upstream",
      errorClass: "APIConnectionError",
    });
  });

  it("client abort -> SDK signal aborted, worst case charged when no usage", async () => {
    const h = harness({
      steps: [text("<mood>happy</mood> Partial answer here "), { hang: true }],
    });
    const ac = new AbortController();
    const res = await call(h, request({ signal: ac.signal }));
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(h.sdk.signals[0]!.aborted).toBe(true);
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
    expect(h.logs[0]).toMatchObject({ errorClass: "APIUserAbortError" });
  });

  // message_start reports output_tokens: 1; the model keeps generating after an abort.
  const START_900 = {
    input_tokens: 900,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const charged = (h: Harness): number =>
    h.store.incrby.mock.calls.reduce((sum, c) => sum + c[1], 0);

  it("body cancel mid-stream -> SDK aborted; output charged at max_tokens, not last seen", async () => {
    const h = harness({
      steps: [
        start(900),
        text("<mood>happy</mood> Partial answer here "),
        { hang: true },
      ],
    });
    const res = await call(h);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(h.sdk.signals[0]!.aborted).toBe(true);
    expect(h.sdk.params[0]!["max_tokens"]).toBe(MAX_TOKENS);
    const expected = costMicroUsd(ENV.chatModel, {
      ...START_900,
      output_tokens: MAX_TOKENS,
    });
    expect(h.store.incrby).toHaveBeenCalledTimes(1);
    expect(h.store.incrby).toHaveBeenCalledWith(expect.any(String), expected);
    // Mutation check: billing the last seen usage (output 1) must fail this test.
    const lastSeen = costMicroUsd(ENV.chatModel, START_900);
    expect(lastSeen).toBeLessThan(expected);
    expect(charged(h)).toBeGreaterThan(lastSeen);
    // The metric still reports what the API reported.
    expect(h.logs[0]).toMatchObject({
      inputTokens: 900,
      outputTokens: 1,
      costMicroUsd: expected,
    });
  });

  it("client abort mid-stream after message_start -> output charged at max_tokens", async () => {
    const h = harness({
      steps: [
        start(900),
        text("<mood>happy</mood> Partial answer here "),
        { hang: true },
      ],
    });
    const ac = new AbortController();
    const res = await call(h, request({ signal: ac.signal }));
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(h.sdk.signals[0]!.aborted).toBe(true);
    expect(charged(h)).toBe(
      costMicroUsd(ENV.chatModel, { ...START_900, output_tokens: MAX_TOKENS }),
    );
  });

  it("abort never charges less than reported output above max_tokens", async () => {
    const h = harness({
      steps: [
        start(900),
        text("<mood>happy</mood> Partial "),
        {
          type: "message_delta",
          delta: {},
          usage: { output_tokens: MAX_TOKENS + 500 },
        },
        { hang: true },
      ],
    });
    const res = await call(h);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(charged(h)).toBe(
      costMicroUsd(ENV.chatModel, {
        ...START_900,
        output_tokens: MAX_TOKENS + 500,
      }),
    );
  });

  it("a stream that ends with no stop_reason is charged at max_tokens, no done", async () => {
    const h = harness({
      steps: [start(900), text("<mood>happy</mood> Cut off")],
      final: () => Promise.resolve({ stop_reason: null, usage: START_900 }),
    });
    const evs = await readSse(await call(h));
    expect(evs.some((e) => e.event === "done")).toBe(false);
    expect(charged(h)).toBe(
      costMicroUsd(ENV.chatModel, { ...START_900, output_tokens: MAX_TOKENS }),
    );
  });

  it("a request already aborted never calls the SDK and is charged the worst case", async () => {
    const ac = new AbortController();
    const h = harness();
    const req = request({ signal: ac.signal });
    ac.abort();
    const res = await call(h, req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(h.sdk.make).not.toHaveBeenCalled();
    expect(h.store.incrby).toHaveBeenCalledTimes(1);
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
    expect(h.logs[0]).toMatchObject({
      status: 200,
      errorClass: "APIUserAbortError",
      costMicroUsd: worstCase(),
    });
  });

  it("a spend-recording failure is logged, not thrown", async () => {
    const h = harness();
    h.store.incrby.mockRejectedValue(new Error("redis down"));
    const evs = await readSse(await call(h));
    expect(evs.at(-1)!.event).toBe("done");
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.errorClass).toBe("BudgetRecordError");
  });

  it("invalid usage falls back to the worst case", async () => {
    const h = harness({
      steps: [start(), text("<mood>happy</mood> ok"), stop("end_turn")],
      final: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          usage: { input_tokens: -1, output_tokens: 1 },
        }),
    });
    await (await call(h)).text();
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
  });
});

// ---------- N-2: spend recorded under waitUntil ----------

describe("spend write is handed to waitUntil (N-2)", () => {
  /** Makes incrby stay pending until the returned release() is called. */
  function gate(h: Harness): () => void {
    let release!: () => void;
    const open = new Promise<void>((r) => (release = r));
    h.store.incrby.mockImplementation(async (_k: string, n: number) => {
      await open;
      return n;
    });
    return release;
  }

  async function settled(p: Promise<unknown>): Promise<boolean> {
    let done = false;
    void p.then(() => (done = true));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    return done;
  }

  it("on success: the pending spend promise goes to waitUntil", async () => {
    const h = harness();
    const release = gate(h);
    const res = await call(h);
    const reader = res.body!.getReader();
    await vi.waitFor(() => expect(h.waitUntil).toHaveBeenCalledOnce());
    const p = h.waitUntil.mock.calls[0]![0];
    expect(p).toBeInstanceOf(Promise);
    expect(h.store.incrby).toHaveBeenCalledOnce();
    expect(await settled(p)).toBe(false); // it is the spend write itself
    release();
    await p;
    while (!(await reader.read()).done);
    expect(h.store.incrby).toHaveBeenCalledWith(
      "pv3:blob:spend:2026-10-13",
      costMicroUsd(ENV.chatModel, USAGE),
    );
    expect(h.logs).toHaveLength(1);
  });

  it("on client abort: the spend promise goes to waitUntil", async () => {
    const h = harness({
      steps: [text("<mood>happy</mood> Partial answer here "), { hang: true }],
    });
    const release = gate(h);
    const ac = new AbortController();
    const res = await call(h, request({ signal: ac.signal }));
    const reader = res.body!.getReader();
    await reader.read();
    expect(h.waitUntil).not.toHaveBeenCalled();
    ac.abort();
    await vi.waitFor(() => expect(h.waitUntil).toHaveBeenCalledOnce());
    const p = h.waitUntil.mock.calls[0]![0];
    expect(await settled(p)).toBe(false);
    release();
    await p;
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
  });

  it("on body cancel: the spend promise goes to waitUntil", async () => {
    const h = harness({
      steps: [start(900), text("<mood>happy</mood> Partial "), { hang: true }],
    });
    const res = await call(h);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(h.logs).toHaveLength(1));
    expect(h.waitUntil).toHaveBeenCalledOnce();
    await h.waitUntil.mock.calls[0]![0];
    expect(h.store.incrby).toHaveBeenCalledOnce();
  });

  it("on an upstream failure before the first token", async () => {
    const h = harness({
      steps: [
        { throw: new InternalServerError(500, {}, "ise", new Headers()) },
      ],
    });
    const res = await call(h);
    expect(res.status).toBe(502);
    expect(h.waitUntil).toHaveBeenCalledOnce();
    await h.waitUntil.mock.calls[0]![0];
    expect(h.store.incrby).toHaveBeenCalledWith(
      expect.any(String),
      worstCase(),
    );
  });

  it("a spend-recording failure never rejects the waitUntil promise", async () => {
    const h = harness();
    h.store.incrby.mockRejectedValue(new Error("redis down"));
    await (await call(h)).text();
    await expect(h.waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
  });

  it("requests rejected before the stream never call waitUntil", async () => {
    const h = harness();
    await call(h, request({ method: "GET" }));
    expect(h.waitUntil).not.toHaveBeenCalled();
  });
});

// ---------- test-only controls ----------

describe("test-only controls", () => {
  it("skipBotId skips BotID under Vitest", async () => {
    const h = harness();
    h.botCheck.mockResolvedValue({ isBot: true });
    const res = await call(h, request(), { skipBotId: true });
    expect(res.status).toBe(200);
    expect(h.botCheck).not.toHaveBeenCalled();
    await res.text();
  });

  it("skipRateLimit and skipBudget skip those stores", async () => {
    const limiters = vi.fn();
    const budgetStore = vi.fn();
    const h = harness(undefined, { limiters, budgetStore });
    const res = await call(h, request(), {
      skipRateLimit: true,
      skipBudget: true,
    });
    const evs = await readSse(res);
    expect(evs.at(-1)).toEqual({ event: "done", data: { usageBucket: "ok" } });
    expect(limiters).not.toHaveBeenCalled();
    expect(budgetStore).not.toHaveBeenCalled();
  });

  it("no flag skips input limits", async () => {
    const h = harness();
    const raw = JSON.stringify({ ...BODY, pad: "x".repeat(9000) });
    const res = await call(h, request({ raw }), {
      skipBotId: true,
      skipRateLimit: true,
      skipBudget: true,
    });
    expect(res.status).toBe(413);
  });

  it("throws at construction when VITEST is not set", () => {
    const saved = process.env["VITEST"];
    delete process.env["VITEST"];
    try {
      expect(() =>
        createChatHandler(harness().deps, { skipBotId: true }),
      ).toThrow();
      expect(() => createChatHandler(harness().deps, {})).toThrow();
      expect(() => createChatHandler(harness().deps)).not.toThrow();
    } finally {
      process.env["VITEST"] = saved;
    }
  });
});
