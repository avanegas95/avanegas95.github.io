// facts:check (P5.5-13c). Report-only: this script never writes any file.
// Server/tooling only. Runs under plain `node` (type stripping): erasable TS only.
//
// Lists conflicts between the KB, the site sources and docs/DISCREPANCIES.md
// interim rules, PII (via src/lib/pii.ts) and likely misspellings. It also
// holds the site-drift ratchet used by tests/unit/site-drift.test.ts.
// Exit: 0 (findings printed), 1 when any finding has severity "error".
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  KB_ROOT,
  loadKbSources,
  parseKbSource,
  type KbSource,
} from "../src/lib/kb.ts";
import { scanText, type PiiRule } from "../src/lib/pii.ts";

export type Finding = {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: "error" | "suggestion";
};
export type SiteSource = { readonly path: string; readonly text: string };

function eachLine(text: string): [number, string][] {
  return text.split(/\r\n?|\n/).map((l, i) => [i + 1, l]);
}

// DISCREPANCIES interim rules. `skip` exempts lines that match a different,
// legitimate phrase ("Boston University, Boston, MA" is not a location claim).
type LineRule = {
  rule: string;
  re: RegExp;
  skip?: RegExp;
  message: string;
  scope: "both" | "site";
};
const LINE_RULES: readonly LineRule[] = [
  {
    rule: "D-03",
    re: /\b\d+\+?\s+years\b/i,
    message: 'states a number of years; interim rule: say "since 2019" instead',
    scope: "both",
  },
  {
    rule: "D-05",
    re: /Boston, MA/,
    skip: /Boston University/,
    message: 'says "Boston, MA"; interim rule: "Boston area, MA"',
    scope: "both",
  },
  {
    rule: "D-09",
    re: /TestRails/,
    message: '"TestRails" should be "TestRail"',
    scope: "both",
  },
  {
    rule: "D-14",
    re: /Senior SQA Engineer with/,
    message:
      "hero calls him Senior; interim rule: Staff SQA Engineer since March 2026, no years stated",
    scope: "site",
  },
];

const SITE_PII_RULES: readonly PiiRule[] = [
  "phone",
  "street-address",
  "zip",
  "email",
  "contact-url",
];

const MISSPELLINGS: readonly string[] = [
  "teh",
  "recieve",
  "seperate",
  "occured",
  "definately",
  "acheive",
  "untill",
  "becuase",
  "enviroment",
  "begining",
  "wich",
  "adress",
];
const MISSPELL_RE = new RegExp(`\\b(${MISSPELLINGS.join("|")})\\b`, "i");

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

type Span = { year: number; month: number | null };
function parseEndpoint(s: string): Span | "present" | null {
  if (/^present$/i.test(s.trim())) return "present";
  const m = /^(?:([A-Za-z]+)\s+)?((?:19|20)\d{2})$/.exec(s.trim());
  if (!m) return null;
  const mi = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return { year: Number(m[2]), month: m[1] && mi >= 0 ? mi + 1 : null };
}

type SiteCard = { company: string; title: string; dates: string; line: number };
function experienceCards(text: string): SiteCard[] {
  const out: SiteCard[] = [];
  let company = "";
  let title = "";
  for (const [line, l] of eachLine(text)) {
    const c = /experience-card__company">([^<]+)</.exec(l);
    if (c) company = c[1] as string;
    const t = /experience-card__role">([^<]+)</.exec(l);
    if (t) title = t[1] as string;
    const d = /experience-card__dates">([^<]+)</.exec(l);
    if (d) out.push({ company, title, dates: d[1] as string, line });
  }
  return out;
}

