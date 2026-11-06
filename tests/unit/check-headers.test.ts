import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Result = { code: number; output: string };
type Runner = {
  run(
    argv: string[],
    env: Record<string, string | undefined>,
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  ): Promise<Result>;
};
const modPath = "../../scripts/ops/check-headers.mjs";
const smokePath = "../../scripts/smoke/chat-smoke.js";
const load = async () => (await import(/* @vite-ignore */ modPath)) as Runner;

const BOTID = "/botid-test-path";
const GOOD: Record<string, string> = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};

function makeFetch(
  over: (path: string, h: Record<string, string>) => Record<string, string>,
  seen: { url: string; init?: RequestInit }[] = [],
) {
  return async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const path = new URL(url).pathname;
    const base = { ...GOOD };
    if (path.startsWith(BOTID)) base["x-frame-options"] = "SAMEORIGIN";
    const status = path === "/api/chat" ? 405 : 200;
    return new Response(null, { status, headers: over(path, base) });
  };
}
const args = ["https://example.test", "--botid-path", BOTID];

describe("check-headers", () => {
  it("passes when every header is present", async () => {
    const { run } = await load();
    const r = await run(
      args,
      {},
      makeFetch((_p, h) => h),
    );
    expect(r.code).toBe(0);
  });

  it("fails naming a missing HSTS header", async () => {
    const { run } = await load();
    const r = await run(
      args,
      {},
      makeFetch((p, h) => {
        if (p === "/") delete h["strict-transport-security"];
        return h;
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("strict-transport-security");
  });

  it("probes the challenge script and checks only HSTS there", async () => {
    const { run } = await load();
    const seen: { url: string; init?: RequestInit }[] = [];
    const r = await run(
      args,
      {},
      makeFetch((p, h) => {
        if (p.startsWith(BOTID)) {
          return {
            "strict-transport-security": h["strict-transport-security"],
          };
        }
        return h;
      }, seen),
    );
    expect(r.code).toBe(0);
    const paths = seen.map((s) => new URL(s.url).pathname);
    expect(paths).toContain(`${BOTID}/a-4-a/c.js`);
    expect(paths).not.toContain(BOTID);
    expect(paths).not.toContain(`${BOTID}/`);
  });

  it("fails when the BotID path lacks HSTS", async () => {
    const { run } = await load();
    const r = await run(
      args,
      {},
      makeFetch((p, h) => (p.startsWith(BOTID) ? {} : h)),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("strict-transport-security");
  });

  it("fails when the BotID path is served as text/html", async () => {
    const { run } = await load();
    const r = await run(
      args,
      {},
      makeFetch((p, h) =>
        p.startsWith(BOTID)
          ? { ...h, "content-type": "text/html; charset=utf-8" }
          : h,
      ),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("text/html");
  });

  it("fails when /api/chat does not answer 405", async () => {
    const { run } = await load();
    const f = async () => new Response(null, { status: 200, headers: GOOD });
    const r = await run([args[0]], {}, f);
    expect(r.code).toBe(1);
    expect(r.output).toContain("405");
  });

  it("sends the bypass header but never prints its value", async () => {
    const { run } = await load();
    const seen: { url: string; init?: RequestInit }[] = [];
    const secret = "s3cr3t-bypass-value-xyz";
    const r = await run(
      args,
      { VERCEL_AUTOMATION_BYPASS_SECRET: secret },
      makeFetch((_p, h) => h, seen),
    );
    expect(r.output).not.toContain(secret);
    const hdrs = new Headers(seen[0].init?.headers);
    expect(hdrs.get("x-vercel-protection-bypass")).toBe(secret);
    const bad = await run(
      args,
      { VERCEL_AUTOMATION_BYPASS_SECRET: secret },
      makeFetch((_p, h) => ({ ...h, "x-frame-options": "ALLOW" })),
    );
    expect(bad.code).toBe(1);
    expect(bad.output).not.toContain(secret);
  });

  it("reads the BotID path from vercel.json when not given", async () => {
    const { run } = await load();
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      rewrites: { source: string }[];
    };
    const src = cfg.rewrites.find((r) => r.source.endsWith("/:path*"));
    const expected = src!.source.replace(/\/:path\*$/, "/");
    const seen: { url: string; init?: RequestInit }[] = [];
    await run(
      ["https://example.test"],
      {},
      makeFetch((_p, h) => h, seen),
    );
    const paths = seen.map((s) => new URL(s.url).pathname);
    expect(paths).toContain(`${expected}a-4-a/c.js`);
  });

  it("requires a URL", async () => {
    const { run } = await load();
    const r = await run(
      [],
      {},
      makeFetch((_p, h) => h),
    );
    expect(r.code).toBe(2);
  });
});

describe("chat-smoke guard", () => {
  const loadSmoke = async () =>
    (await import(/* @vite-ignore */ smokePath)) as Runner;
  const never = async (): Promise<Response> => {
    throw new Error("fetch must not be called");
  };

  it("does nothing without --spend", async () => {
    const { run } = await loadSmoke();
    const r = await run(["https://example.test"], {}, never);
    expect(r.code).toBe(2);
  });

  it("refuses to run in CI even with --spend", async () => {
    const { run } = await loadSmoke();
    const r = await run(
      ["https://example.test", "--spend"],
      { CI: "true" },
      never,
    );
    expect(r.code).toBe(2);
  });
});

describe("RUNBOOK public-safety", () => {
  const text = readFileSync("docs/RUNBOOK.md", "utf8");
  it.each([
    ["sk-ant-", /sk-ant-/],
    ["prj_", /prj_/],
    ["team_", /team_/],
    ["an upstash.io URL", /https:\/\/[^\s)]*upstash\.io/],
    ["vercel.app", /vercel\.app/],
  ])("contains no %s", (_n, re) => {
    expect(text).not.toMatch(re);
  });
});
