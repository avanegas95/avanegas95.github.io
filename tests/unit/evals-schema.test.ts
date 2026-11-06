import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  CATEGORIES,
  EvalCaseSchema,
  EvalFileSchema,
  GATE_100,
  parseCasesYaml,
} from "../../evals/lib/case-schema.ts";
import { EvalSummarySchema } from "../../evals/lib/summary-schema.ts";

type RawCase = Record<string, unknown>;

function baseCases(n = 40): RawCase[] {
  return Array.from({ length: n }, (_, i) => {
    const category = CATEGORIES[i % CATEGORIES.length]!;
    return {
      id: `${category}-${String(i).padStart(2, "0")}`,
      category,
      messages: [{ role: "user", content: `Question number ${i}?` }],
      expect: { mustInclude: ["Anderson"] },
    };
  });
}

function fileWith(mutate: (cases: RawCase[]) => void, n = 40): string {
  const cases = baseCases(n);
  mutate(cases);
  return stringify({ version: 1, cases });
}

describe("constants", () => {
  it("exposes the categories and the 100% gate set", () => {
    expect(CATEGORIES).toEqual([
      "factual",
      "unknowns",
      "privacy",
      "injection",
      "off_topic",
      "tone",
      "links",
    ]);
    expect(GATE_100).toEqual(["privacy", "injection", "unknowns"]);
  });
});

describe("parseCasesYaml", () => {
  it("parses a valid 40-case file and applies expect defaults", () => {
    const cases = parseCasesYaml(fileWith(() => {}));
    expect(cases).toHaveLength(40);
    expect(cases[0]!.expect).toEqual({
      mustInclude: ["Anderson"],
      mustIncludeAny: [],
      mustNotInclude: [],
      mustNotMatch: [],
      saysUnknown: false,
      redirects: false,
      maxWords: 120,
    });
  });

  it("accepts a multi-turn conversation, moods, judge and notes", () => {
    const cases = parseCasesYaml(
      fileWith((c) => {
        c[0] = {
          id: "factual-99",
          category: "factual",
          messages: [
            { role: "user", content: "Hi" },
            { role: "assistant", content: "Hello!" },
            { role: "user", content: "Where does he work?" },
          ],
          expect: {
            mustNotMatch: ["\\d{3}-\\d{4}"],
            moods: ["happy", "proud"],
            judge: "faithfulness",
            maxWords: 80,
          },
          notes: "multi-turn",
        };
      }),
    );
    expect(cases[0]!.messages).toHaveLength(3);
    expect(cases[0]!.expect.judge).toBe("faithfulness");
  });

  it.each([
    [
      "unknown key on a case",
      (c: RawCase[]) => {
        c[3] = { ...c[3], extra: true };
      },
      3,
    ],
    [
      "unknown key in expect",
      (c: RawCase[]) => {
        c[4] = { ...c[4], expect: { mustInclude: [], foo: 1 } };
      },
      4,
    ],
    [
      "final assistant turn",
      (c: RawCase[]) => {
        c[5] = {
          ...c[5],
          messages: [
            { role: "user", content: "Hi" },
            { role: "assistant", content: "Hello" },
          ],
        };
      },
      5,
    ],
    [
      "two user turns in a row",
      (c: RawCase[]) => {
        c[6] = {
          ...c[6],
          messages: [
            { role: "user", content: "Hi" },
            { role: "user", content: "Hello?" },
          ],
        };
      },
      6,
    ],
    [
      "regex that doesn't compile",
      (c: RawCase[]) => {
        c[7] = { ...c[7], expect: { mustNotMatch: ["(unclosed"] } };
      },
      7,
    ],
    [
      "judge on a non factual/unknowns category",
      (c: RawCase[]) => {
        c[2] = { ...c[2], expect: { judge: "faithfulness" } }; // privacy
      },
      2,
    ],
    [
      "bad id format",
      (c: RawCase[]) => {
        c[8] = { ...c[8], id: "Factual-1" };
      },
      8,
    ],
    [
      "empty moods",
      (c: RawCase[]) => {
        c[9] = { ...c[9], expect: { moods: [] } };
      },
      9,
    ],
    [
      "content over 500 chars",
      (c: RawCase[]) => {
        c[10] = {
          ...c[10],
          messages: [{ role: "user", content: "x".repeat(501) }],
        };
      },
      10,
    ],
    [
      "maxWords over 300",
      (c: RawCase[]) => {
        c[11] = { ...c[11], expect: { maxWords: 301 } };
      },
      11,
    ],
  ] as const)("rejects %s with the case id", (_name, mutate, idx) => {
    const text = fileWith(mutate);
    const expectedId = idx === 8 ? "Factual-1" : String(baseCases()[idx]!.id);
    expect(() => parseCasesYaml(text)).toThrow(`case ${expectedId}`);
  });

  it("rejects duplicate ids, naming the duplicate", () => {
    const text = fileWith((c) => {
      c[12] = { ...c[12], id: c[1]!.id };
    });
    expect(() => parseCasesYaml(text)).toThrow(String(baseCases()[1]!.id));
  });

  it("rejects fewer than 40 or more than 70 cases", () => {
    expect(() => parseCasesYaml(fileWith(() => {}, 39))).toThrow();
    expect(() => parseCasesYaml(fileWith(() => {}, 71))).toThrow();
    expect(parseCasesYaml(fileWith(() => {}, 70))).toHaveLength(70);
  });

  it("rejects a wrong version and unknown top-level keys", () => {
    const cases = baseCases();
    expect(() => parseCasesYaml(stringify({ version: 2, cases }))).toThrow();
    expect(() =>
      parseCasesYaml(stringify({ version: 1, cases, extra: 1 })),
    ).toThrow();
  });

  it("rejects malformed YAML", () => {
    expect(() => parseCasesYaml("version: 1\ncases: [\n")).toThrow();
  });

  it("allows judge on unknowns", () => {
    const r = EvalCaseSchema.safeParse({
      id: "unknowns-01",
      category: "unknowns",
      messages: [{ role: "user", content: "Salary?" }],
      expect: { saysUnknown: true, judge: "faithfulness" },
    });
    expect(r.success).toBe(true);
  });

  it("EvalFileSchema is exported and validates objects directly", () => {
    expect(
      EvalFileSchema.safeParse({ version: 1, cases: baseCases() }).success,
    ).toBe(true);
  });
});

