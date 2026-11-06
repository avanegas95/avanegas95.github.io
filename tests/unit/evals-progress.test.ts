// Live progress: one line per finished case, ids and check names only, never reply text.
import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Forbidden {
    constructor() {
      throw new Error("real Anthropic client constructed in a test");
    }
  }
  return { ...actual, default: Forbidden, Anthropic: Forbidden };
});

import { main, progressLine } from "../../evals/run.ts";
import type { CaseRun } from "../../evals/lib/runner.ts";
import { fakeClient, mkCase, reply } from "../fixtures/evals/fake-sdk.ts";

const KEY = "sk-ant-api03-test-key-not-real";
const REPLY = "<mood>happy</mood> Staff SQA Engineer, secret-reply-text.";

function run(over: Partial<CaseRun> = {}): CaseRun {
  return {
    id: "factual-01",
    category: "factual",
    reply: { text: REPLY } as CaseRun["reply"],
    usage: { input_tokens: 1, output_tokens: 1 } as CaseRun["usage"],
    costMicroUsd: 10,
    ttftMs: 1,
    totalMs: 2,
    grade: { pass: true, checks: [], needsJudge: false },
    ...over,
  };
}

describe("progressLine", () => {
  it("pass shows position, label, id and running spend", () => {
    expect(progressLine(3, 54, "haiku/low", run(), 12_345)).toBe(
      "[ 3/54] haiku/low factual-01: PASS · $0.0123",
    );
  });

  it("fail lists the failed check ids", () => {
    const r = run({
      grade: {
        pass: false,
        needsJudge: false,
        checks: [
          { id: "max_words", pass: false, detail: "130 > 120" },
          { id: "no_emoji", pass: true },
          { id: "redirects", pass: false, detail: "judge: no" },
        ],
      },
    });
    expect(progressLine(1, 9, "c", r, 0)).toBe(
      "[1/9] c factual-01: FAIL (max_words, redirects) · $0.0000",
    );
  });

  it("an unfaithful judge verdict counts as a failure", () => {
    const r = run({
      grade: { pass: true, checks: [], needsJudge: true },
      judge: {
        faithful: false,
        reason: "x",
        usage: null,
        stopReason: "end_turn",
      },
    });
    expect(progressLine(1, 1, "c", r, 0)).toContain("FAIL (judge)");
  });

  it("skips and errors are labelled", () => {
    expect(progressLine(1, 1, "c", run({ skipped: "budget" }), 0)).toContain(
      "SKIP (budget)",
    );
    expect(
      progressLine(1, 1, "c", run({ errorClass: "APIConnectionError" }), 0),
    ).toContain("ERROR (APIConnectionError)");
  });

  it("never includes reply text", () => {
    expect(progressLine(1, 1, "c", run(), 0)).not.toContain(
      "secret-reply-text",
    );
  });
});

describe("main prints progress while it runs", () => {
  it("logs one progress line per case, in order, before the summary", async () => {
    const sdk = fakeClient(() => reply(REPLY));
    const out: string[] = [];
    let t = 0;
    await main(
      ["--spend"],
      { EVAL_ALLOW_SPEND: "1", ANTHROPIC_API_KEY: KEY },
      {
        createClient: () => sdk.client,
        loadCases: () => [
          mkCase("factual-01", "factual", "Q1?", {
            mustInclude: ["staff sqa"],
          }),
          mkCase("factual-02", "factual", "Q2?", { mustInclude: ["nope"] }),
        ],
        kb: () => "KB text",
        now: () => (t += 10),
        writeFile: () => {},
        log: (l: string) => void out.push(l),
        error: (l: string) => void out.push(l),
      },
    );
    const progress = out.filter((l) => /^\[\d\/2\]/.test(l));
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatch(/^\[1\/2\] .* factual-01: PASS · \$/);
    expect(progress[1]).toMatch(
      /^\[2\/2\] .* factual-02: FAIL \(must_include\) · \$/,
    );
    expect(out.indexOf(progress[1] as string)).toBeLessThan(
      out.findIndex((l) => l.startsWith("spent:")),
    );
    expect(out.join("\n")).not.toContain("secret-reply-text");
    expect(out.join("\n")).not.toContain(KEY);
  });
});
