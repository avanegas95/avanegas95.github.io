// Server/tooling only. Must run under plain `node` (type stripping): erasable TS only.
// Detects PII and placeholder markers (CLAUDE.md rule 2, SCOPE §5.2).

export type PiiRule =
  "phone" | "street-address" | "zip" | "email" | "contact-url" | "placeholder";

export type PiiFinding = {
  file: string;
  line: number;
  rule: PiiRule;
  masked: string;
};

// Unresolved-content markers: reported separately from PII (warn by default).
export type MarkerFinding = {
  file: string;
  line: number;
  rule: "unresolved-marker";
  masked: string;
};

export const ALLOWED_EMAIL = "avanegas95@gmail.com";
export const ALLOWED_URL_PREFIXES = [
  "linkedin.com/in/avanegas95",
  "github.com/avanegas95",
] as const;
// The one App Store listing the site links to (Anderson, 2026-10-24). Its
// 10-digit app id reads as a phone number; only that id, inside this exact
// URL, is exempt from the phone rule. Any other 10-digit run is still flagged.
export const ALLOWED_APP_STORE_URL =
  "apps.apple.com/us/app/astro-andy-orbit-hop/id6817951678";

const ALL_RULES: readonly PiiRule[] = [
  "phone",
  "street-address",
  "zip",
  "email",
  "contact-url",
  "placeholder",
];

// Hyphen-like characters: ASCII, U+2010-U+2015 (incl. non-breaking hyphen,
// en/em dash), minus sign, small/fullwidth hyphen-minus.
const DASH = "\\-\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D";
const SEP = `[\\s.${DASH}]{0,3}`;
const SUFFIX =
  "Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Circle|Parkway|Highway|Path";
const WORD = "(?:[A-Z][A-Za-z'-]*|\\d+(?:st|nd|rd|th))";

// Linear global search for patterns a backtracking engine makes quadratic
// (P5-12). The engine retries every start position and can rescan the rest
// of a long run from each one: "wwww..." for the email pattern, "< < <" with
// no ">" for a tag; a 32 KB reply took minutes. For a registered pattern,
// start() finds the first position where a match could begin, skipping
// positions that provably cannot match, and the same pattern run sticky
// there confirms it: the same matches in the same order as matchAll(). The
// patterns stay plain RegExps (a RegExp subclass would switch V8's fast
// paths off for every regex in the process).
type Start = { at: number; next: number }; // at -1: no match at or after p
const NO_START: Start = { at: -1, next: -1 };
type Finder = { sticky: RegExp; start: (s: string, p: number) => Start };
const FINDERS = new Map<RegExp, Finder>();

function linear(re: RegExp, start: Finder["start"]): RegExp {
  const sticky = new RegExp(re.source, `${re.flags.replace(/[gy]/g, "")}y`);
  FINDERS.set(re, { sticky, start });
  return re;
}

// s.matchAll(re) for a global regex, linear for a registered one.
export function* allMatches(s: string, re: RegExp): Generator<RegExpExecArray> {
  const f = FINDERS.get(re);
  if (!f) {
    yield* s.matchAll(re) as IterableIterator<RegExpExecArray>;
    return;
  }
  let p = 0;
  while (p <= s.length) {
    const c = f.start(s, p);
    if (c.at < 0) return;
    f.sticky.lastIndex = c.at;
    const m = f.sticky.exec(s);
    if (!m) {
      p = c.next;
      continue;
    }
    p = f.sticky.lastIndex;
    yield m;
  }
}

// The email pattern's local part: a run of these, then "@" (not one of them).
const LOCAL = "[A-Za-z0-9._%+-]";
const LOCAL_NEXT = new RegExp(LOCAL, "g");
const LOCAL_RUN = new RegExp(`${LOCAL}+`, "y");

