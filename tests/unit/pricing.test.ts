import { describe, expect, it } from "vitest";
import {
  LONG_CONTEXT_THRESHOLD,
  PRICES_PER_MTOK,
  costMicroUsd,
  worstCaseCostMicroUsd,
  type Usage,
} from "../../src/lib/server/pricing.ts";

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

describe("PRICES_PER_MTOK", () => {
  it("matches the official pricing page (micro-USD per MTok)", () => {
    expect(PRICES_PER_MTOK[HAIKU]).toEqual({
      input: 100_000,
      cacheWrite1h: 200_000,
      cacheRead: 10_000,
      output: 500_000,
      longInput: {
        input: 500_000,
        cacheWrite1h: 1_000_000,
        cacheRead: 50_000,
        output: 2_500_000,
      },
    });
    expect(PRICES_PER_MTOK[SONNET]).toEqual({
      input: 2_000_000,
      cacheWrite1h: 4_000_000,
      cacheRead: 100_000,
      output: 10_000_000,
    });
  });
  it("stores every price as an integer", () => {
    for (const p of Object.values(PRICES_PER_MTOK)) {
      const all = [p.input, p.cacheWrite1h, p.cacheRead, p.output];
      if (p.longInput) all.push(...Object.values(p.longInput));
      for (const v of all) expect(Number.isSafeInteger(v)).toBe(true);
    }
  });
});

describe("costMicroUsd", () => {
  it("Haiku cached request: 80 + 30 + 250 = 360", () => {
    expect(
      costMicroUsd(HAIKU, {
        input_tokens: 300,
        output_tokens: 500,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 0,
      }),
    ).toBe(360);
  });
  it("Haiku first request adds 1,600 for an 8,000-token 1h cache write", () => {
    expect(
      costMicroUsd(HAIKU, {
        input_tokens: 300,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 8000,
      }),
    ).toBe(30 + 250 + 1600);
  });
  it("Sonnet: 8,000 read + 300 in + 500 out = 800 + 600 + 5,000", () => {
    expect(
      costMicroUsd(SONNET, {
        input_tokens: 300,
        output_tokens: 500,
        cache_read_input_tokens: 8000,
      }),
    ).toBe(6400);
  });
  it("Sonnet cache write is billed at the 1h rate", () => {
    expect(
      costMicroUsd(SONNET, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1000,
      }),
    ).toBe(4000);
  });
  it("Haiku long-context prices apply when the total prompt exceeds 100K", () => {
    const usage: Usage = {
      input_tokens: 1,
      output_tokens: 1000,
      cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 0,
    };
    // 100,001 prompt tokens: 1*0.5 + 100,000*0.05 + 1000*2.5 = 0.5 + 5000 + 2500
    expect(costMicroUsd(HAIKU, usage)).toBe(Math.ceil(7500.5));
  });
  it("exactly 100K prompt tokens stays on the base Haiku price", () => {
    expect(
      costMicroUsd(HAIKU, {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: LONG_CONTEXT_THRESHOLD,
      }),
    ).toBe(1000);
  });
  it("Sonnet has no long-context surcharge", () => {
    expect(
      costMicroUsd(SONNET, { input_tokens: 200_000, output_tokens: 0 }),
    ).toBe(400_000);
  });
  it("null and missing cache fields count as 0", () => {
    const a = costMicroUsd(HAIKU, {
      input_tokens: 300,
      output_tokens: 500,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    const b = costMicroUsd(HAIKU, { input_tokens: 300, output_tokens: 500 });
    expect(a).toBe(280);
    expect(b).toBe(280);
  });
  it("rounds up to an integer (never under-counts)", () => {
    const c = costMicroUsd(HAIKU, { input_tokens: 1, output_tokens: 0 });
    expect(c).toBe(1);
    expect(Number.isInteger(c)).toBe(true);
    expect(costMicroUsd(HAIKU, { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
  it("is exact for large counts (no float drift)", () => {
    // 3 * 0.1 in floats is 0.30000000000000004; integer math must not ceil to 1.
    expect(
      costMicroUsd(HAIKU, { input_tokens: 90_000, output_tokens: 0 }),
    ).toBe(9000);
    expect(
      costMicroUsd(SONNET, {
        input_tokens: 3_000_000,
        output_tokens: 3_000_000,
      }),
    ).toBe(36_000_000);
    expect(costMicroUsd(HAIKU, { input_tokens: 30, output_tokens: 0 })).toBe(3);
  });
  it.each([
    { input_tokens: -1, output_tokens: 0 },
    { input_tokens: 1.5, output_tokens: 0 },
    { input_tokens: Number.NaN, output_tokens: 0 },
    { input_tokens: 0, output_tokens: Number.POSITIVE_INFINITY },
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: -5 },
  ])("rejects invalid token counts %o", (u) => {
    expect(() => costMicroUsd(HAIKU, u)).toThrow(RangeError);
  });
  it("rejects an unknown model", () => {
    expect(() =>
      costMicroUsd("gpt-x" as typeof HAIKU, {
        input_tokens: 1,
        output_tokens: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("worstCaseCostMicroUsd", () => {
  it("prices every prompt token at the 1h write rate plus full max_tokens", () => {
    expect(worstCaseCostMicroUsd(HAIKU, 8300, 500)).toBe(1660 + 250);
    expect(worstCaseCostMicroUsd(SONNET, 8300, 500)).toBe(33_200 + 5000);
  });
  it("uses long-context prices above 100K on Haiku", () => {
    expect(worstCaseCostMicroUsd(HAIKU, 100_001, 0)).toBe(100_001);
  });
  it.each([HAIKU, SONNET] as const)(
    "%s: is >= every real-usage split at the same prompt size",
    (model) => {
      for (const prompt of [
        0, 1, 300, 8300, 99_999, 100_000, 100_001, 150_000,
      ]) {
        for (const maxTokens of [0, 1, 500, 1024]) {
          const worst = worstCaseCostMicroUsd(model, prompt, maxTokens);
          const splits = [
            [prompt, 0, 0],
            [0, prompt, 0],
            [0, 0, prompt],
            [
              Math.floor(prompt / 3),
              Math.floor(prompt / 3),
              prompt - 2 * Math.floor(prompt / 3),
            ],
          ] as const;
          for (const [input, read, write] of splits) {
            for (const out of [0, maxTokens]) {
              const real = costMicroUsd(model, {
                input_tokens: input,
                output_tokens: out,
                cache_read_input_tokens: read,
                cache_creation_input_tokens: write,
              });
              expect(worst).toBeGreaterThanOrEqual(real);
            }
          }
        }
      }
    },
  );
  it("rejects invalid inputs", () => {
    expect(() => worstCaseCostMicroUsd(HAIKU, -1, 10)).toThrow(RangeError);
    expect(() => worstCaseCostMicroUsd(HAIKU, 10, 1.2)).toThrow(RangeError);
  });
});
