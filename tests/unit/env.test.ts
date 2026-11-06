import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getEnv } from "../../src/lib/server/env.ts";

const SALT = "s".repeat(32);
const valid = {
  ANTHROPIC_API_KEY: "fake-key",
  KV_REST_API_URL: "https://fake.example.com",
  KV_REST_API_TOKEN: "fake-token",
  IP_HASH_SALT: SALT,
};

describe("getEnv", () => {
  it("applies defaults for a full valid source", () => {
    expect(getEnv(valid)).toEqual({
      ok: true,
      env: {
        anthropicApiKey: "fake-key",
        upstashUrl: "https://fake.example.com",
        upstashToken: "fake-token",
        ipHashSalt: SALT,
        chatModel: "claude-haiku-5-5",
        chatEffort: "low",
        dailyBudgetUsd: 1,
      },
    });
  });
  it("accepts overrides", () => {
    const r = getEnv({
      ...valid,
      CHAT_MODEL: "claude-sonnet-5-5",
      CHAT_EFFORT: "high",
    });
    expect(r.ok && r.env.chatModel).toBe("claude-sonnet-5-5");
    expect(r.ok && r.env.chatEffort).toBe("high");
  });
  it("lists the 4 secrets when empty", () => {
    expect(getEnv({})).toEqual({
      ok: false,
      missing: [
        "ANTHROPIC_API_KEY",
        "KV_REST_API_URL",
        "KV_REST_API_TOKEN",
        "IP_HASH_SALT",
      ],
      invalid: [],
    });
  });
  it("treats empty string as missing", () => {
    expect(getEnv({ ...valid, ANTHROPIC_API_KEY: "" })).toEqual({
      ok: false,
      missing: ["ANTHROPIC_API_KEY"],
      invalid: [],
    });
  });
  it("rejects unknown model and effort", () => {
    const cases: [string, string][] = [
      ["CHAT_MODEL", "claude-opus-5-5"],
      ["CHAT_EFFORT", "max"],
      ["CHAT_EFFORT", "xhigh"],
    ];
    for (const [k, v] of cases) {
      expect(getEnv({ ...valid, [k]: v })).toEqual({
        ok: false,
        missing: [],
        invalid: [k],
      });
    }
  });
  it("validates DAILY_BUDGET_USD", () => {
    for (const v of ["abc", "-1", "Infinity", "51", "NaN"]) {
      expect(getEnv({ ...valid, DAILY_BUDGET_USD: v })).toMatchObject({
        ok: false,
        invalid: ["DAILY_BUDGET_USD"],
      });
    }
    const a = getEnv({ ...valid, DAILY_BUDGET_USD: "0.01" });
    expect(a.ok && a.env.dailyBudgetUsd).toBe(0.01);
    const b = getEnv({ ...valid, DAILY_BUDGET_USD: "0" });
    expect(b.ok && b.env.dailyBudgetUsd).toBe(0);
  });
  it("rejects a short salt and a non-https URL", () => {
    expect(getEnv({ ...valid, IP_HASH_SALT: "s".repeat(31) })).toMatchObject({
      ok: false,
      invalid: ["IP_HASH_SALT"],
    });
    expect(
      getEnv({ ...valid, KV_REST_API_URL: "http://fake.example.com" }),
    ).toMatchObject({
      ok: false,
      invalid: ["KV_REST_API_URL"],
    });
  });
  it("never includes an input value in a failed result", () => {
    const sentinel = "SENTINEL-SECRET-VALUE-0123456789";
    const r = getEnv({
      ...valid,
      ANTHROPIC_API_KEY: sentinel,
      KV_REST_API_URL: "http://" + sentinel,
      KV_REST_API_TOKEN: sentinel,
      IP_HASH_SALT: sentinel.slice(0, 20),
      CHAT_MODEL: sentinel,
      DAILY_BUDGET_USD: sentinel,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(sentinel);
    expect(JSON.stringify(r)).not.toContain(sentinel.slice(0, 20));
  });
  it("does not throw on undefined values", () => {
    expect(() => getEnv({ ...valid, CHAT_MODEL: undefined })).not.toThrow();
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Rule 4: no env var may disable or weaken a control. Any token containing
// DISABLE/SKIP/BYPASS in src/ is flagged. ALLOWED lists documented test-only
// flags by exact name (the P2 briefs define none).
const ALLOWED: readonly string[] = [];
const TOKEN = /\b[A-Z0-9_]*(?:DISABLE|SKIP|BYPASS)[A-Z0-9_]*\b/g;
const SRC_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|astro)$/;

function scan(text: string): string[] {
  return (text.match(TOKEN) ?? []).filter((t) => !ALLOWED.includes(t));
}

describe("env hygiene", () => {
  it("scanner flags destructuring and member reads", () => {
    expect(scan("const { RATELIMIT_BYPASS } = process.env;")).toEqual([
      "RATELIMIT_BYPASS",
    ]);
    expect(scan("if (process.env.SKIP_BOTID) {}")).toEqual(["SKIP_BOTID"]);
    expect(scan('import.meta.env["DISABLE_LIMITS"]')).toEqual([
      "DISABLE_LIMITS",
    ]);
    expect(scan("const ok = 1;")).toEqual([]);
  });
  it("scans every source extension, including a planted file", () => {
    const dir = mkdtempSync(join(tmpdir(), "p2-scan-"));
    try {
      for (const ext of [
        "ts",
        "tsx",
        "mts",
        "cts",
        "js",
        "mjs",
        "cjs",
        "astro",
      ])
        writeFileSync(
          join(dir, `x.${ext}`),
          "const { A_BYPASS } = process.env;",
        );
      writeFileSync(join(dir, "x.md"), "A_BYPASS");
      const hits = walk(dir).filter((f) => SRC_EXT.test(f));
      expect(hits).toHaveLength(8);
      expect(
        hits.every((f) => scan(readFileSync(f, "utf8")).length === 1),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("no src file mentions a DISABLE/SKIP/BYPASS name", () => {
    const offenders = walk("src")
      .filter((f) => SRC_EXT.test(f))
      .flatMap((f) => scan(readFileSync(f, "utf8")).map((t) => `${f}: ${t}`));
    expect(offenders).toEqual([]);
  });
  it("rejects whitespace-only secrets and non-decimal budgets", () => {
    expect(getEnv({ ...valid, IP_HASH_SALT: " ".repeat(32) })).toMatchObject({
      ok: false,
      missing: ["IP_HASH_SALT"],
    });
    expect(getEnv({ ...valid, ANTHROPIC_API_KEY: "   " })).toMatchObject({
      ok: false,
      missing: ["ANTHROPIC_API_KEY"],
    });
    for (const v of ["0x10", "1e2", "1 0", "+1", ".5", "1."])
      expect(getEnv({ ...valid, DAILY_BUDGET_USD: v })).toMatchObject({
        ok: false,
        invalid: ["DAILY_BUDGET_USD"],
      });
    const r = getEnv({ ...valid, DAILY_BUDGET_USD: "2.50" });
    expect(r.ok && r.env.dailyBudgetUsd).toBe(2.5);
    // Values are trimmed once, so edge padding is harmless.
    const p = getEnv({ ...valid, DAILY_BUDGET_USD: " 1 " });
    expect(p.ok && p.env.dailyBudgetUsd).toBe(1);
  });
});

describe("getEnv: trimming", () => {
  it("fails a salt that is only 32 long because of padding", () => {
    const r = getEnv({ ...valid, IP_HASH_SALT: ` ${"s".repeat(30)} ` });
    expect(r).toEqual({ ok: false, missing: [], invalid: ["IP_HASH_SALT"] });
  });
  it("trims values and returns the trimmed value", () => {
    const r = getEnv({
      ...valid,
      KV_REST_API_URL: " https://x.upstash.io ",
      CHAT_MODEL: " claude-haiku-5-5 ",
    });
    expect(r.ok && r.env.upstashUrl).toBe("https://x.upstash.io");
    expect(r.ok && r.env.chatModel).toBe("claude-haiku-5-5");
  });
  it("rejects a URL with an inner space", () => {
    const r = getEnv({ ...valid, KV_REST_API_URL: "https://x.upstash.io /" });
    expect(r).toEqual({ ok: false, missing: [], invalid: ["KV_REST_API_URL"] });
  });
  it("still treats whitespace-only as missing", () => {
    const r = getEnv({ ...valid, ANTHROPIC_API_KEY: "   " });
    expect(r).toEqual({
      ok: false,
      missing: ["ANTHROPIC_API_KEY"],
      invalid: [],
    });
  });
});
