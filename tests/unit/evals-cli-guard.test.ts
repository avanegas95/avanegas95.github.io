// CLI guards (CLAUDE.md rule 5): CI refuses to spend, and there is no publishing
// path. The SDK constructor throws, so any attempt to build a real client fails.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

import { EXIT, RESULTS_DIR, main, parseArgs } from "../../evals/run.ts";
import { fakeClient, mkCase, reply } from "../fixtures/evals/fake-sdk.ts";

const KEY = "sk-ant-api03-test-key-not-real";
const SPEND_ENV = { EVAL_ALLOW_SPEND: "1", ANTHROPIC_API_KEY: KEY };

function harness() {
  const sdk = fakeClient(() => reply("<mood>happy</mood> Staff SQA Engineer."));
  const createClient = vi.fn(() => sdk.client);
  const files = new Map<string, string>();
  const out: string[] = [];
  let t = 0;
  return {
    sdk,
    createClient,
    files,
    out,
    deps: {
      createClient,
      loadCases: () => [
        mkCase("factual-01", "factual", "Q about Anderson?", {
          mustInclude: ["staff sqa"],
        }),
      ],
      kb: () => "KB text",
      now: () => (t += 10),
      writeFile: (p: string, d: string) => void files.set(p, d),
      log: (l: string) => void out.push(l),
      error: (l: string) => void out.push(l),
    },
  };
}

describe("CI refuses to spend", () => {
  it.each(["true", "1", "yes"])(
    "CI=%s with --spend exits non-zero before any SDK construction",
    async (ci) => {
      const h = harness();
      const code = await main(["--spend"], { ...SPEND_ENV, CI: ci }, h.deps);
      expect(code).toBe(EXIT.usage);
      expect(h.createClient).not.toHaveBeenCalled();
      expect(h.sdk.calls).toHaveLength(0);
      expect(h.files.size).toBe(0);
      expect(h.out.join("\n")).toMatch(/CI is set/);
      expect(h.out.join("\n")).not.toContain(KEY);
    },
  );

  it("CI=false or unset does not block a local paid run", async () => {
    for (const env of [{ ...SPEND_ENV, CI: "false" }, SPEND_ENV]) {
      const h = harness();
      await main(["--spend"], env, h.deps);
      expect(h.createClient).toHaveBeenCalledTimes(1);
    }
  });

  it("CI without --spend is still a harmless dry run", async () => {
    const h = harness();
    expect(await main([], { CI: "true" }, h.deps)).toBe(EXIT.pass);
    expect(h.createClient).not.toHaveBeenCalled();
  });
});

describe("no publishing path", () => {
  it.each([
    [["--publish"]],
    [["--publish-from", "x.json"]],
    [["--config", "haiku-low"]],
  ])("%j is an unknown-flag usage error before any client", async (argv) => {
    expect(() => parseArgs(argv)).toThrow(/unknown argument/);
    const h = harness();
    expect(await main(argv, SPEND_ENV, h.deps)).toBe(EXIT.usage);
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.files.size).toBe(0);
  });

  it("a dry run writes nothing; a paid run writes only under evals/results/", async () => {
    const dry = harness();
    expect(await main(["--dry-run"], SPEND_ENV, dry.deps)).toBe(EXIT.pass);
    expect(dry.files.size).toBe(0);
    expect(dry.out.join("\n")).toMatch(/cases: 1;/);

    const paid = harness();
    await main(["--spend"], SPEND_ENV, paid.deps);
    const paths = [...paid.files.keys()];
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p.startsWith(`${RESULTS_DIR}/`)).toBe(true);
    }
  });

  it("evals/ source has no publishing code or src/ writes", () => {
    const files = [
      "evals/run.ts",
      ...readdirSync("evals/lib").map((f) => join("evals/lib", f)),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(
        /evals\.json|src\/data\/quality|publishedFile|--publish/,
      );
    }
  });
});
