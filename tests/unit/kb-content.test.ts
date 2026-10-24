import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KB_ROOT,
  buildKb,
  loadKbSources,
  type KbSource,
} from "../../src/lib/kb.ts";

// Content rules for the real KB. Rules mirror CLAUDE.md and the interim rules
// in docs/DISCREPANCIES.md. Matchers are pure functions returning a list of
// violations. Real-KB tests run them on the real files (expect none). The
// self-tests run them on small hand-written fixtures (one passing, one
// violating), never on mutated copies of the real files, so a legitimate
// rewording of real content cannot break a self-test.

const REQUIRED_ROOT = [
  "bio",
  "experience",
  "education",
  "skills",
  "contact",
  "faq",
  "site",
];
const MIN_PROJECTS = 3;

// ---------- helpers ----------

function frontmatter(raw: string): Record<string, string> {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: Record<string, string> = {};
  if (lines[0]?.trimEnd() !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trimEnd() === "---") break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = (m[2] as string).trim();
    if (
      v.length >= 2 &&
      ((v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'")))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1] as string] = v;
  }
  return out;
}

function bodyOf(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trimEnd() === "---") {
      end = i;
      break;
    }
  }
  return lines.slice(end + 1).join("\n");
}

const isHeading = (l: string): boolean => /^#{1,6} /.test(l);

type Section = { heading: string; text: string };

/** Split a body into heading-delimited sections (heading line + content). */
function sectionsOf(body: string): Section[] {
  const out: Section[] = [];
  let cur: string[] | null = null;
  for (const l of body.split("\n")) {
    if (isHeading(l)) {
      if (cur) out.push({ heading: cur[0] as string, text: cur.join("\n") });
      cur = [l];
    } else if (cur) {
      cur.push(l);
    }
  }
  if (cur) out.push({ heading: cur[0] as string, text: cur.join("\n") });
  return out;
}

const sources = loadKbSources(KB_ROOT);
const built = buildKb(sources);
const raw = (path: string): string => {
  const s = sources.find((x) => x.path === path);
  if (!s) throw new Error(`test: KB file missing: ${path}`);
  return s.raw;
};

// ---------- matchers (return violations) ----------

function requiredFilesViolations(srcs: readonly KbSource[]): string[] {
  const v: string[] = [];
  const paths = srcs.map((s) => s.path);
  for (const r of REQUIRED_ROOT) {
    if (!paths.includes(`${r}.md`)) v.push(`missing ${r}.md`);
  }
  const projects = paths.filter((p) => p.startsWith("projects/"));
  if (projects.length < MIN_PROJECTS) {
    v.push(`only ${projects.length} project files`);
  }
  for (const s of srcs) {
    const topic = frontmatter(s.raw)["topic"];
    if (s.path.startsWith("projects/")) {
      if (topic !== "project") v.push(`${s.path}: topic ${String(topic)}`);
    } else {
      const base = s.path.replace(/\.md$/, "");
      if (topic !== base) v.push(`${s.path}: topic ${String(topic)}`);
    }
  }
  return v;
}

function linkViolations(text: string): string[] {
  const targets = [
    ...[...text.matchAll(/\]\(([^)\s]*)[^)]*\)/g)].map((m) => m[1] as string),
    ...[
      ...text.matchAll(
        /\b(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|tel:)[^\s)>\]]*/gi,
      ),
    ].map((m) => m[0]),
  ];
  return targets.filter((t) => !/^(https:\/\/|mailto:)/i.test(t));
}