// Every start inside a run of LOCAL characters ends that part at the same
// place and needs "@" right there, so a run that does not end at "@" is
// skipped whole, and if the pattern fails at the run's first start it fails
// at all of them.
export const EMAIL_PATTERN = linear(
  new RegExp(
    `${LOCAL}+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}`,
    "g",
  ),
  (s, p) => {
    for (;;) {
      LOCAL_NEXT.lastIndex = p;
      if (!LOCAL_NEXT.test(s)) return NO_START;
      const at = LOCAL_NEXT.lastIndex - 1;
      LOCAL_RUN.lastIndex = at;
      LOCAL_RUN.test(s);
      const r = LOCAL_RUN.lastIndex;
      if (s.charCodeAt(r) === 0x40) return { at, next: r + 1 };
      p = r + 1;
    }
  },
);

// A match starts at the first "<" that has a ">" anywhere after it, and when
// the first "<" has none, no later one does.
export const TAG_PATTERN = linear(/<[^>]*>/g, (s, p) => {
  const at = s.indexOf("<", p);
  if (at < 0 || s.indexOf(">", at + 1) < 0) return NO_START;
  return { at, next: at + 1 };
});

// Each rule is a list of patterns; every pattern must use the `g` flag.
const PATTERNS: Record<PiiRule, readonly RegExp[]> = {
  phone: [
    /\btel:[^\s"'<>]+/gi,
    new RegExp(
      `(?<!\\d)(?:\\+?1${SEP})?(?:\\(\\s*\\d{3}\\s*\\)|\\d{3})${SEP}\\d{3}${SEP}\\d{4}(?!\\d)`,
      "g",
    ),
  ],
  "street-address": [
    new RegExp(
      `(?<![\\w.])\\d{1,6}\\s+(?:${WORD}\\s+){1,4}(?:${SUFFIX})\\b\\.?`,
      "g",
    ),
    /\b(?:P\.?\s?O\.?|Post\s+Office)\s+Box\s*#?\s*\d+/gi,
    /\b(?:Apt|Apartment|Suite|Ste)\.?\s*#?\s*\d+/gi,
    /\b(?:Unit|UNIT)\.?\s*#?\s*\d+/g,
  ],
  zip: [
    new RegExp(
      `\\b[A-Z]{2},?\\s+\\d{5}(?:[\\s${DASH}]{0,3}\\d{4})?(?!\\d)`,
      "g",
    ),
  ],
  email: [EMAIL_PATTERN],
  "contact-url": [
    /(?<![A-Za-z0-9.-])(?:[A-Za-z0-9-]+\.)*(?:linkedin|github)\.com(?![A-Za-z0-9-])[^\s"'<>()[\]]*/gi,
    /(?<![A-Za-z0-9.-])(?:[A-Za-z0-9-]+\.)*(?:x|twitter|instagram|facebook|tiktok)\.com(?![A-Za-z0-9-])/gi,
    /(?<![A-Za-z0-9.-])(?:[A-Za-z0-9-]+\.)*(?:wa|t)\.me(?![A-Za-z0-9-])/gi,
  ],
  placeholder: [
    /\b(?:TODOs?|TBD|FIXME|placeholders?|lorem\s+ipsum)\b/gi,
    /\[ADD/gi,
  ],
};

const MARKER_PATTERNS: Record<"unresolved-marker", readonly RegExp[]> = {
  "unresolved-marker": [/\b(?:to\s+be\s+confirmed|TBC|XXX|coming\s+soon)\b/gi],
};

// Rules whose values may be split mid-token by a line break ("617-555-\n0123").
// Others are only re-joined with a space, so "to\ndo" never reads as a marker.
const TIGHT_JOIN = new Set<string>(["phone", "email", "contact-url"]);

// An address character fused onto the end of an allowed value, then more of
// the value: "...gmail.com@evil.zz", ".../avanegas95.evil".
const FUSED_TAIL = /^[.@%+_-][A-Za-z0-9]/;

// No loosening: a prefix fused onto the allowed address ("evilavanegas95@...")
// or a fused tail (`tail` is the text right after the match) makes it a
// different value, which is always flagged.
function allowed(rule: string, match: string, tail = ""): boolean {
  if (rule === "email") {
    return match.toLowerCase() === ALLOWED_EMAIL && !FUSED_TAIL.test(tail);
  }
  if (
    rule === "contact-url" &&
    /^(?:[^.]+\.)*(?:linkedin|github)\.com/i.test(match)
  ) {
    const url = match.toLowerCase().replace(/^www\./, "");
    return ALLOWED_URL_PREFIXES.some((p) => {
      const rest = url.slice(p.length);
      return (
        url.startsWith(p) && !/^[a-z0-9_-]/.test(rest) && !FUSED_TAIL.test(rest)
      );
    });
  }
  return false;
}

// Whether content[start, end) is the app id at the end of a complete
// ALLOWED_APP_STORE_URL (not fused onto a longer host or path).
const APP_STORE_URL = new RegExp(
  `(?<![A-Za-z0-9.-])${ALLOWED_APP_STORE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`,
  "gi",
);
function allowedAt(
  rule: string,
  content: string,
  start: number,
  end: number,
): boolean {
  if (rule !== "phone") return false;
  for (const m of content.matchAll(APP_STORE_URL)) {
    if (m.index + m[0].length === end && end - start === 10) return true;
  }
  return false;
}

export function mask(match: string): string {
  return `${match.slice(0, 2)}***`;
}

const ND = /\p{Nd}/u;

function asciiDigit(d: string): string {
  const cp = d.codePointAt(0) as number;
  if (cp >= 0x30 && cp <= 0x39) return d;
  // Unicode decimal digits come in contiguous 0-9 runs.
  let start = cp;
  while (
    start > 0 &&
    cp - start < 100 &&
    ND.test(String.fromCodePoint(start - 1))
  ) {
    start--;
  }
  return String((cp - start) % 10);
}

// NFKC (fullwidth forms, NBSP and other spaces), drop invisible format chars,
// and map every Unicode decimal digit (e.g. Arabic-Indic) to ASCII.
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Nd}/gu, asciiDigit);
}

