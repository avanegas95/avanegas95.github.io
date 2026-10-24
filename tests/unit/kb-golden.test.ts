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

  it("siteBullets never reach the prompt: Blob keeps the full bullets", () => {
    const exp = sources.find((s) => s.path.endsWith("experience.md"));
    if (!exp) throw new Error("experience.md not found");
    const withSite = {
      ...exp,
      raw: exp.raw.replace(
        "    showOnSite: true\n    bullets:\n",
        '    showOnSite: true\n    siteBullets:\n      - "SITE-ONLY-MARKER"\n    bullets:\n',
      ),
    };
    expect(withSite.raw).toContain("SITE-ONLY-MARKER");
    const out = renderKbSection(withSite) ?? "";
    expect(out).not.toContain("SITE-ONLY-MARKER");
    expect(out).toBe(golden(exp.path));
  });

  it("siteGroup, siteTitle and showOnSite never reach the prompt: Blob keeps separate roles", () => {
    const exp = sources.find((s) => s.path.endsWith("experience.md"));
    if (!exp) throw new Error("experience.md not found");
    const out = renderKbSection(exp) ?? "";
    expect(out).toContain("SQA Engineer II");
    expect(out).toContain("Product Development Intern");
    expect(out).not.toContain("I/II");
    expect(out).not.toContain("sharkninja-sqa");
    const marked = {
      ...exp,
      raw: exp.raw.replace(
        "    showOnSite: true\n    bullets:\n",
        '    showOnSite: true\n    siteGroup: "SITE-GROUP-MARKER"\n    siteTitle: "SITE-TITLE-MARKER"\n    bullets:\n',
      ),
    };
    expect(marked.raw).toContain("SITE-TITLE-MARKER");
    expect(renderKbSection(marked) ?? "").toBe(golden(exp.path));
  });

  it("full KB equals the sorted concatenation of the goldens", () => {
    const parts = sources
      .map((s) => s.path)
      .sort()
      .map(golden)
      .filter((g) => g !== "");
    expect(buildKb(sources)).toBe(parts.join("\n"));
  });
});
