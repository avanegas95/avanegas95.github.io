import { describe, expect, it } from "vitest";
import {
  HARD_CAP_USD,
  SpendMeter,
  preflightMicroUsd,
  spendAllowed,
  type CallPlan,
} from "../../evals/lib/budget.ts";

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

const ARGV = ["node", "evals/run.ts", "--spend"];
const ENV = { EVAL_ALLOW_SPEND: "1", ANTHROPIC_API_KEY: "sk-test" };

const plan = (model: CallPlan["model"], calls = 50): CallPlan => ({
  model,
  prefixTokens: 6500,
  turnTokens: 300,
  maxTokens: 1024,
  calls,
});

describe("HARD_CAP_USD", () => {
  it("is $1", () => {
    expect(HARD_CAP_USD).toBe(1);
  });
});

describe("spendAllowed", () => {
  it("allows a run when every condition holds", () => {
    expect(spendAllowed(ARGV, ENV, 500_000)).toEqual({ ok: true });
  });

  it.each([
    ["no --spend flag", ["node", "evals/run.ts"], ENV, "no_opt_in"],
    [
      "EVAL_ALLOW_SPEND missing",
      ARGV,
      { ANTHROPIC_API_KEY: "sk-test" },
      "no_opt_in",
    ],
    [
      "EVAL_ALLOW_SPEND not 1",
      ARGV,
      { ...ENV, EVAL_ALLOW_SPEND: "true" },
      "no_opt_in",
    ],
    ["no API key", ARGV, { EVAL_ALLOW_SPEND: "1" }, "no_key"],
    ["blank API key", ARGV, { ...ENV, ANTHROPIC_API_KEY: "  " }, "no_key"],
    [
      "pull_request event",
      ARGV,
      { ...ENV, GITHUB_EVENT_NAME: "pull_request" },
      "pull_request",
    ],
    [
      "pull_request_target event",
      ARGV,
      { ...ENV, GITHUB_EVENT_NAME: "pull_request_target" },
      "pull_request",
    ],
  ] as const)("%s -> %s", (_name, argv, env, reason) => {
    expect(spendAllowed(argv, env, 0)).toEqual({ ok: false, reason });
  });

  it("reports the first failing check in order", () => {
    expect(spendAllowed([], {}, 5_000_000)).toEqual({
      ok: false,
      reason: "no_opt_in",
    });
    expect(spendAllowed(ARGV, { EVAL_ALLOW_SPEND: "1" }, 5_000_000)).toEqual({
      ok: false,
      reason: "no_key",
    });
    expect(
      spendAllowed(
        ARGV,
        { ...ENV, GITHUB_EVENT_NAME: "pull_request" },
        5_000_000,
      ),
    ).toEqual({ ok: false, reason: "pull_request" });
  });

  it("allows other GitHub events (schedule, workflow_dispatch)", () => {
    expect(
      spendAllowed(ARGV, { ...ENV, GITHUB_EVENT_NAME: "schedule" }, 0),
    ).toEqual({ ok: true });
    expect(
      spendAllowed(ARGV, { ...ENV, GITHUB_EVENT_NAME: "workflow_dispatch" }, 0),
    ).toEqual({ ok: true });
  });

  it.each(["true", "1", "TRUE", " true "])("CI=%j -> ci", (ci) => {
    expect(spendAllowed(ARGV, { ...ENV, CI: ci }, 0)).toEqual({
      ok: false,
      reason: "ci",
    });
  });

  it.each(["false", "0", "", "  "])(
    "CI=%j is allowed when otherwise ok",
    (ci) => {
      expect(spendAllowed(ARGV, { ...ENV, CI: ci }, 0)).toEqual({ ok: true });
    },
  );

  it("preflight exactly at the cap is ok; $1.01 is over_cap", () => {
    expect(spendAllowed(ARGV, ENV, 1_000_000)).toEqual({ ok: true });
    expect(spendAllowed(ARGV, ENV, 1_010_000)).toEqual({
      ok: false,
      reason: "over_cap",
    });
  });

  it("capUsd can lower the cap", () => {
    expect(spendAllowed(ARGV, ENV, 600_000, 0.5)).toEqual({
      ok: false,
      reason: "over_cap",
    });
    expect(spendAllowed(ARGV, ENV, 400_000, 0.5)).toEqual({ ok: true });
  });

  it.each([5, 1.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "capUsd %s clamps to HARD_CAP_USD",
    (cap) => {
      expect(spendAllowed(ARGV, ENV, 1_000_000, cap)).toEqual({ ok: true });
      expect(spendAllowed(ARGV, ENV, 1_000_001, cap)).toEqual({
        ok: false,
        reason: "over_cap",
      });
    },
  );

  it("ignores env attempts to raise the cap (EVAL_MAX_USD=50)", () => {
    const env = { ...ENV, EVAL_MAX_USD: "50" };
    expect(spendAllowed(ARGV, env, 1_010_000)).toEqual({
      ok: false,
      reason: "over_cap",
    });
  });

  it("rejects a non-finite or negative preflight as over_cap", () => {
    expect(spendAllowed(ARGV, ENV, Number.NaN)).toEqual({
      ok: false,
      reason: "over_cap",
    });
    expect(spendAllowed(ARGV, ENV, -1)).toEqual({
      ok: false,
      reason: "over_cap",
    });
  });
});

describe("preflightMicroUsd", () => {
  it("Haiku 50 calls = 31,585 µ$", () => {
    expect(preflightMicroUsd([plan(HAIKU)])).toBe(31_585);
  });

  it("Sonnet 50 calls = 599,850 µ$", () => {
    expect(preflightMicroUsd([plan(SONNET)])).toBe(599_850);
  });

  it("both plans together = 631,435 µ$ and are allowed", () => {
    const total = preflightMicroUsd([plan(HAIKU), plan(SONNET)]);
    expect(total).toBe(631_435);
    expect(spendAllowed(ARGV, ENV, total)).toEqual({ ok: true });
  });

  it("a 100-call Sonnet plan exceeds the cap", () => {
    const total = preflightMicroUsd([plan(SONNET, 100)]);
    expect(total).toBeGreaterThan(1_000_000);
    expect(spendAllowed(ARGV, ENV, total)).toEqual({
      ok: false,
      reason: "over_cap",
    });
  });

  it("zero calls costs nothing; empty plans cost nothing", () => {
    expect(preflightMicroUsd([plan(HAIKU, 0)])).toBe(0);
    expect(preflightMicroUsd([])).toBe(0);
  });

  it("rejects invalid call counts", () => {
    expect(() => preflightMicroUsd([plan(HAIKU, -1)])).toThrow(RangeError);
    expect(() => preflightMicroUsd([plan(HAIKU, 1.5)])).toThrow(RangeError);
  });
});

describe("SpendMeter", () => {
  it("charges the P2 live-smoke Haiku usages", () => {
    const m = new SpendMeter();
    expect(
      m.charge(HAIKU, {
        input_tokens: 14,
        output_tokens: 217,
        cache_creation_input_tokens: 5895,
      }),
    ).toBe(1_289);
    expect(
      m.charge(HAIKU, {
        input_tokens: 14,
        output_tokens: 221,
        cache_read_input_tokens: 5895,
      }),
    ).toBe(171);
    expect(m.spentMicroUsd).toBe(1_460);
  });

  it("canAfford is true exactly at the cap and false at cap + 1 µ$", () => {
    const m = new SpendMeter();
    expect(m.canAfford(1_000_000)).toBe(true);
    expect(m.canAfford(1_000_001)).toBe(false);
    m.charge(HAIKU, {
      input_tokens: 14,
      output_tokens: 217,
      cache_creation_input_tokens: 5895,
    });
    expect(m.canAfford(1_000_000 - 1_289)).toBe(true);
    expect(m.canAfford(1_000_000 - 1_289 + 1)).toBe(false);
  });

  it("a lower capUsd lowers the meter's cap; higher clamps to $1", () => {
    expect(new SpendMeter(0.25).canAfford(250_001)).toBe(false);
    expect(new SpendMeter(0.25).canAfford(250_000)).toBe(true);
    expect(new SpendMeter(5).canAfford(1_000_001)).toBe(false);
  });

  it("rejects a non-finite or negative estimate", () => {
    const m = new SpendMeter();
    expect(m.canAfford(Number.NaN)).toBe(false);
    expect(m.canAfford(-1)).toBe(false);
  });
});

describe("fail closed", () => {
  const UNKNOWN = "claude-opus-5-5" as unknown as CallPlan["model"];

  it("preflight throws for an unknown model instead of pricing it at 0", () => {
    expect(() => preflightMicroUsd([plan(UNKNOWN, 1)])).toThrow(RangeError);
    expect(() => preflightMicroUsd([plan(HAIKU), plan(UNKNOWN)])).toThrow(
      RangeError,
    );
  });

  it("SpendMeter.charge throws for an unknown model and records nothing", () => {
    const m = new SpendMeter();
    expect(() =>
      m.charge(UNKNOWN, { input_tokens: 1, output_tokens: 1 }),
    ).toThrow(RangeError);
    expect(m.spentMicroUsd).toBe(0);
  });

  it("Haiku switches to long-context rates once one prompt exceeds 100k tokens", () => {
    const one = (prefixTokens: number, turnTokens: number): CallPlan => ({
      model: HAIKU,
      prefixTokens,
      turnTokens,
      maxTokens: 0,
      calls: 1,
    });
    // 100,000 tokens: 99,999 x $0.20 + 1 x $0.10 per MTok = 19,999.9 -> 20,000 µ$.
    expect(preflightMicroUsd([one(99_999, 1)])).toBe(20_000);
    // 100,001 tokens: long rates, 100,000 x $1 + 1 x $0.50 per MTok -> 100,001 µ$.
    expect(preflightMicroUsd([one(100_000, 1)])).toBe(100_001);
  });

  it("the long-context threshold applies per call, not to the whole run", () => {
    // Two 60k-token calls (120k in total) stay on the base rates:
    // write 60k x $0.20 = 12,000 + read 60k x $0.01 = 600.
    const p: CallPlan = {
      model: HAIKU,
      prefixTokens: 60_000,
      turnTokens: 0,
      maxTokens: 0,
      calls: 2,
    };
    expect(preflightMicroUsd([p])).toBe(12_600);
  });

  it("the meter charges long-context usage at long rates", () => {
    const m = new SpendMeter(0.2);
    const cost = m.charge(HAIKU, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 100_001,
    });
    expect(cost).toBe(100_001);
    expect(m.canAfford(99_999)).toBe(true);
    expect(m.canAfford(100_000)).toBe(false);
  });

  it("Sonnet has no long-context switch", () => {
    const one: CallPlan = {
      model: SONNET,
      prefixTokens: 200_000,
      turnTokens: 0,
      maxTokens: 0,
      calls: 1,
    };
    expect(preflightMicroUsd([one])).toBe(800_000);
  });
});