function structureViolations(srcs: readonly KbSource[]): string[] {
  const v: string[] = [];
  for (const s of srcs) {
    const body = bodyOf(s.raw);
    if (/^#{1,2} /m.test(body)) v.push(`${s.path}: h1/h2 heading`);
    if (/<[a-z][^>]*>/i.test(body)) v.push(`${s.path}: raw HTML`);
    for (const l of linkViolations(body)) v.push(`${s.path}: link ${l}`);
    if (s.path.startsWith("projects/")) {
      if (!/^projects\/[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(s.path)) {
        v.push(`${s.path}: not kebab-case`);
      }
    }
    const summary = frontmatter(s.raw)["summary"];
    if (!summary || summary.length > 200 || /\n/.test(summary)) {
      v.push(`${s.path}: summary empty/long`);
    }
  }
  return v;
}

// Role lookup that survives heading rewording: company + role keyword,
// case-insensitive, on any heading level.
type RoleKey = "staff" | "senior" | "sqa2" | "sqa1" | "intern";
const ROLE_MATCH: Record<RoleKey, (h: string) => boolean> = {
  staff: (h) => /boston dynamics/i.test(h) && /\bstaff\b/i.test(h),
  senior: (h) => /boston dynamics/i.test(h) && /\bsenior\b/i.test(h),
  sqa2: (h) =>
    /sharkninja/i.test(h) && /(?:\bII\b|\b2\b)/i.test(h) && !/intern/i.test(h),
  sqa1: (h) =>
    /sharkninja/i.test(h) &&
    /\bSQA\b/i.test(h) &&
    !/(?:\bII\b|\b2\b)/i.test(h) &&
    !/intern/i.test(h),
  intern: (h) => /sharkninja/i.test(h) && /intern/i.test(h),
};

function findRole(body: string, key: RoleKey): Section | string {
  const found = sectionsOf(body).filter((s) => ROLE_MATCH[key](s.heading));
  if (found.length === 0) return `role not found: ${key}`;
  return found[0] as Section;
}

const MONTH = {
  nov: "Nov(?:ember)?\\.?",
  apr: "Apr(?:il)?\\.?",
  sep: "Sep(?:t(?:ember)?)?\\.?",
};
const range = (a: string, ay: string, b: string, by: string): RegExp =>
  new RegExp(`\\b${a} ${ay}\\b.*\\b${b} ${by}\\b`, "i");

function d01Violations(experience: string): string[] {
  const v: string[] = [];
  const checks: [RoleKey, RegExp, string][] = [
    [
      "sqa2",
      range(MONTH.apr, "2022", MONTH.sep, "2023"),
      "April 2022 to September 2023",
    ],
    [
      "sqa1",
      range(MONTH.nov, "2019", MONTH.apr, "2022"),
      "November 2019 to April 2022",
    ],
  ];
  for (const [key, re, label] of checks) {
    const r = findRole(experience, key);
    if (typeof r === "string") v.push(r);
    else if (!re.test(r.heading)) v.push(`${key} dates are not ${label}`);
  }
  for (const line of experience.split("\n")) {
    if (/\bpresent\b/i.test(line)) {
      const ok = isHeading(line) && ROLE_MATCH.staff(line);
      if (!ok) v.push(`"Present" outside Staff heading: ${line.trim()}`);
    }
  }
  return v;
}

function d02Violations(experience: string): string[] {
  const r = findRole(experience, "intern");
  if (typeof r === "string") return [r];
  const v: string[] = [];
  const [heading = "", ...rest] = r.text.split("\n");
  if (!/Product Development Intern/i.test(heading)) {
    v.push("intern title missing");
  }
  if (
    !/\bApr(?:il)?\b.*2019/i.test(heading) ||
    !/\bNov(?:ember)?\b.*2019/i.test(heading)
  ) {
    v.push("intern dates missing");
  }
  if (/^\s*(?:[-*+]|\d+[.)])\s/m.test(rest.join("\n"))) {
    v.push("intern role has a list");
  }
  return v;
}

const YEARS_RE = /\b\d+\+?\s*(?:years|yrs)\b/i;

function linkedinViolations(text: string): string[] {
  const urls = [
    ...text.matchAll(/linkedin\.com\/[^\s)\]"'>]*[^\s)\]"'>.,;:]/gi),
  ].map((m) => m[0]);
  return urls.filter((u) => !/^linkedin\.com\/in\/avanegas95\/?$/i.test(u));
}

function d05Violations(bio: string, builtKb: string): string[] {
  const v: string[] = [];
  if (!bio.includes("Boston area, MA")) v.push("bio lacks 'Boston area, MA'");
  if (/Framingham/i.test(builtKb)) v.push("Framingham in KB");
  return v;
}

/** `bodies` are KB file bodies; every section that mentions the resume must point to LinkedIn. */
function d06Violations(builtKb: string, bodies: readonly string[]): string[] {
  const v: string[] = [];
  if (/\.pdf\b/i.test(builtKb)) v.push(".pdf reference in KB");
  const resumeSections = bodies
    .flatMap((b) => sectionsOf(b))
    .filter((s) => /\bresume\b/i.test(s.text));
  if (resumeSections.length === 0) v.push("no resume answer in KB");
  for (const s of resumeSections) {
    if (!/linkedin/i.test(s.text)) {
      v.push(`resume answer does not point to LinkedIn: ${s.heading}`);
    }
  }
  return v;
}

function d07Violations(experience: string): string[] {
  const r = findRole(experience, "staff");
  if (typeof r === "string") return [r];
  return /\bMarch 2026\b/i.test(r.heading)
    ? []
    : ["Staff role does not start March 2026"];
}

function d09Violations(builtKb: string): string[] {
  const v: string[] = [];
  if (/\bTestRails\b/.test(builtKb)) v.push("TestRails");
  if (!/\bTestRail\b/.test(builtKb)) v.push("TestRail absent");
  return v;
}

function d10Violations(experience: string): string[] {
  const r = findRole(experience, "senior");
  if (typeof r === "string") return [r];
  return r.text
    .split("\n")
    .filter((l) => /^\s*[-*+]\s+(?:Serves?|Owns?)\b/i.test(l))
    .map((l) => `present tense: ${l.trim()}`);
}

const D11_RE = /\b(?:Jenkins|Buildkite|Node-RED|Zephyr)\b/i;

function d12Violations(builtKb: string, qaPulseExists: boolean): string[] {
  return !qaPulseExists && /QA Pulse/i.test(builtKb) ? ["QA Pulse"] : [];
}

function contactViolations(text: string): string[] {
  const v: string[] = [];
  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    if (m[0].toLowerCase() !== "avanegas95@gmail.com") v.push(`email ${m[0]}`);
  }
  for (const m of text.matchAll(/github\.com\/[^\s)\]"'>]*[^\s)\]"'>.,;:]/gi)) {
    if (!/^github\.com\/avanegas95(?:[/?#]|$)/.test(m[0].toLowerCase())) {
      v.push(`github ${m[0]}`);
    }
  }
  return v;
}

function determinismViolations(a: string, b: string): string[] {
  const v: string[] = [];
  if (a !== b) v.push("builds differ");
  if (/\bupdated:/.test(a)) v.push("updated: present");
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(a)) v.push("ISO date present");
  return v;
}

// ---------- hand-written fixtures for self-tests ----------

const GOOD_EXPERIENCE = [
  "### Boston Dynamics: Staff SQA Engineer, March 2026 to present",
  "",
  "- Owns triage of nightly runs.",
  "",
  "### Boston Dynamics: Senior SQA Engineer, Sep 2023 to Mar 2026",
  "",
  "- Built a tool.",
  "- Was project lead.",
  "",
  "### SharkNinja: SQA Engineer II, Apr 2022 to Sep 2023",
  "",
  "- Led juniors.",
  "",
  "### SharkNinja: SQA Engineer, Nov 2019 to Apr 2022",
  "",
  "- Ran manual tests.",
  "",
  "### SharkNinja: Product Development Intern, April 2019 to November 2019",
  "",
  "Details are not available.",
  "",
].join("\n");

const lines = (...l: string[]): string => l.join("\n");

// ---------- tests ----------

const experience = bodyOf(raw("experience.md"));

describe("kb content", () => {
  it("required files", () => {
    expect(requiredFilesViolations(sources)).toEqual([]);
  });
  it("required files (matcher self-test)", () => {
    const mk = (path: string, topic: string): KbSource => ({
      path,
      raw: `---\ntopic: ${topic}\ntitle: T\nsummary: S\npublic: true\n---\n\nBody.\n`,
    });
    const good = [
      ...REQUIRED_ROOT.map((r) => mk(`${r}.md`, r)),
      mk("projects/a.md", "project"),
      mk("projects/b.md", "project"),
      mk("projects/c.md", "project"),
    ];
    expect(requiredFilesViolations(good)).toEqual([]);
    expect(
      requiredFilesViolations(good.filter((s) => s.path !== "faq.md")),
    ).not.toEqual([]);
    expect(
      requiredFilesViolations(good.filter((s) => s.path !== "projects/c.md")),
    ).not.toEqual([]);
    expect(
      requiredFilesViolations(
        good.map((s) => (s.path === "projects/a.md" ? mk(s.path, "bio") : s)),
      ),
    ).not.toEqual([]);
    expect(
      requiredFilesViolations(
        good.map((s) => (s.path === "faq.md" ? mk(s.path, "bio") : s)),
      ),
    ).not.toEqual([]);
  });

  it("structure", () => {
    expect(structureViolations(sources)).toEqual([]);
  });
  it("structure (matcher self-test)", () => {
    const mk = (body: string, summary = "Short.", path = "bio.md") => [
      {
        path,
        raw: `---\ntopic: bio\ntitle: T\nsummary: ${summary}\npublic: true\n---\n\n${body}\n`,
      },
    ];
    expect(structureViolations(mk("Fine text."))).toEqual([]);
    expect(structureViolations(mk("# Title\ntext"))).not.toEqual([]);
    expect(structureViolations(mk("## Title\ntext"))).not.toEqual([]);
    expect(structureViolations(mk("hi <b>there</b>"))).not.toEqual([]);
    expect(structureViolations(mk("[x](http://example.com)"))).not.toEqual([]);
    expect(structureViolations(mk("[x](/relative)"))).not.toEqual([]);
    expect(structureViolations(mk("[x](javascript:alert(1))"))).not.toEqual([]);
    expect(structureViolations(mk("[x](https://example.com)"))).toEqual([]);
    expect(structureViolations(mk("[x](mailto:a@b.co)"))).toEqual([]);
    expect(structureViolations(mk("text", "x".repeat(201)))).not.toEqual([]);
    expect(
      structureViolations(mk("text", "Short.", "projects/Orbit_Hop.md")),
    ).not.toEqual([]);
    expect(
      structureViolations(mk("text", "Short.", "projects/orbit-hop.md")),
    ).toEqual([]);
  });

  it("D-01", () => {
    expect(d01Violations(experience)).toEqual([]);
  });
  it("D-01 (matcher self-test)", () => {
    expect(d01Violations(GOOD_EXPERIENCE)).toEqual([]);
    const fullForms = lines(
      "### Boston Dynamics: Staff SQA Engineer, March 2026 to present",
      "### SharkNinja: SQA Engineer II, April 2022 to September 2023",
      "### SharkNinja: SQA Engineer, November 2019 to April 2022",
    );
    expect(d01Violations(fullForms)).toEqual([]);
    const withPresent = (sqa: string, sqa2: string) =>
      lines(
        "### Boston Dynamics: Staff SQA Engineer, March 2026 to present",
        `### SharkNinja: SQA Engineer II, ${sqa2}`,
        `### SharkNinja: SQA Engineer, ${sqa}`,
      );
    expect(
      d01Violations(
        withPresent("November 2019 to Present", "April 2022 to September 2023"),
      ),
    ).not.toEqual([]);
    expect(
      d01Violations(
        withPresent("November 2019 to April 2022", "April 2022 to Present"),
      ),
    ).not.toEqual([]);
    expect(
      d01Violations(
        withPresent("November 2019 to April 2022", "April 2022 to June 2023"),
      ),
    ).not.toEqual([]);
    expect(
      d01Violations(
        withPresent("March 2019 to April 2022", "April 2022 to September 2023"),
      ),
    ).not.toEqual([]);
    expect(
      d01Violations(`${GOOD_EXPERIENCE}\nHe is there now, Present day.`),
    ).not.toEqual([]);
    // Role not found must fail loudly rather than pass vacuously.
    expect(d01Violations("### Unrelated heading\n")).toEqual([
      "role not found: sqa2",
      "role not found: sqa1",
    ]);
  });

  it("D-02", () => {
    expect(d02Violations(experience)).toEqual([]);
  });
  it("D-02 (matcher self-test)", () => {
    expect(d02Violations(GOOD_EXPERIENCE)).toEqual([]);
    expect(d02Violations(`${GOOD_EXPERIENCE}- Built a thing\n`)).not.toEqual(
      [],
    );
    expect(
      d02Violations(
        lines(
          "### SharkNinja: Product Development Intern, April 2019 to November 2019",
          "",
          "1. Built a thing",
        ),
      ),
    ).not.toEqual([]);
    expect(
      d02Violations("### SharkNinja: Helper, April 2019 to November 2019\n\nx"),
    ).toEqual(["role not found: intern"]);
    expect(
      d02Violations("### SharkNinja: Product Development Intern\n\nx"),
    ).not.toEqual([]);
  });

  it("D-03", () => {
    expect(YEARS_RE.test(built)).toBe(false);
  });
  it("D-03 (matcher self-test)", () => {
    for (const s of ["6+ years", "7 years of QA", "5 yrs", "10+ Years"]) {
      expect(YEARS_RE.test(s), s).toBe(true);
    }
    expect(YEARS_RE.test("working since 2019")).toBe(false);
  });

  it("D-04", () => {
    expect(linkedinViolations(built)).toEqual([]);
    expect(/linkedin\.com\/in\/avanegas95/i.test(built)).toBe(true);
  });
  it("D-04 (matcher self-test)", () => {
    expect(
      linkedinViolations("https://www.linkedin.com/in/andersonvanegas/"),
    ).not.toEqual([]);
    expect(linkedinViolations("linkedin.com/in/avanegas950")).not.toEqual([]);
    expect(linkedinViolations("linkedin.com/in/avanegas95/")).toEqual([]);
  });

  it("D-05", () => {
    expect(d05Violations(bodyOf(raw("bio.md")), built)).toEqual([]);
  });
  it("D-05 (matcher self-test)", () => {
    expect(d05Violations("Based in the Boston area, MA.", "ok")).toEqual([]);
    expect(d05Violations("Based in Boston, MA.", "ok")).not.toEqual([]);
    expect(
      d05Violations("Boston area, MA.", "lives in Framingham"),
    ).not.toEqual([]);
  });

  it("D-06", () => {
    expect(
      d06Violations(
        built,
        sources.map((s) => bodyOf(s.raw)),
      ),
    ).toEqual([]);
  });
  it("D-06 (matcher self-test)", () => {
    const ok = [
      "### Where is the CV?\n\nThe resume is on https://www.linkedin.com/in/avanegas95.",
    ];
    expect(d06Violations("clean", ok)).toEqual([]);
    expect(d06Violations("see [cv](https://x.example/cv.pdf)", ok)).not.toEqual(
      [],
    );
    expect(
      d06Violations("clean", ["### CV\n\nDownload the resume here."]),
    ).not.toEqual([]);
    expect(d06Violations("clean", ["### Other\n\nNothing."])).not.toEqual([]);
  });

  it("D-07", () => {
    expect(d07Violations(experience)).toEqual([]);
  });
  it("D-07 (matcher self-test)", () => {
    expect(d07Violations(GOOD_EXPERIENCE)).toEqual([]);
    expect(
      d07Violations("### Boston Dynamics: Staff SQA Engineer, 2026 to present"),
    ).not.toEqual([]);
    expect(d07Violations("### Other\n")).toEqual(["role not found: staff"]);
  });

  it("D-09", () => {
    expect(d09Violations(built)).toEqual([]);
  });
  it("D-09 (matcher self-test)", () => {
    expect(d09Violations("Uses TestRail daily.")).toEqual([]);
    expect(d09Violations("Uses TestRails daily. TestRail too.")).not.toEqual(
      [],
    );
    expect(d09Violations("no tool named")).not.toEqual([]);
  });

  it("D-10", () => {
    expect(d10Violations(experience)).toEqual([]);
  });
  it("D-10 (matcher self-test)", () => {
    expect(d10Violations(GOOD_EXPERIENCE)).toEqual([]);
    const senior = (bullet: string) =>
      lines(
        "### Boston Dynamics: Senior SQA Engineer, Sep 2023 to Mar 2026",
        "",
        bullet,
      );
    expect(d10Violations(senior("- Serve as a project lead."))).not.toEqual([]);
    expect(d10Violations(senior("- Owns a Python tool."))).not.toEqual([]);
    expect(d10Violations(senior("- Was project lead."))).toEqual([]);
    // Present tense is fine in the Staff section.
    expect(
      d10Violations(
        lines(
          "### Boston Dynamics: Staff SQA Engineer, March 2026 to present",
          "- Owns triage.",
          "### Boston Dynamics: Senior SQA Engineer, Sep 2023 to Mar 2026",
          "- Built a tool.",
        ),
      ),
    ).toEqual([]);
    expect(d10Violations("### Other\n")).toEqual(["role not found: senior"]);
  });

  it("D-11", () => {
    expect(D11_RE.exec(built)).toBeNull();
  });
  it("D-11 (matcher self-test)", () => {
    for (const w of ["Jenkins", "Buildkite", "Node-RED", "Zephyr"]) {
      expect(D11_RE.test(`CI with ${w}.`), w).toBe(true);
    }
    expect(D11_RE.test("CI/CD pipelines")).toBe(false);
  });

  it("D-12", () => {
    const exists = sources.some((s) => s.path === "projects/qa-pulse.md");
    expect(d12Violations(built, exists)).toEqual([]);
  });
  it("D-12 (matcher self-test)", () => {
    expect(d12Violations("QA Pulse audits sites.", false)).not.toEqual([]);
    expect(d12Violations("qa pulse", false)).not.toEqual([]);
    expect(d12Violations("QA Pulse audits sites.", true)).toEqual([]);
    expect(d12Violations("nothing here", false)).toEqual([]);
  });

  it("contact allowlist", () => {
    expect(contactViolations(built)).toEqual([]);
    expect(contactViolations(sources.map((s) => s.raw).join("\n"))).toEqual([]);
  });
  it("contact allowlist (matcher self-test)", () => {
    expect(contactViolations("mail me: someone@example.com")).not.toEqual([]);
    expect(contactViolations("https://github.com/other-user")).not.toEqual([]);
    expect(contactViolations("github.com/avanegas950")).not.toEqual([]);
    expect(
      contactViolations("github.com/avanegas95/repo avanegas95@gmail.com"),
    ).toEqual([]);
  });

  it("deterministic on real KB", () => {
    const a = buildKb(loadKbSources(KB_ROOT));
    const b = buildKb(loadKbSources(KB_ROOT));
    expect(determinismViolations(a, b)).toEqual([]);
  });
  it("deterministic on real KB (matcher self-test)", () => {
    expect(determinismViolations("a", "b")).not.toEqual([]);
    expect(
      determinismViolations("updated: 2026-01-01", "updated: 2026-01-01"),
    ).not.toEqual([]);
    expect(
      determinismViolations("built 2026-10-13", "built 2026-10-13"),
    ).not.toEqual([]);
    expect(determinismViolations("same", "same")).toEqual([]);
  });
});

// P5-03a: v1 keeps its `blog` collection next to `knowledge` and `projects`.
// The blog definition must stay byte-identical to v1's so /blog/ builds as before
// (`npm run build` is the end-to-end check that the collection still loads).
describe("content collections (v1)", () => {
  const config = readFileSync("src/content.config.ts", "utf8");
  // SHA-256 of v1's `const blog = defineCollection({...});` block before P5-03a, re-pinned in
  // P5.5-08a for the one allowed change: `draft` and cover `image()`.
  const V1_BLOG_SHA =
    "a393d2d1725b6adf082b2c9b14d7ea973ddb16606540653b3a3b54ea75a018cb";

  it("blog collection definition is unchanged from v1 apart from `draft`", () => {
    const block = /^const blog = defineCollection\(\{[\s\S]*?^\}\);$/m.exec(
      config,
    );
    expect(block).not.toBeNull();
    const sha = createHash("sha256")
      .update((block as RegExpExecArray)[0])
      .digest("hex");
    expect(sha).toBe(V1_BLOG_SHA);
    expect(config).toContain('base: "./src/content/blog"');
  });

  it("exports blog, knowledge and projects", () => {
    expect(config).toMatch(
      /^export const collections = \{ blog, knowledge, projects \};$/m,
    );
  });

  it("knowledge and projects load from the KB folders", () => {
    expect(config).toContain('base: "./src/content/knowledge"');
    expect(config).toContain('base: "./src/content/knowledge/projects"');
  });
});
