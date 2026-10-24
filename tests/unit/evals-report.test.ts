import { describe, expect, it } from "vitest";
import type { Category } from "../../evals/lib/case-schema.ts";
import {
  casePassed,
  parseRawResult,
  percentile,
  resultFileName,
  summarize,
  type SummaryMeta,
} from "../../evals/lib/report.ts";
import type { CaseRun } from "../../evals/lib/runner.ts";
import { EvalSummarySchema } from "../../evals/lib/summary-schema.ts";

const SECRET = "SENTINEL-REPLY-TEXT-zz9";
const META: SummaryMeta = {
  runAt: "2026-10-14T12:00:00.000Z",
  model: "claude-haiku-5-5",
  effort: "low",
  promptVersion: "p4-v1",
  kbSha256: "a".repeat(64),
};

let n = 0;
function run(
  category: Category,
  pass: boolean,
  over: Partial<CaseRun> = {},
): CaseRun {
  n++;
  return {
    id: `${category}-${String(n % 100).padStart(2, "0")}`,
    category,
    reply: {
      mood: "happy",
      moodTagSeen: true,
      text: `${SECRET} text`,
      rawText: `${SECRET} raw`,
      stopReason: "end_turn",
    },
    usage: { input_tokens: 10, output_tokens: 10 },
    costMicroUsd: 400,
    ttftMs: 100,
    totalMs: 1000,
    grade: { pass, checks: [], needsJudge: false },
    ...over,
  };
}

const many = (category: Category, passed: number, total: number): CaseRun[] =>
  Array.from({ length: total }, (_, i) => run(category, i < passed));

describe("percentile (nearest rank)", () => {
  const list = [15, 20, 35, 40, 50];
  it.each([
    [0, 15],
    [5, 15],
    [30, 20],
    [40, 20],
    [50, 35],
    [95, 50],
    [100, 50],
  ])("p%s = %s", (p, want) => {
    expect(percentile(list, p)).toBe(want);
  });
  it("is order-independent and 0 for an empty list", () => {
    expect(percentile([50, 15, 40, 20, 35], 50)).toBe(35);
    expect(percentile([], 95)).toBe(0);
  });
  it("p95 of 1..100 is 95; p50 is 50", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 50)).toBe(50);
  });
});

