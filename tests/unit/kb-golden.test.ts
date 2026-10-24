import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KB_ROOT,
  buildKb,
  loadKbSources,
  parseKbSource,
  renderKbSection,
} from "../../src/lib/kb.ts";
import { withRoleFields, withSiteBullet } from "./kb-inject.ts";

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
      raw: withSiteBullet(exp.raw, "SITE-ONLY-MARKER"),
    };
    expect(withSite.raw).toContain("SITE-ONLY-MARKER");
    const out = renderKbSection(withSite) ?? "";
    expect(out).not.toContain("SITE-ONLY-MARKER");
    expect(out).toBe(golden(exp.path));
    // Nor does any real siteBullet that differs from the full bullets.
    const { roles } = parseKbSource(exp).data as unknown as {
      roles: { bullets: string[]; siteBullets?: string[] }[];
    };
    const realSite = roles.flatMap((r) =>
      (r.siteBullets ?? []).filter((b) => !r.bullets.includes(b)),
    );
    for (const b of realSite) expect(out).not.toContain(b);
  });

  it("siteGroup, siteTitle and showOnSite never reach the prompt: Blob keeps separate roles", () => {
    const exp = sources.find((s) => s.path.endsWith("experience.md"));
    if (!exp) throw new Error("experience.md not found");
    const out = renderKbSection(exp) ?? "";
    const { roles } = parseKbSource(exp).data as unknown as {
      roles: { title: string; siteTitle?: string }[];
    };
    // Every role, hidden ones included, is rendered separately by its own title.
    for (const r of roles) expect(out).toContain(`: ${r.title} (`);
    expect(out).toContain("Product Development Intern");
    expect(out).not.toContain("sharkninja-sqa");
    for (const r of roles) {
      // A siteTitle that equals some role's own title proves nothing; any
      // other value must not appear in the prompt.
      if (r.siteTitle && !roles.some((x) => x.title === r.siteTitle)) {
        expect(out).not.toContain(r.siteTitle);
      }
    }
    const marked = {
      ...exp,
      raw: withRoleFields(exp.raw, {
        siteGroup: "SITE-GROUP-MARKER",
        siteTitle: "SITE-TITLE-MARKER",
      }),
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