const NAMED: Record<string, string> = {
  nbsp: " ",
  nonbreakingspace: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  minus: "−",
  hyphen: "‐",
  dash: "‐",
  period: ".",
  commat: "@",
  colon: ":",
  sol: "/",
  plus: "+",
  lpar: "(",
  rpar: ")",
  num: "#",
  shy: "",
  zwsp: "",
};

function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d+);?|#x([0-9a-f]+);?|([a-z]+);)/gi,
    (m, d, h, n) => {
      if (d !== undefined || h !== undefined) {
        const cp = d !== undefined ? Number(d) : parseInt(h as string, 16);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return NAMED[(n as string).toLowerCase()] ?? m;
    },
  );
}

// Remove tags but keep the newlines inside them so line numbers stay stable.
// Block-level tags (and <br>) become a BREAK marker; inline tags become `glue`.
// Each copy then resolves the markers for the rules it checks.
const BLOCK_TAG =
  /^<\/?(?:li|p|div|ul|ol|h[1-6]|section|article|header|footer|nav|main|tr|td|th|dt|dd|br)(?=[\s/>])/i;
const BREAK = "\u0001";

// Two readings of a tag, both checked: up to the first ">" (as an HTML
// tokenizer reads "<x <b>"), and the innermost one, without a "<" inside (so
// "<3 617-555-<b>" does not hide the text before "<b>").
const TAGS: readonly RegExp[] = [TAG_PATTERN, /<[^<>]*>/g];

// s.replace(re, fn) for a global regex, through allMatches().
function replaceAll(
  s: string,
  re: RegExp,
  fn: (match: string, at: number) => string,
): string {
  let out = "";
  let last = 0;
  for (const m of allMatches(s, re)) {
    out += s.slice(last, m.index) + fn(m[0], m.index);
    last = m.index + m[0].length;
  }
  return last === 0 ? s : out + s.slice(last);
}

function stripTags(s: string, glue: string, tag: RegExp = TAG_PATTERN): string {
  return replaceAll(s, tag, (t) => {
    const nl = t.replace(/[^\n]/g, "");
    return BLOCK_TAG.test(t) ? `${BREAK}${nl}${BREAK}` : nl || glue;
  });
}

