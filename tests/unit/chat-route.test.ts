// The production route: no test-only flags, on-demand, and safe to import and call
// with no secrets present. Real clients are mocked to record any use (rule 5).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reached = vi.hoisted(() => [] as string[]);
// Names in `stub` build an inert local object instead of failing (no network either way).
const stub = vi.hoisted(() => new Set<string>());
const built = vi.hoisted(() => [] as string[]);
const use = vi.hoisted(() => (name: string): void => {
  if (stub.has(name)) {
    built.push(name);
    return;
  }
  reached.push(name);
  throw new Error(`real ${name} client used in a test`);
});

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Guarded {
    constructor() {
      use("anthropic");
    }
  }
  return { ...actual, default: Guarded, Anthropic: Guarded };
});
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      use("redis");
    }
  },
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    constructor() {
      use("ratelimit");
    }
    static slidingWindow() {
      return {};
    }
  },
}));
vi.mock("botid/server", () => ({
  checkBotId: async () => {
    use("botid");
    return { isBot: true };
  },
}));

import type { APIContext } from "astro";

const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "IP_HASH_SALT",
  "CHAT_MODEL",
  "CHAT_EFFORT",
  "DAILY_BUDGET_USD",
];
const SOURCE = readFileSync("src/pages/api/chat.ts", "utf8");

function ctx(request: Request): APIContext {
  return { request, clientAddress: "203.0.113.9" } as unknown as APIContext;
}
const post = () =>
  new Request("https://site.test/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://site.test",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hi" }],
      sessionId: "session_12345678",
    }),
  });

let saved: Record<string, string | undefined>;
beforeEach(() => {
  reached.length = 0;
  built.length = 0;
  stub.clear();
  saved = {};
  for (const k of SECRET_NAMES) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of SECRET_NAMES)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  vi.restoreAllMocks();
  expect(reached).toEqual([]);
});

describe("src/pages/api/chat.ts", () => {
  it("passes no test-only controls", () => {
    expect(SOURCE).not.toMatch(/testOnly/i);
    expect(SOURCE).not.toMatch(/skip/i);
    expect(SOURCE).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it("imports with an empty env and is on-demand", async () => {
    const route = await import("../../src/pages/api/chat.ts");
    expect(route.prerender).toBe(false);
    expect(route.POST).toBeTypeOf("function");
    expect(route.ALL).toBeTypeOf("function");
  }, 60_000); // first import transforms the SDK and the KB bundle

  it("returns a typed 503 with no env, without building any client", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => {
      lines.push(l);
    });
    const { POST } = await import("../../src/pages/api/chat.ts");
    const res = await POST(ctx(post()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "unavailable" } });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      evt: "chat",
      status: 503,
      code: "unavailable",
    });
    expect(lines[0]).not.toContain("Hi");
    expect(built).toEqual([]);
  });

  it("has no GET export, so Astro routes GET to ALL -> 405", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const route = await import("../../src/pages/api/chat.ts");
    expect("GET" in route).toBe(false);
    const res = await route.ALL(
      ctx(new Request("https://site.test/api/chat", { method: "GET" })),
    );
    expect(res.status).toBe(405);
  });

  it("answers other methods with 405", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { ALL } = await import("../../src/pages/api/chat.ts");
    const res = await ALL(
      ctx(new Request("https://site.test/api/chat", { method: "GET" })),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("prodDeps", () => {
  const env = {
    anthropicApiKey: "sk-ant-fake",
    upstashUrl: "https://upstash.test",
    upstashToken: "tok",
    ipHashSalt: "s".repeat(40),
    chatModel: "claude-haiku-5-5",
    chatEffort: "low",
    dailyBudgetUsd: 1,
  } as const;

  it("wires the real verifier, a per-call env read, the prompt and KB allowlist", async () => {
    const { prodDeps } = await import("../../src/lib/server/deps.ts");
    const { verifyHuman } = await import("../../src/lib/server/botid.ts");
    expect(prodDeps.botCheck).toBe(verifyHuman);
    expect(prodDeps.env()).toMatchObject({ ok: false });
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-fake";
    process.env["KV_REST_API_URL"] = "https://upstash.test";
    process.env["KV_REST_API_TOKEN"] = "tok";
    process.env["IP_HASH_SALT"] = "s".repeat(40);
    expect(prodDeps.env()).toMatchObject({ ok: true });
    expect(prodDeps.systemPrompt()).toContain("<knowledge_base>");
    const urls = prodDeps.kbUrls();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => /^(?:https:\/\/|mailto:)/.test(u))).toBe(true);
    expect(prodDeps.kbUrls()).toBe(urls);
    expect(prodDeps.now()).toBeTypeOf("number");
    expect(built).toEqual([]); // nothing is built until a client is asked for
  });

  it("builds clients lazily and reuses them per distinct config", async () => {
    stub.add("anthropic").add("redis").add("ratelimit");
    const { prodDeps } = await import("../../src/lib/server/deps.ts");
    const a = prodDeps.anthropic(env);
    expect(prodDeps.anthropic(env)).toBe(a);
    expect(
      prodDeps.anthropic({ ...env, anthropicApiKey: "sk-ant-other" }),
    ).not.toBe(a);
    const l = prodDeps.limiters(env);
    expect(prodDeps.limiters(env)).toBe(l);
    const s = prodDeps.budgetStore(env);
    expect(prodDeps.budgetStore(env)).toBe(s);
    expect(built.filter((b) => b === "anthropic")).toHaveLength(2);
    expect(built.filter((b) => b === "ratelimit")).toHaveLength(3);
  });

  it("hands the spend write to @vercel/functions waitUntil (N-2)", async () => {
    const { prodDeps } = await import("../../src/lib/server/deps.ts");
    const { waitUntil } = await import("@vercel/functions");
    expect(prodDeps.waitUntil).toBe(waitUntil);
    // Outside a Vercel request context it is a no-op, never a throw.
    expect(() => prodDeps.waitUntil(Promise.resolve())).not.toThrow();
  });

  it("logs metrics as one JSON line", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => {
      lines.push(l);
    });
    const { prodDeps } = await import("../../src/lib/server/deps.ts");
    prodDeps.log({ evt: "chat", status: 200 });
    expect(lines).toEqual(['{"evt":"chat","status":200}']);
  });
});