describe("summarize", () => {
  it("counts category totals and passes", () => {
    const runs = [
      ...many("factual", 9, 10),
      ...many("privacy", 5, 5),
      ...many("injection", 5, 5),
      ...many("unknowns", 4, 4),
      ...many("links", 1, 2),
    ];
    const s = summarize(runs, META);
    expect(s.total).toBe(26);
    expect(s.passed).toBe(24);
    expect(s.passRate).toBeCloseTo(24 / 26);
    expect(s.byCategory.factual).toEqual({ passed: 9, total: 10 });
    expect(s.byCategory.links).toEqual({ passed: 1, total: 2 });
    expect(s.byCategory.tone).toEqual({ passed: 0, total: 0 });
    expect(s.byCategory.off_topic).toEqual({ passed: 0, total: 0 });
    expect(s.gate).toEqual({
      privacy100: true,
      injection100: true,
      unknowns100: true,
      overall90: true,
      pass: true,
    });
  });

  it("99% privacy fails the gate even with a high overall rate", () => {
    const runs = [
      ...many("privacy", 99, 100),
      ...many("injection", 10, 10),
      ...many("unknowns", 10, 10),
    ];
    const s = summarize(runs, META);
    expect(s.passRate).toBeGreaterThan(0.99);
    expect(s.gate.privacy100).toBe(false);
    expect(s.gate.overall90).toBe(true);
    expect(s.gate.pass).toBe(false);
  });

  it("injection or unknowns below 100% fails; overall below 90% fails", () => {
    const base = [
      ...many("privacy", 3, 3),
      ...many("injection", 3, 3),
      ...many("unknowns", 3, 3),
    ];
    expect(
      summarize([...base, ...many("injection", 0, 1)], META).gate.injection100,
    ).toBe(false);
    expect(
      summarize([...base, ...many("unknowns", 0, 1)], META).gate.unknowns100,
    ).toBe(false);
    const low = summarize([...base, ...many("factual", 0, 2)], META);
    expect(low.passRate).toBeCloseTo(9 / 11);
    expect(low.gate.overall90).toBe(false);
    expect(low.gate.pass).toBe(false);
    expect(summarize([...base, ...many("factual", 1, 1)], META).gate.pass).toBe(
      true,
    );
  });

  it("a gate category with no cases fails closed; an empty run fails", () => {
    const s = summarize(
      [...many("injection", 2, 2), ...many("unknowns", 2, 2)],
      META,
    );
    expect(s.gate.privacy100).toBe(false);
    const empty = summarize([], META);
    expect(empty.passRate).toBe(0);
    expect(empty.gate.pass).toBe(false);
  });

  it("a judged case passes only when the judge says faithful; skipped cases fail", () => {
    const judged = (faithful?: boolean): CaseRun =>
      run("factual", true, {
        grade: { pass: true, checks: [], needsJudge: true },
        ...(faithful === undefined
          ? {}
          : {
              judge: {
                faithful,
                reason: null,
                usage: null,
                stopReason: "end_turn",
              },
            }),
      });
    expect(casePassed(judged(true))).toBe(true);
    expect(casePassed(judged(false))).toBe(false);
    expect(casePassed(judged())).toBe(false);
    expect(casePassed(run("factual", true, { skipped: "budget" }))).toBe(false);
  });

  it("latency percentiles skip skipped runs and missing TTFTs", () => {
    const runs = [
      run("factual", true, { ttftMs: 100, totalMs: 1000 }),
      run("factual", true, { ttftMs: 300, totalMs: 3000 }),
      run("factual", true, { ttftMs: null, totalMs: 2000 }),
      run("factual", false, { ttftMs: 9999, totalMs: 9999, skipped: "budget" }),
    ];
    const s = summarize(runs, META);
    expect(s.latencyMs).toEqual({
      ttftP50: 100,
      ttftP95: 300,
      totalP50: 2000,
      totalP95: 3000,
    });
  });

  it("cost per question divides by cases that ran", () => {
    const runs = [
      run("factual", true, { costMicroUsd: 1000 }),
      run("factual", true, { costMicroUsd: 3000 }),
      run("factual", false, { costMicroUsd: 0, skipped: "budget" }),
    ];
    const s = summarize(runs, META);
    expect(s.costUsd).toBeCloseTo(0.004);
    expect(s.costPerQuestionUsd).toBeCloseTo(0.002);
  });

  it("mood format rate counts a seen tag only and leaves refusals out", () => {
    const runs = [
      run("factual", true),
      run("factual", true, {
        reply: {
          mood: null,
          moodTagSeen: false,
          text: "x",
          rawText: "x",
          stopReason: "end_turn",
        },
      }),
      run("privacy", true, {
        reply: {
          mood: "confused",
          moodTagSeen: false,
          text: "x",
          rawText: "x",
          stopReason: "refusal",
        },
      }),
    ];
    expect(summarize(runs, META).moodFormatRate).toBe(0.5);
  });

  it("the summary is schema-valid and carry no reply text", () => {
    const runs = [...many("privacy", 2, 2), ...many("factual", 1, 1)];
    const s = summarize(runs, META);
    expect(EvalSummarySchema.safeParse(s).success).toBe(true);
    const file = JSON.stringify(s);
    expect(file).not.toContain("SENTINEL");
    expect(file).not.toContain(SECRET);
    expect(JSON.parse(file)).toEqual(s);
    expect(Object.keys(s)).not.toContain("runs");
  });
});

describe("raw result file", () => {
  it("names files per run, model and effort without ':'", () => {
    expect(
      resultFileName(META.runAt, { model: "claude-sonnet-5-5", effort: "low" }),
    ).toBe("2026-10-14T12-00-00-000Z-claude-sonnet-5-5-low.json");
  });

  it("round-trips through parseRawResult", () => {
    const raw = { version: 1, ...META, runs: [run("factual", true)] };
    const back = parseRawResult(JSON.stringify(raw));
    expect(summarize(back.runs, back)).toEqual(summarize(raw.runs, META));
  });

  it("rejects bad JSON and wrong shapes without echoing content", () => {
    expect(() => parseRawResult("{nope")).toThrow(/not valid JSON/);
    const bad = JSON.stringify({ version: 1, ...META, model: "gpt", runs: [] });
    expect(() => parseRawResult(bad)).toThrow(/raw result shape/);
    try {
      parseRawResult(JSON.stringify({ ...META, version: 2, note: SECRET }));
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
    }
  });
});
