import { describe, expect, it } from "vitest";
import { projects } from "../../src/data/projects";

const urls = projects.flatMap((p) =>
  [p.github, p.external].filter((u): u is string => Boolean(u)),
);

describe("projects data", () => {
  it("has projects", () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  it("has no tracking params in any URL", () => {
    for (const u of urls) {
      expect(u).not.toMatch(/wfuid|wfsid|utm_|fbclid|gclid/i);
    }
  });

  it("uses only https or same-site URLs", () => {
    for (const u of urls) {
      expect(u.startsWith("https:") || u.startsWith("/")).toBe(true);
    }
  });

  it("has no placeholder titles", () => {
    for (const p of projects) {
      expect(p.title).not.toMatch(/place\s*holder/i);
    }
  });

  it("has no empty tech entries", () => {
    for (const p of projects) {
      for (const t of p.tech) expect(t.trim()).not.toBe("");
    }
  });

  it("has unique titles", () => {
    const titles = projects.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
