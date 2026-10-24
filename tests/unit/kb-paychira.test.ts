import { describe, expect, it } from "vitest";
import { buildKb, loadKbSources } from "../../src/lib/kb.ts";

describe("kb-paychira", () => {
  it("loads projects/paychira.md and no finance-forecast path", () => {
    const paths = loadKbSources().map((s) => s.path);
    expect(paths).toContain("projects/paychira.md");
    expect(paths.some((p) => p.includes("finance-forecast"))).toBe(false);
  });

  it("builds the Paychira section and drops Finance Forecast", () => {
    const kb = buildKb(loadKbSources());
    expect(kb).toContain("## Project: Paychira");
    expect(kb).not.toContain("Finance Forecast");
  });
});
