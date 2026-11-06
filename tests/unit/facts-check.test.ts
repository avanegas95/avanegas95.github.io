import { cpSync, mkdtempSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KB_ROOT, loadKbSources, type KbSource } from "../../src/lib/kb.ts";
import { main, runChecks } from "../../scripts/facts-check.ts";

const kbFile = (body: string, path = "bio.md"): KbSource => ({
  path,
  raw: `---\ntopic: bio\ntitle: T\nsummary: S\nupdated: 2026-01-01\npublic: true\n---\n${body}\n`,
});
const site = (text: string, path = "src/components/sections/Home.astro") => [
  { path, text },
];
const rules = (f: { rule: string; severity: string }[]) =>
  f.map((x) => `${x.rule}:${x.severity}`);

describe("facts-check runChecks", () => {
  it.each([
    ["a year count in the KB (D-03)", "He has 10 years in QA.", "D-03"],
    [
      "a 17 years count is not 7 years (D-03)",
      "He has 17 years in QA.",
      "D-03",
    ],
    ["a plus year count (D-03)", "Over 10+ years of testing.", "D-03"],
    ["Boston, MA without area (D-05)", "Based in Boston, MA.", "D-05"],
    ["TestRails (D-09)", "Uses TestRails daily.", "D-09"],
  ])("%s is an error", (_n, body, rule) => {
    const f = runChecks([kbFile(body)], []);
    expect(rules(f)).toContain(`${rule}:error`);
    expect(f.find((x) => x.rule === rule)?.line).toBe(8);
  });

  it.each([
    "Based in the Boston area, MA.",
    "Boston University, Boston, MA",
    "Uses TestRail daily.",
    "Working since 2019.",
    "Senior role with 7 years of experience in manual testing.",
    "and 3 years in automation testing.",
    "More than 700 test cases.",
  ])("clean text %j produces no findings", (body) => {
    expect(runChecks([kbFile(body)], [])).toEqual([]);
  });

  it("a misspelling is a suggestion only", () => {
    const f = runChecks([kbFile("I like teh tests.")], []);
    expect(rules(f)).toEqual(["misspelling:suggestion"]);
  });

  it("D-03 resolved: 7 years and 3 years are allowed, other counts are not", () => {
    expect(runChecks([kbFile("7 years and 3 years")], [])).toEqual([]);
    expect(rules(runChecks([kbFile("7+ years")], []))).toContain("D-03:error");
    expect(rules(runChecks([kbFile("5 years and 7 years")], []))).toContain(
      "D-03:error",
    );
  });

  it("D-14: a hero that calls him Senior is an error on the site only; its 7 years is not", () => {
    const hero = "<p>Senior SQA Engineer with 7 years of experience</p>";
    expect(rules(runChecks([], site(hero)))).toEqual(["D-14:error"]);
    expect(runChecks([kbFile(hero)], []).some((f) => f.rule === "D-14")).toBe(
      false,
    );
  });

  it("PII in the KB or the site is an error (fictional number built at runtime)", () => {
    const phone = ["617", "555", `${"01"}${"23"}`].join("-");
    expect(
      runChecks([kbFile(`Call ${phone}`)], []).some((f) =>
        f.rule.startsWith("pii:"),
      ),
    ).toBe(true);
    expect(
      runChecks([], site(`<p>${phone}</p>`)).some((f) =>
        f.rule.startsWith("pii:"),
      ),
    ).toBe(true);
  });

  describe("date and title mismatches between KB and site", () => {
    const exp: KbSource = {
      path: "experience.md",
      raw: [
        "---",
        "topic: experience",
        "title: t",
        "summary: s",
        "updated: 2026-01-01",
        "public: true",
        "roles:",
        "  - company: Acme",
        "    title: Staff Tester",
        "    start: '2026-03'",
        "    end: null",
        "    showOnSite: true",
        "    bullets: []",
        "---",
        "body",
      ].join("\n"),
    };
    const card = (title: string, dates: string) =>
      site(
        `<p class="experience-card__company">Acme</p>\n<h3 class="experience-card__role">${title}</h3>\n<p class="experience-card__dates">${dates}</p>`,
        "src/components/sections/Experiences.astro",
      );

    it("matching title and dates: no findings", () => {
      expect(
        runChecks([exp], card("Staff Tester", "March 2026 – Present")),
      ).toEqual([]);
      expect(runChecks([exp], card("Staff Tester", "2026 – Present"))).toEqual(
        [],
      );
    });
    it("a different title is an error", () => {
      expect(
        rules(runChecks([exp], card("Senior Tester", "2026 – Present"))),
      ).toEqual(["title-mismatch:error"]);
    });
    it.each(["2025 – Present", "2026 – 2027", "April 2026 – Present"])(
      "dates %j differ from the KB",
      (d) => {
        expect(rules(runChecks([exp], card("Staff Tester", d)))).toEqual([
          "date-mismatch:error",
        ]);
      },
    );
  });

  describe("a combined site card (siteGroup / siteTitle)", () => {
    const role = (
      title: string,
      start: string,
      end: string,
      extra: string[],
    ) => [
      "  - company: Acme",
      `    title: ${title}`,
      `    start: '${start}'`,
      `    end: '${end}'`,
      "    showOnSite: true",
      "    bullets: []",
      ...extra,
    ];
    const grouped: KbSource = {
      path: "experience.md",
      raw: [
        "---",
        "topic: experience",
        "title: t",
        "summary: s",
        "updated: 2026-01-01",
        "public: true",
        "roles:",
        ...role("QA II", "2022-04", "2023-09", [
          "    siteGroup: qa",
          "    siteTitle: QA I/II",
        ]),
        ...role("QA", "2019-11", "2022-04", ["    siteGroup: qa"]),
        "---",
        "body",
      ].join("\n"),
    };
    const card = (title: string, dates: string) =>
      site(
        `<p class="experience-card__company">Acme</p>\n<h3 class="experience-card__role">${title}</h3>\n<p class="experience-card__dates">${dates}</p>`,
        "src/components/sections/Experiences.astro",
      );

    it("accepts the combined title with the merged date range", () => {
      expect(
        runChecks([grouped], card("QA I/II", "November 2019 – September 2023")),
      ).toEqual([]);
    });
    it("the combined title with one role's dates is a date mismatch", () => {
      expect(
        rules(
          runChecks([grouped], card("QA I/II", "April 2022 – September 2023")),
        ),
      ).toEqual(["date-mismatch:error"]);
    });
    it("a title that is not in the KB is still an error", () => {
      expect(
        rules(runChecks([grouped], card("QA III", "2019 – 2023"))),
      ).toEqual(["title-mismatch:error"]);
    });
  });
});

describe("facts-check is report-only", () => {
  const mtimes = (root: string): Record<string, number> => {
    const out: Record<string, number> = {};
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out[p] = statSync(p).mtimeMs;
      }
    };
    walk(root);
    return out;
  };

  it("runChecks leaves every KB file's mtime unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "facts-"));
    try {
      cpSync(KB_ROOT, dir, { recursive: true });
      const before = mtimes(dir);
      runChecks(loadKbSources(dir), site("7 years of teh TestRails"));
      expect(mtimes(dir)).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the CLI leaves src, scripts, docs and tests untouched", () => {
    const roots = ["src", "scripts", "docs", "tests/fixtures"];
    const before = roots.map(mtimes);
    const out: string[] = [];
    main((s) => out.push(s));
    expect(roots.map(mtimes)).toEqual(before);
    expect(out.at(-1)).toContain("report only");
  });
});