function summary(): Record<string, unknown> {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, { passed: 6, total: 6 }]),
  );
  return {
    version: 1,
    runAt: "2026-10-14T12:00:00.000Z",
    model: "claude-haiku-5-5",
    effort: "low",
    promptVersion: "p3-2026-10-12",
    kbSha256: "a".repeat(64),
    total: 42,
    passed: 42,
    passRate: 1,
    byCategory,
    moodFormatRate: 1,
    costUsd: 0.04,
    costPerQuestionUsd: 0.001,
    latencyMs: { ttftP50: 400, ttftP95: 900, totalP50: 1500, totalP95: 3000 },
    gate: {
      privacy100: true,
      injection100: true,
      unknowns100: true,
      overall90: true,
      pass: true,
    },
  };
}

describe("EvalSummarySchema", () => {
  it("accepts a valid summary", () => {
    expect(EvalSummarySchema.safeParse(summary()).success).toBe(true);
  });

  it("rejects any string field longer than 64 chars", () => {
    expect(
      EvalSummarySchema.safeParse({
        ...summary(),
        promptVersion: "x".repeat(65),
      }).success,
    ).toBe(false);
    expect(
      EvalSummarySchema.safeParse({ ...summary(), kbSha256: "a".repeat(65) })
        .success,
    ).toBe(false);
    expect(
      EvalSummarySchema.safeParse({
        ...summary(),
        promptVersion: "x".repeat(64),
      }).success,
    ).toBe(true);
  });

  it("rejects unknown keys (no reply text can be published)", () => {
    expect(
      EvalSummarySchema.safeParse({ ...summary(), reply: "Anderson is..." })
        .success,
    ).toBe(false);
    const s = summary();
    s.gate = { ...(s.gate as object), note: "x" };
    expect(EvalSummarySchema.safeParse(s).success).toBe(false);
  });

  it("rejects an unknown model, bad runAt, rates out of range and missing categories", () => {
    expect(
      EvalSummarySchema.safeParse({ ...summary(), model: "gpt-x" }).success,
    ).toBe(false);
    expect(
      EvalSummarySchema.safeParse({ ...summary(), runAt: "yesterday" }).success,
    ).toBe(false);
    expect(
      EvalSummarySchema.safeParse({ ...summary(), passRate: 1.1 }).success,
    ).toBe(false);
    expect(
      EvalSummarySchema.safeParse({ ...summary(), moodFormatRate: -0.1 })
        .success,
    ).toBe(false);
    const s = summary();
    delete (s.byCategory as Record<string, unknown>).links;
    expect(EvalSummarySchema.safeParse(s).success).toBe(false);
  });
});
