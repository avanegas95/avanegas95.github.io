// The frontmatter parser Astro's glob loader uses for markdown collections.
import { parseFrontmatter } from "@astrojs/internal-helpers/frontmatter";
import { describe, expect, it } from "vitest";
import {
  KB_ROOT,
  buildKb,
  loadKbSources,
  parseKbSource,
} from "../../src/lib/kb.ts";
import {
  KnowledgeSchema,
  ProjectSchema,
  RoleSchema,
  VOICE_FIELDS,
} from "../../src/lib/kb-schema.ts";

const role = [
  "  - company: Boston Dynamics",
  "    title: Staff SQA Engineer",
  "    employment: full time",
  '    start: "2026-03"',
  "    end: null",
  "    showOnSite: true",
  "    bullets:",
  "      - Owns triage.",
];

const experience = (lines: string[]) => ({
  path: "experience.md",
  raw: [
    "---",
    "topic: experience",
    "title: Work experience",
    "summary: Roles.",
    "updated: 2026-10-13",
    "public: true",
    "roles:",
    ...lines,
    "---",
    "",
  ].join("\n"),
});

describe("kb-schema", () => {
  it("a valid role parses and renders", () => {
    const f = parseKbSource(experience(role));
    expect(f.data.topic === "experience" && f.data.roles?.[0]).toEqual({
      company: "Boston Dynamics",
      title: "Staff SQA Engineer",
      employment: "full time",
      start: "2026-03",
      end: null,
      showOnSite: true,
      bullets: ["Owns triage."],
    });
    expect(buildKb([experience(role)])).toBe(
      "## Work experience\n\nRoles.\n\n### Boston Dynamics: Staff SQA Engineer (full time), March 2026 to present\n\n- Owns triage.\n",
    );
  });

  it.each([
    ["unquoted start", role.map((l) => l.replace('"2026-03"', "2026-03"))],
    ["unquoted end", role.map((l) => l.replace("end: null", "end: 2026-04"))],
    ["duplicate key", [...role, "    title: Again"]],
    ["unknown key", [...role, "    salary: 1"]],
    ["non-month end", role.map((l) => l.replace("end: null", 'end: "March"'))],
    ["bad month", role.map((l) => l.replace('"2026-03"', '"2026-13"'))],
    ["inline comment", role.map((l) => l.replace("full time", "full # time"))],
  ])("%s throws with the file path", (_, lines) => {
    expect(() => parseKbSource(experience(lines))).toThrow(/experience\.md/);
  });

  it("rejects an unknown top-level key and a wrong-topic field", () => {
    const raw = experience(role).raw;
    const extra = raw.replace("public: true", "public: true\nphone: x");
    expect(() => parseKbSource({ path: "experience.md", raw: extra })).toThrow(
      /experience\.md/,
    );
    const wrong = raw.replace("topic: experience", "topic: bio");
    expect(() => parseKbSource({ path: "bio.md", raw: wrong })).toThrow(
      /bio\.md/,
    );
  });

  it("RoleSchema rejects a YAML date object", () => {
    const r = { ...RoleSchema.parse({ ...base(), end: null }) };
    expect(RoleSchema.safeParse({ ...r, start: new Date() }).success).toBe(
      false,
    );
  });

  it("exports the voice field paths", () => {
    expect(VOICE_FIELDS).toContain("experience.roles[].bullets[]");
    expect(VOICE_FIELDS).toContain("bio.lede");
  });
});

function base() {
  return {
    company: "C",
    title: "T",
    start: "2020-01",
    showOnSite: true,
    bullets: [],
  };
}

describe("parity: kb.ts and the collection loader", () => {
  it.each(loadKbSources(KB_ROOT).map((s) => [s.path, s] as const))(
    "%s yields equal data",
    (path, src) => {
      const schema = path.startsWith("projects/")
        ? ProjectSchema
        : KnowledgeSchema;
      const astro = schema.parse(parseFrontmatter(src.raw).frontmatter);
      const ours = parseKbSource(src).data;
      expect(ours).toEqual(astro);
      expect(ours.updated).toBeInstanceOf(Date);
    },
  );
});
