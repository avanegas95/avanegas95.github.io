// CLAUDE.md rule 5: the paid eval runner never runs in PR CI or in the unit suite.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = ".github/workflows";

describe("CI never runs the paid evals", () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  it("quality.yml exists", () => {
    expect(files).toContain("quality.yml");
  });

  it.each(["evals/", "npm run eval", "ANTHROPIC_API_KEY", "EVAL_ALLOW_SPEND"])(
    "quality.yml does not reference %s",
    (needle) => {
      const yml = readFileSync(join(WORKFLOWS, "quality.yml"), "utf8");
      expect(yml).not.toContain(needle);
    },
  );

  it("quality.yml has no eval/spend flags in any form", () => {
    const yml = readFileSync(join(WORKFLOWS, "quality.yml"), "utf8");
    expect(yml).not.toMatch(/\beval(?::dry)?\b|--spend|evals[\\/]/);
  });

  it("vitest only collects tests/unit and never evals/", () => {
    const cfg = readFileSync("vitest.config.ts", "utf8");
    expect(cfg).not.toContain("evals/");
    expect(cfg).toMatch(
      /include:\s*\[\s*"tests\/unit\/\*\*\/\*\.test\.ts"\s*\]/,
    );
  });

  it("evals/ holds no test files vitest could pick up", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    const found = walk("evals").filter(
      (f) => !f.includes("results") && /\.(test|spec)\.[cm]?[jt]s$/.test(f),
    );
    expect(found).toEqual([]);
  });
});