function checkExperience(
  kb: readonly KbSource[],
  site: readonly SiteSource[],
): Finding[] {
  const exp = kb.find((s) => s.path === "experience.md");
  if (!exp) return [];
  const data = parseKbSource(exp).data;
  if (data.topic !== "experience") return [];
  const roles = (data.roles ?? []).filter((r) => r.showOnSite);
  const out: Finding[] = [];
  for (const src of site) {
    for (const card of experienceCards(src.text)) {
      const sameCo = roles.filter((r) => r.company === card.company);
      const role = sameCo.find((r) => r.title === card.title);
      if (!role) {
        out.push({
          rule: "title-mismatch",
          file: src.path,
          line: card.line,
          message: `site shows "${card.title}" at ${card.company}; KB titles there: ${sameCo.map((r) => `"${r.title}"`).join(", ") || "none"}`,
          severity: "error",
        });
        continue;
      }
      const [from, to] = card.dates.split(/\s*[–—-]\s*/);
      const s = parseEndpoint(from ?? "");
      const e = parseEndpoint(to ?? "");
      const [ky, km] = role.start.split("-").map(Number) as [number, number];
      const bad: string[] = [];
      if (
        s === null ||
        s === "present" ||
        s.year !== ky ||
        (s.month !== null && s.month !== km)
      ) {
        bad.push(`start (KB ${role.start})`);
      }
      if (role.end === null) {
        if (e !== "present") bad.push("end (KB: present)");
      } else {
        const [ey, em] = role.end.split("-").map(Number) as [number, number];
        if (
          e === null ||
          e === "present" ||
          e.year !== ey ||
          (e.month !== null && e.month !== em)
        ) {
          bad.push(`end (KB ${role.end})`);
        }
      }
      if (bad.length > 0) {
        out.push({
          rule: "date-mismatch",
          file: src.path,
          line: card.line,
          message: `"${card.title}" shows "${card.dates}"; differs from KB ${bad.join(", ")}`,
          severity: "error",
        });
      }
    }
  }
  return out;
}

export function runChecks(
  kb: readonly KbSource[],
  siteSources: readonly SiteSource[],
): Finding[] {
  const targets: { file: string; text: string; site: boolean }[] = [
    ...kb.map((s) => ({ file: s.path, text: s.raw, site: false })),
    ...siteSources.map((s) => ({ file: s.path, text: s.text, site: true })),
  ];
  const out: Finding[] = [];
  for (const t of targets) {
    for (const [line, l] of eachLine(t.text)) {
      for (const r of LINE_RULES) {
        if (r.scope === "site" && !t.site) continue;
        if (r.re.test(l) && !(r.skip && r.skip.test(l))) {
          out.push({
            rule: r.rule,
            file: t.file,
            line,
            message: r.message,
            severity: "error",
          });
        }
      }
      const m = MISSPELL_RE.exec(l);
      if (m) {
        out.push({
          rule: "misspelling",
          file: t.file,
          line,
          message: `possible misspelling "${m[1]}"`,
          severity: "suggestion",
        });
      }
    }
    // Site code legitimately contains words like "placeholder" (input attrs)
    // and TODO comments; the build-time guard uses these same HTML rules.
    const rules = t.site ? SITE_PII_RULES : undefined;
    for (const p of scanText(t.text, t.file, rules)) {
      out.push({
        rule: `pii:${p.rule}`,
        file: t.file,
        line: p.line,
        message: `PII/placeholder match ${p.masked}`,
        severity: "error",
      });
    }
  }
  out.push(...checkExperience(kb, siteSources));
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ---------------------------------------------------------------------------
// Site-drift ratchet (CLAUDE.md rule 1): section components must not hard-code
// facts that belong in the KB. Existing hits are listed, line by line, in the
// component's allow file; the list may only shrink.

export type DriftConfig = {
  employers: readonly string[];
  titles: readonly string[];
};

export function driftConfigFromKb(kb: readonly KbSource[]): DriftConfig {
  const employers = new Set<string>();
  const titles = new Set<string>();
  for (const s of kb) {
    const d = parseKbSource(s).data;
    if (d.topic !== "experience") continue;
    for (const r of d.roles ?? []) {
      employers.add(r.company);
      titles.add(r.title);
    }
  }
  return { employers: [...employers].sort(), titles: [...titles].sort() };
}

const YEAR_RANGE = /\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:19|20)\d{2}|Present)\b/i;
const YEARS = /\b\d+\+?\s+years\b|years of experience/i;
const TITLE = /\bSQA Engineer\b/;

