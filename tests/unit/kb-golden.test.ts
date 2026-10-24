import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KB_ROOT,
  buildKb,
  loadKbSources,
  renderKbSection,
} from "../../src/lib/kb.ts";

// Each golden is one KB file's prompt section, captured from the tree before
// the P5.5-13a frontmatter migration. Never edit a golden to make this pass:
// a content change updates only the golden of the file it touches.
const GOLDEN = "tests/fixtures/kb/golden";
const golden = (path: string): string =>
  readFileSync(`${GOLDEN}/${path.replace(/\.md$/, ".txt")}`, "utf8");

const sources = loadKbSources(KB_ROOT);

describe("KB prompt goldens", () => {
  it.each(sources.map((s) => [s.path, s] as const))(
    "%s renders byte-identical to its golden",
    (_, src) => {
      expect(renderKbSection(src) ?? "").toBe(golden(src.path));
    },
  );

  it("full KB equals the sorted concatenation of the goldens", () => {
    const parts = sources
      .map((s) => s.path)
      .sort()
      .map(golden)
      .filter((g) => g !== "");
    expect(buildKb(sources)).toBe(parts.join("\n"));
  });
});