// Non-email rules: each run of block glue (with the spaces around it) reads
// as one space, so "<li>617</li><li>555-..." still fits SEP and is one phone.
// Built from BREAK so the source holds no control-character regex literal.
// A match can only start where a run of spaces starts (every start inside a
// run reaches the same next character, and a match never ends inside one),
// so the lookbehind changes no match; it only stops the engine from
// rescanning a long run from each of its positions (P5-12).
const H_RUN_START = "(?<![^\\S\\n])";
const BREAK_RUN = new RegExp(
  `${H_RUN_START}[^\\S\\n]*${BREAK}(?:[^\\S\\n]|${BREAK})*`,
  "g",
);
const BREAK_RUN_EMAIL = new RegExp(
  `${H_RUN_START}[^\\S\\n]*${BREAK}(?:\\s*${BREAK})*[^\\S\\n]*`,
  "g",
);

function spaceBreaks(s: string): string {
  return s.replace(BREAK_RUN, " ");
}

const EMAIL_AT =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/y;

// Email: a block break normally joins its neighbours tightly, so an address
// split across items ("someone@</p><p>example.com") is still one match. The
// break stays a hard stop only beside a complete allowed address: the text
// before it ends with it, maybe with closing punctuation (tightJoinOk:
// "...gmail.com</a></li><li>LinkedIn", "...gmail.com.</p><p>He") or, as a
// separate visual line, the text after it is exactly it ("x</p>avanegas95@").
// A soft break drops the spaces around it too: "</li>  <li>" renders as none.
function resolveBreaks(s: string): string {
  return s.replace(BREAK_RUN_EMAIL, (run: string, at: number) => {
    const before = normalize(s.slice(Math.max(0, at - 64), at)).trimEnd();
    const after = at + run.length;
    if (!tightJoinOk(before, s.slice(after, after + 64))) return run;
    EMAIL_AT.lastIndex =
      after + (s.slice(after).match(/^\s*/)?.[0].length ?? 0);
    const next = EMAIL_AT.exec(s);
    if (next && next[0].toLowerCase() === ALLOWED_EMAIL) return run;
    // Only newlines survive, so line numbers stay stable.
    return run.replace(/[^\n]/g, "");
  });
}

// `email`: true checks only the email rule, false every rule but email,
// unset every rule. `blockEnd[i]`: the break after line i is a block boundary,
// so the line join there uses a space only, never the tight (no-gap) glue.
type Variant = { text: string; email?: boolean; blockEnd?: boolean[] };

function blockEnds(stripped: string): boolean[] {
  const ls = stripped.replace(/\r\n?/g, "\n").split("\n");
  return ls.map(
    (l, i) =>
      l.trimEnd().endsWith(BREAK) ||
      (ls[i + 1] ?? "").trimStart().startsWith(BREAK),
  );
}

