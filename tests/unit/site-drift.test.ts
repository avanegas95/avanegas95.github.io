import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KB_ROOT, loadKbSources } from "../../src/lib/kb.ts";
import {
  ALLOW_DIR,
  DRIFT_COMPONENTS,
  SECTIONS_DIR,
  checkDrift,
  driftConfigFromKb,
  type DriftConfig,
} from "../../scripts/facts-check.ts";

const cfg: DriftConfig = {
  employers: ["Acme Corp"],
  titles: ["Staff Tester"],
};
const check = (component: string, allow = "") =>
  checkDrift("Fixture.astro", component, allow, cfg, "Fixture.astro.txt");

describe("site-drift ratchet (fixtures)", () => {
  it("a year range in a component fails", () => {
    const f = check("<p>2019 – 2023</p>");
    expect(f.map((x) => x.rule)).toEqual(["site-drift"]);
    expect(f[0]?.line).toBe(1);
  });

  it.each([
    ["a year range", "<p>2019 - Present</p>"],
    ["years of experience", "<p>lots of years of experience</p>"],
    ["a month-to-month range", "<p>November 2019 – September 2023</p>"],
    ["a month-to-year range", "<p>September 2023 – 2026</p>"],
    ["a year count", "<p>7+ years</p>"],
    ["a generic job title", "<h3>Senior SQA Engineer</h3>"],
    ["a KB job title", "<h3>Staff Tester</h3>"],
    ["a KB employer", "<p>Acme Corp</p>"],
  ])("%s fails", (_n, line) => {
    expect(check(`<div>\n${line}\n</div>`).map((x) => x.rule)).toEqual([
      "site-drift",
    ]);
  });

  it("a component without fact patterns passes", () => {
    expect(check("<h2>Experiences</h2>\n<p>Hello</p>")).toEqual([]);
  });

  it("the same line in its allow file passes", () => {
    expect(check("  <p>2019 – 2023</p>", "<p>2019 – 2023</p>\n")).toEqual([]);
  });

  it("a stale allow line fails and points at the allow file", () => {
    const f = check("<p>Hello</p>", "<p>2019 – 2023</p>\n");
    expect(f.map((x) => x.rule)).toEqual(["site-drift-stale-allow"]);
    expect(f[0]).toMatchObject({ file: "Fixture.astro.txt", line: 1 });
  });

  it("allow lines are counted: a second copy of an allowed line fails", () => {
    const f = check("<p>Acme Corp</p>\n<p>Acme Corp</p>", "<p>Acme Corp</p>\n");
    expect(f.map((x) => x.rule)).toEqual(["site-drift"]);
    expect(f[0]?.line).toBe(2);
  });

  it("an allow line listed twice but present once is stale", () => {
    const f = check("<p>Acme Corp</p>", "<p>Acme Corp</p>\n<p>Acme Corp</p>\n");
    expect(f.map((x) => x.rule)).toEqual(["site-drift-stale-allow"]);
  });
});

// A fully cleaned component has no allow file at all (Contact, P5.5-06): that reads as empty.
function readAllow(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("site-drift ratchet (real section components)", () => {
  const real = driftConfigFromKb(loadKbSources(KB_ROOT));

  it("derives employers and titles from the KB", () => {
    expect(real.employers).toContain("Boston Dynamics");
    expect(real.titles).toContain("Staff SQA Engineer");
  });

  // Pinned so that adding an allow line next to a new hit fails here and is
  // seen in review. The ratchet only shrinks: lower a number, never raise it.
  const ALLOW_LINES = {
    Home: 2,
    About: 0,
    Experiences: 19,
    Projects: 0,
    Contact: 0,
  } as const;

  it.each(DRIFT_COMPONENTS)(
    "%s allow file has its pinned line count",
    (name) => {
      const lines = readAllow(`${ALLOW_DIR}/${name}.astro.txt`)
        .split("\n")
        .filter((l) => l.trim() !== "");
      expect(lines).toHaveLength(ALLOW_LINES[name]);
    },
  );

  it.each(DRIFT_COMPONENTS)(
    "%s.astro matches its allow file exactly",
    (name) => {
      const comp = `${SECTIONS_DIR}/${name}.astro`;
      const allow = `${ALLOW_DIR}/${name}.astro.txt`;
      const findings = checkDrift(
        comp,
        readFileSync(comp, "utf8"),
        readAllow(allow),
        real,
        allow,
      );
      expect(findings).toEqual([]);
    },
  );
});