export type DriftHit = { line: number; text: string };

export function driftHits(componentText: string, cfg: DriftConfig): DriftHit[] {
  const out: DriftHit[] = [];
  for (const [line, raw] of eachLine(componentText)) {
    const l = raw.trim();
    if (l === "") continue;
    if (
      YEAR_RANGE.test(l) ||
      YEARS.test(l) ||
      TITLE.test(l) ||
      cfg.titles.some((t) => l.includes(t)) ||
      cfg.employers.some((e) => l.includes(e))
    ) {
      out.push({ line, text: l });
    }
  }
  return out;
}

function counts(lines: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

/** New hits not in the allow file, and allow lines that no longer match. */
export function checkDrift(
  name: string,
  componentText: string,
  allowText: string,
  cfg: DriftConfig,
  allowName: string = `${name}.txt`,
): Finding[] {
  const hits = driftHits(componentText, cfg);
  const allow = eachLine(allowText)
    .map(([line, t]) => ({ line, text: t.trim() }))
    .filter((a) => a.text !== "");
  const allowed = counts(allow.map((a) => a.text));
  const seen = new Map<string, number>();
  const out: Finding[] = [];
  for (const h of hits) {
    const n = (seen.get(h.text) ?? 0) + 1;
    seen.set(h.text, n);
    if (n > (allowed.get(h.text) ?? 0)) {
      out.push({
        rule: "site-drift",
        file: name,
        line: h.line,
        message: `hard-coded fact "${h.text}"; read it from the KB or (never) allow-list it`,
        severity: "error",
      });
    }
  }
  const used = new Map<string, number>();
  for (const a of allow) {
    const n = (used.get(a.text) ?? 0) + 1;
    used.set(a.text, n);
    if (n > (seen.get(a.text) ?? 0)) {
      out.push({
        rule: "site-drift-stale-allow",
        file: allowName,
        line: a.line,
        message: `allow line no longer matches ${name}; delete it ("${a.text}")`,
        severity: "error",
      });
    }
  }
  return out;
}

export const DRIFT_COMPONENTS = [
  "Home",
  "About",
  "Experiences",
  "Projects",
  "Contact",
] as const;
export const SECTIONS_DIR = "src/components/sections";
export const ALLOW_DIR = "tests/fixtures/drift/allow";

function readSiteSources(): SiteSource[] {
  const files: string[] = [
    ...DRIFT_COMPONENTS.map((c) => `${SECTIONS_DIR}/${c}.astro`),
    ...(existsSync("src/data")
      ? readdirSync("src/data")
          .filter((f) => f.endsWith(".ts"))
          .map((f) => `src/data/${f}`)
      : []),
  ];
  return files
    .filter((f) => existsSync(f))
    .map((f) => ({ path: f, text: readFileSync(f, "utf8") }));
}

export function main(log: (s: string) => void = console.log): number {
  const kb = loadKbSources(KB_ROOT);
  const findings = runChecks(kb, readSiteSources());
  const cfg = driftConfigFromKb(kb);
  for (const c of DRIFT_COMPONENTS) {
    const comp = `${SECTIONS_DIR}/${c}.astro`;
    const allow = join(ALLOW_DIR, `${c}.astro.txt`);
    if (!existsSync(comp)) continue;
    findings.push(
      ...checkDrift(
        comp,
        readFileSync(comp, "utf8"),
        existsSync(allow) ? readFileSync(allow, "utf8") : "",
        cfg,
        allow,
      ),
    );
  }
  for (const f of findings) {
    log(`${f.file}:${f.line} [${f.severity}] ${f.rule}: ${f.message}`);
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  log(
    `facts:check (report only, nothing written): ${errors} error(s), ${findings.length - errors} suggestion(s).`,
  );
  return errors > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