// The raw text plus decoded/tag-stripped copies.
function variants(text: string): Variant[] {
  const out: Variant[] = [{ text }];
  if (text.includes("&")) out.push({ text: decodeEntities(text) });
  if (text.includes("<")) {
    const seen = new Set<string>();
    for (const tag of TAGS) {
      for (const glue of ["", " "]) {
        const stripped = decodeEntities(stripTags(text, glue, tag));
        if (seen.has(stripped)) continue;
        seen.add(stripped);
        out.push({ text: resolveBreaks(stripped), email: true });
        out.push({
          text: spaceBreaks(stripped),
          email: false,
          blockEnd: blockEnds(stripped),
        });
      }
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A complete allowed value (the address or a profile URL, with closing
// punctuation) at the end of a line.
const ALLOWED_END = new RegExp(
  `(?:(?<![A-Za-z0-9._%+-])${esc(ALLOWED_EMAIL)}|(?<![A-Za-z0-9.-])(?:www\\.)?(?:${ALLOWED_URL_PREFIXES.map(esc).join("|")}))[.,;:!?)]*$`,
  "i",
);

// A next line that could continue the value: an address character, or a
// digit (the profile names end in digits, so "...95" + "5-..." may be a phone).
// A lone mark ("- GitHub", a markdown bullet) starts a new line, not a tail.
const JOIN_START = /^(?:[.@%+_-][A-Za-z0-9]|[0-9])/;

// Whether a line break between `before` and `after` may also be read with no
// gap (for the TIGHT_JOIN rules). Not after a complete allowed value when the
// next line starts a new word: "...gmail.com" + "LinkedIn: ..." is two lines,
// not the address "...gmail.comLinkedIn"; but "...gmail.com" + ".evil.zz" is
// still read as one. The space reading is always checked, and so is each line.
function tightJoinOk(before: string, after: string): boolean {
  const end = normalize(before).trimEnd().match(ALLOWED_END);
  if (!end) return true;
  // Closing punctuation ends the value: "...gmail.com." + "2024 was..." is
  // two sentences, never one value. An "@" still joins, as it did before:
  // ".../avanegas95." + "@evil.zz" may be a split address.
  if (/[.,;:!?)]$/.test(end[0])) {
    return /^@/.test(normalize(after).trimStart());
  }
  return JOIN_START.test(normalize(after).trimStart());
}

type Hit = { line: number; rule: string; masked: string };

function scanWith(
  text: string,
  patterns: Record<string, readonly RegExp[]>,
  rules: readonly string[],
): Hit[] {
  // Each variant sees the same text, so a hit is counted once per variant and
  // the highest count wins: 3 markers on one line report 3, one phone seen by
  // 4 variants reports 1.
  const best = new Map<string, { hit: Hit; count: number }>();
  let counts = new Map<string, number>();
  let joinedSeen = new Set<string>();
  const add = (line: number, rule: string, match: string, tail: string) => {
    if (allowed(rule, match, tail)) return;
    const masked = mask(match);
    const key = `${line}|${rule}|${masked}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!best.has(key))
      best.set(key, { hit: { line, rule, masked }, count: 0 });
  };

  for (const v of variants(text)) {
    counts = new Map();
    joinedSeen = new Set();
    const lines = v.text.replace(/\r\n?/g, "\n").split("\n").map(normalize);
    const active =
      v.email === undefined
        ? rules
        : rules.filter((r) => (r === "email") === v.email);
    lines.forEach((content, i) => {
      for (const rule of active) {
        const spans: Array<readonly [number, number]> = [];
        for (const re of patterns[rule] ?? []) {
          for (const m of allMatches(content, re)) {
            const start = m.index;
            const end = start + m[0].length;
            if (spans.some(([s, e]) => start < e && end > s)) continue;
            spans.push([start, end]);
            if (allowedAt(rule, content, start, end)) continue;
            add(i + 1, rule, m[0], content.slice(end, end + 2));
          }
        }
      }
      // Values split across a line break: report only matches that cross it.
      const next = lines[i + 1];
      if (next === undefined) return;
      const a = content.trimEnd();
      const b = next.trimStart();
      const tight = !v.blockEnd?.[i] && tightJoinOk(a, b);
      for (const glue of tight ? [" ", ""] : [" "]) {
        const joined = `${a}${glue}${b}`;
        for (const rule of active) {
          if (glue === "" && !TIGHT_JOIN.has(rule)) continue;
          for (const re of patterns[rule] ?? []) {
            for (const m of allMatches(joined, re)) {
              const end = m.index + m[0].length;
              const tail = joined.slice(end, end + 2);
              // Or an allowed value on line i whose tail only fuses on here.
              const fused =
                glue === "" &&
                end === a.length &&
                allowed(rule, m[0]) &&
                !allowed(rule, m[0], tail);
              if (
                m.index < a.length &&
                (end > a.length + glue.length || fused)
              ) {
                if (allowedAt(rule, joined, m.index, end)) continue;
                const k = `${i}|${rule}|${m.index}`;
                if (joinedSeen.has(k)) continue;
                joinedSeen.add(k);
                add(i + 1, rule, m[0], tail);
              }
            }
          }
        }
      }
    });
    for (const [key, n] of counts) {
      const e = best.get(key) as { hit: Hit; count: number };
      e.count = Math.max(e.count, n);
    }
  }
  const hits: Hit[] = [];
  for (const { hit, count } of best.values()) {
    for (let n = 0; n < count; n++) hits.push(hit);
  }
  return hits.sort((x, y) => x.line - y.line);
}

export function scanText(
  text: string,
  file: string,
  rules: readonly PiiRule[] = ALL_RULES,
): PiiFinding[] {
  const active = ALL_RULES.filter((r) => rules.includes(r));
  return scanWith(text, PATTERNS, active).map((h) => ({
    file,
    line: h.line,
    rule: h.rule as PiiRule,
    masked: h.masked,
  }));
}

export function scanMarkers(text: string, file: string): MarkerFinding[] {
  return scanWith(text, MARKER_PATTERNS, ["unresolved-marker"]).map((h) => ({
    file,
    line: h.line,
    rule: "unresolved-marker",
    masked: h.masked,
  }));
}

// ---------------------------------------------------------------------------
// Span finder for the output scrubber (P2-06). Additive only: it reuses
// PATTERNS, allowed() and the same raw/decoded/tag-stripped variants as
// scanText, but every view unit stays mapped to its source range, so a match
// in any view becomes a [start, end) span of the original text.

export type PiiSpan = { start: number; end: number; rule: PiiRule };

// A view string; `from[i]`..`to[i]` is the source range of view unit i.
type Mapped = { s: string; from: number[]; to: number[] };

function identityMapped(text: string): Mapped {
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < text.length; i++) {
    from.push(i);
    to.push(i + 1);
  }
  return { s: text, from, to };
}

// String#replace for a global regex, where every replacement unit maps to the
// whole source range of the text it replaced.
function mapReplace(
  m: Mapped,
  re: RegExp,
  fn: (match: string, at: number) => string,
): Mapped {
  re.lastIndex = 0;
  if (allMatches(m.s, re).next().done) return m;
  let s = "";
  const from: number[] = [];
  const to: number[] = [];
  const copy = (a: number, b: number) => {
    s += m.s.slice(a, b);
    for (let i = a; i < b; i++) {
      from.push(m.from[i] as number);
      to.push(m.to[i] as number);
    }
  };
  let last = 0;
  for (const hit of allMatches(m.s, re)) {
    const a = hit.index;
    const b = a + hit[0].length;
    if (b === a) continue;
    copy(last, a);
    const out = fn(hit[0], a);
    const fa = m.from[a] as number;
    const tb = m.to[b - 1] as number;
    s += out;
    for (let k = 0; k < out.length; k++) {
      from.push(fa);
      to.push(tb);
    }
    last = b;
  }
  copy(last, m.s.length);
  return { s, from, to };
}

// Same shape as decodeEntities(); each entity decodes on its own.
const ENTITY = /&(?:#\d+;?|#x[0-9a-f]+;?|[a-z]+;)/gi;
const CRLF = /\r\n?/g;
// Starts only where a whitespace run starts: same matches, linear (see
// H_RUN_START).
const LINE_RUN = /(?<!\s)\s*\n\s*/g;
const NON_ASCII = /\P{ASCII}/gu;

// normalize(), one code point at a time so the mapping survives.
function normalizeMapped(m: Mapped): Mapped {
  return mapReplace(m, NON_ASCII, (c) => normalize(c));
}

// resolveBreaks() with mapping (same decision, same regexes).
function resolveBreaksMapped(m: Mapped): Mapped {
  const s = m.s;
  return mapReplace(m, BREAK_RUN_EMAIL, (run, at) => {
    const before = normalize(s.slice(Math.max(0, at - 64), at)).trimEnd();
    const after = at + run.length;
    if (!tightJoinOk(before, s.slice(after, after + 64))) return run;
    EMAIL_AT.lastIndex =
      after + (s.slice(after).match(/^\s*/)?.[0].length ?? 0);
    const next = EMAIL_AT.exec(s);
    if (next && next[0].toLowerCase() === ALLOWED_EMAIL) return run;
    return run.replace(/[^\n]/g, "");
  });
}

// scanText's line joins: a single line break (with the spaces around it)
// reads as `glue`; a blank line stays as it is, as scanText never joins
// across one.
function joinLines(m: Mapped, glue: string): Mapped {
  const s = m.s;
  return mapReplace(m, LINE_RUN, (run, at) => {
    if (run.replace(/[^\n]/g, "").length !== 1) return run;
    const after = s.slice(at + run.length, at + run.length + 64);
    if (glue === "" && !tightJoinOk(s.slice(Math.max(0, at - 64), at), after)) {
      return " ";
    }
    return glue;
  });
}

type SpanView = { m: Mapped; checks: (rule: PiiRule) => boolean };

function spanViews(text: string): SpanView[] {
  const tight = (r: PiiRule) => TIGHT_JOIN.has(r);
  const raw = mapReplace(identityMapped(text), CRLF, () => "\n");
  const lined = raw.s.includes("\n");
  const glues = lined ? [" ", ""] : [" "];
  const bases = [raw];
  if (text.includes("&")) bases.push(mapReplace(raw, ENTITY, decodeEntities));
  const views: SpanView[] = [];
  for (const b of bases) {
    for (const g of glues) {
      views.push({ m: joinLines(b, g), checks: g === "" ? tight : () => true });
    }
  }
  const tagged = text.includes("<");
  for (const tag of tagged ? TAGS : []) {
    for (const glue of ["", " "]) {
      const stripped = mapReplace(
        mapReplace(raw, tag, (t) => stripTags(t, glue)),
        ENTITY,
        decodeEntities,
      );
      for (const g of glues) {
        const joined = joinLines(stripped, g);
        const ok = (r: PiiRule) => g === " " || tight(r);
        views.push({
          m: resolveBreaksMapped(joined),
          checks: (r) => r === "email" && ok(r),
        });
        views.push({
          m: mapReplace(joined, BREAK_RUN, () => " "),
          checks: (r) => r !== "email" && ok(r),
        });
      }
    }
  }
  // Identical views find identical spans: keep one of each per rule filter.
  const seen = new Set<string>();
  const out: SpanView[] = [];
  for (const v of views) {
    const m = normalizeMapped(v.m);
    const key = `${ALL_RULES.map((r) => (v.checks(r) ? 1 : 0)).join("")}|${m.s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ m, checks: v.checks });
  }
  return out;
}

// Every match of the given rules as a span of `text`, sorted by start with
// overlaps merged (a merged span keeps the rule of its first part). Allowed
// values (the contact email, the profile URLs) never produce a span.
export function piiSpans(
  text: string,
  rules: readonly PiiRule[] = ALL_RULES,
): PiiSpan[] {
  const active = ALL_RULES.filter((r) => rules.includes(r));
  const found: PiiSpan[] = [];
  for (const { m, checks } of spanViews(text)) {
    for (const rule of active) {
      if (!checks(rule)) continue;
      const seen: Array<readonly [number, number]> = [];
      for (const re of PATTERNS[rule]) {
        for (const hit of allMatches(m.s, re)) {
          const a = hit.index;
          const b = a + hit[0].length;
          if (b === a || seen.some(([x, y]) => a < y && b > x)) continue;
          seen.push([a, b]);
          if (allowed(rule, hit[0], m.s.slice(b, b + 2))) continue;
          const start = m.from[a] as number;
          const end = m.to[b - 1] as number;
          found.push({ start, end, rule });
        }
      }
    }
  }
  found.sort((x, y) => x.start - y.start || y.end - x.end);
  const out: PiiSpan[] = [];
  for (const f of found) {
    const prev = out[out.length - 1];
    if (prev && f.start < prev.end) prev.end = Math.max(prev.end, f.end);
    else out.push({ ...f });
  }
  return out;
}
