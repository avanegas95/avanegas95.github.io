import { describe, expect, it } from "vitest";
import { groupRoles } from "../../src/lib/experience-groups.ts";
import { KB_ROOT, loadKbSources, parseKbSource } from "../../src/lib/kb.ts";
import type { Role } from "../../src/lib/kb-schema.ts";

const role = (over: Partial<Role>): Role => ({
  company: "Acme",
  title: "T",
  start: "2020-01",
  end: null,
  showOnSite: true,
  bullets: [],
  ...over,
});

describe("groupRoles", () => {
  it("leaves ungrouped roles as one card each, in order, with site bullets preferred", () => {
    const out = groupRoles([
      role({ title: "A", bullets: ["full"], siteBullets: ["short"] }),
      role({ title: "B", start: "2018-01", end: "2020-01", bullets: ["b"] }),
    ]);
    expect(out.map((c) => c.title)).toEqual(["A", "B"]);
    expect(out[0]?.bullets).toEqual(["short"]);
    expect(out[1]?.bullets).toEqual(["b"]);
  });

  it("merges consecutive roles of one siteGroup: earliest start, latest end, siteTitle, newest bullets first", () => {
    const [card, ...rest] = groupRoles([
      role({
        title: "Two",
        start: "2022-04",
        end: "2023-09",
        siteGroup: "g",
        siteTitle: "One/Two",
        bullets: ["two-full"],
        siteBullets: ["two-short"],
      }),
      role({
        title: "One",
        start: "2019-11",
        end: "2022-04",
        siteGroup: "g",
        bullets: ["one"],
      }),
    ]);
    expect(rest).toEqual([]);
    expect(card).toEqual({
      company: "Acme",
      title: "One/Two",
      start: "2019-11",
      end: "2023-09",
      bullets: ["two-short", "one"],
    });
  });

  it("a group member with siteBullets: [] contributes no bullets to the merged card", () => {
    const [card, ...rest] = groupRoles([
      role({
        title: "New",
        siteGroup: "g",
        siteTitle: "X",
        siteBullets: ["a"],
      }),
      role({
        title: "Old",
        start: "2018-01",
        end: "2020-01",
        siteGroup: "g",
        bullets: ["full"],
        siteBullets: [],
      }),
    ]);
    expect(rest).toEqual([]);
    expect(card?.bullets).toEqual(["a"]);
    expect(card?.start).toBe("2018-01");
  });

  it("a lone role with siteBullets: [] shows no bullets (empty is not a fallback to the full bullets)", () => {
    const [card] = groupRoles([role({ bullets: ["full"], siteBullets: [] })]);
    expect(card?.bullets).toEqual([]);
  });

  it("a present role keeps the merged card open-ended", () => {
    const [card] = groupRoles([
      role({ title: "Now", end: null, siteGroup: "g", siteTitle: "X" }),
      role({ title: "Then", start: "2018-01", end: "2020-01", siteGroup: "g" }),
    ]);
    expect(card?.end).toBeNull();
    expect(card?.start).toBe("2018-01");
  });

  it("the same siteGroup separated by another role does not merge", () => {
    const out = groupRoles([
      role({ title: "A", siteGroup: "g" }),
      role({ title: "Mid" }),
      role({ title: "C", siteGroup: "g" }),
    ]);
    expect(out.map((c) => c.title)).toEqual(["A", "Mid", "C"]);
  });

  it("falls back to the first role's title when no siteTitle is set", () => {
    const [card] = groupRoles([
      role({ title: "First", siteGroup: "g" }),
      role({
        title: "Second",
        start: "2019-01",
        end: "2020-01",
        siteGroup: "g",
      }),
    ]);
    expect(card?.title).toBe("First");
  });
});

describe("the real KB on the site", () => {
  const src = loadKbSources(KB_ROOT).find((s) => s.path === "experience.md");
  if (!src) throw new Error("experience.md not found");
  const data = parseKbSource(src).data as unknown as { roles: Role[] };
  const cards = groupRoles(data.roles.filter((r) => r.showOnSite));

  it("shows Staff, Senior and one SQA Engineer I/II card built from the visible roles' site bullets", () => {
    expect(cards.map((c) => c.title)).toEqual([
      "Staff SQA Engineer",
      "Senior SQA Engineer",
      "SQA Engineer I/II",
    ]);
    // The site shows siteBullets ?? bullets per visible role.
    const shown = data.roles.filter((r) => r.showOnSite);
    expect(cards.map((c) => c.bullets)).toEqual(
      shown.map((r) => r.siteBullets ?? r.bullets),
    );
    const sqa = cards[2];
    expect(sqa).toMatchObject({ company: "SharkNinja" });
    // A group member hidden with showOnSite: false (and siteBullets: []) adds
    // neither dates nor bullets to the merged card.
    const groupShown = shown.filter((r) => r.siteGroup === "sharkninja-sqa");
    expect(sqa?.start).toBe(
      groupShown.map((r) => r.start).reduce((m, x) => (x < m ? x : m)),
    );
    expect(sqa?.end).toBe("2023-09");
    expect(sqa?.bullets).toHaveLength(4);
  });

  it("hides the Product Development Intern but the KB still has it", () => {
    const intern = data.roles.find(
      (r) => r.title === "Product Development Intern",
    );
    expect(intern?.showOnSite).toBe(false);
    expect(cards.map((c) => c.title)).not.toContain(
      "Product Development Intern",
    );
  });
});
