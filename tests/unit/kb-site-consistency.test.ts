import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const site = readFileSync("src/content/knowledge/site.md", "utf8");
const discrepancies = readFileSync("docs/DISCREPANCIES.md", "utf8");

type Row = { id: string; cells: string[] };

function parseRows(md: string): Row[] {
  return md
    .split("\n")
    .filter((line) => /^\|\s*D-\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .replace(/^\||\|\s*$/g, "")
        .split("|")
        .map((c) => c.trim());
      return { id: cells[0], cells };
    });
}

describe("site.md matches the v1 site", () => {
  it("does not claim light and dark themes", () => {
    expect(site.toLowerCase()).not.toContain("light and dark");
  });
  it("does not mention a contact form (D-13 interim rule)", () => {
    expect(site.toLowerCase()).not.toContain("contact form");
  });
  it("does not call the site single-page", () => {
    expect(site.toLowerCase()).not.toMatch(/single[- ]page/);
  });
  it("mentions the Blob privacy page", () => {
    expect(site).toContain("/blob-privacy/");
  });
});

describe("DISCREPANCIES.md table", () => {
  const rows = parseRows(discrepancies);

  it("has rows", () => {
    expect(rows.length).toBeGreaterThan(0);
  });
  it("has unique, sequential IDs", () => {
    const nums = rows.map((r) => Number(r.id.slice(2)));
    expect(new Set(nums).size).toBe(nums.length);
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });
  it("gives every row an interim rule and a status", () => {
    for (const r of rows) {
      expect(r.cells.length, r.id).toBeGreaterThanOrEqual(5);
      expect(r.cells[3], `${r.id} interim rule`).not.toBe("");
      expect(r.cells[4], `${r.id} status`).not.toBe("");
    }
  });
});
