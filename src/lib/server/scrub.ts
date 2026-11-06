// Server only. Streaming output scrubber (SCOPE §6.6, CLAUDE.md rules 2/4).
// Model text passes through here before it is emitted: URLs that are not
// allowlisted and phone/street-address/ZIP/email matches are replaced.
// Pure functions: no I/O, no logging, no switch to turn it off.
//
// Streaming design. The text is cut into segments at "commit points" and each
// segment is scrubbed on its own (with read-only context around it). A commit
// point is a word start after whitespace that is not inside markup ("<" not
// yet closed), an entity run or a markdown link, and that no PII match
// crosses. Whether a position is a commit point depends only on the text up
// to the end of its lookahead window, so the streaming scrubber (which waits
// for that window) and scrub() (which has all of the text) cut at exactly the
// same places and produce the same output for any chunking. A window that
// never completes means no commit: the tail is held until flush(). Emitted
// text is never retracted.
//
// A "<" is markup only if a ">" follows within STRAY_LOOKAHEAD code units on
// the same line. Otherwise it is a stray (as in "I <3 testing") and is emitted
// as U+FF1C, so it never opens markup, neither here nor for a renderer. The
// decision reads a fixed lookahead, so it too is the same for any chunking;
// text reaches the commit logic only once every "<" before it is decided.
//
// Windows need both enough significant units (letters, digits, "@"; not
// whitespace, format characters or markup) and enough whole words, so
// padding with spaces, zero-width characters, tags or long words cannot push
// part of a value out of view.
import {
  ALLOWED_EMAIL,
  ALLOWED_URL_PREFIXES,
  piiSpans,
  type PiiRule,
} from "../pii.ts";
import { buildKb } from "../kb.ts";
import { ALLOWED_SITE_PATHS, extractKbUrls } from "../prompt.ts";
import { bundledKbSources } from "./kb-bundle.ts";

export type ScrubOptions = { allowedUrls: readonly string[] };

export const LINK_REMOVED = "[link removed]";
export const PII_REMOVED = "[removed]";

const PII_RULES: readonly PiiRule[] = [
  "phone",
  "street-address",
  "zip",
  "email",
];

// A window must hold at least this many significant units AND this many
// whole words (outside tags), so neither padding nor long words can push
// part of a value out of view: every PII pattern spans at most a few words.
const LOOKAHEAD = 96; // significant units after a commit point
const LOOKBACK = 64; // significant units of context before it
const WORDS = 8; // whole words on each side
const MIN_SEGMENT = 32; // code units between commit points
// Fail closed: once a held region passes this many code units without a
// commit point, nothing more is emitted until flush().
const HOLD_CAP = 4096;

// A "<" with no ">" in this many following code units (or before the end of
// its line) is a stray, not markup.
const STRAY_LOOKAHEAD = 64;
const STRAY_LT = "\uFF1C";

// Same-site relative link targets that may stay links (exact match only):
// the list the prompt gives Blob.
const RELATIVE_LINKS: ReadonlySet<string> = new Set(ALLOWED_SITE_PATHS);

// ---------------------------------------------------------------------------
// URL policy

const SCHEMES =
  "https?|ftps?|file|mailto|tel|sms|javascript|data|vbscript|blob|wss?";
// Any TLD (P4-15, F-OUT-1): two or more letters, or a punycode label. A
// closed list let "evil.zip" or "phish.top" through.
const TLDS = "xn--[A-Za-z0-9-]{1,59}|[A-Za-z]{2,63}";
const URL_CHAR = "[^\\s<>\"'`]";
const SCHEME_URL = new RegExp(
  `(?<![A-Za-z0-9])(?:${SCHEMES}):${URL_CHAR}*`,
  "iy",
);
const WWW_URL = new RegExp(
  `(?<![A-Za-z0-9.@-])www\\.[A-Za-z0-9]${URL_CHAR}*`,
  "iy",
);
const DOMAIN_URL = new RegExp(
  `(?<![A-Za-z0-9.@-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+(?:${TLDS})(?![A-Za-z0-9-])(?::\\d{1,5})?(?:[/?#]${URL_CHAR}*)?`,
  "iy",
);
// Product and file names that look like bare domains (only without a path,
// port or query): a few exact names, and file extensions that are not
// delegated TLDs, so "Node.js" or "config.yaml" can never resolve as a host.
const NOT_DOMAINS =
  /^(?:asp|ado|vb)\.net$|^socket\.io$|^readme\.md$|^[A-Za-z0-9][A-Za-z0-9.-]*\.(?:jsx?|tsx?|json|ya?ml|txt|html?|css|toml|ini|csv)$/i;
const MD_LINK = /\[([^[\]\n]*)\]\(([^\s()]*)\)/y;
// Any "](target" on its own, wherever its "[" is (or whether there is one),
// including a target with a title or angle brackets.
const LINK_TARGET = /\]\(\s*<?([^\s()<>]*)>?\)?/y;
// A reference-style definition's target ("[1]: x", "[1]: <x>", or the target
// on the next line). Only a label whose "[" starts a line (after indentation
// and list or blockquote markers) makes a definition. A stray "<" can leave
// "<x" open.
const REF_TARGET = /\]:([ \t]*(?:\r?\n[ \t]*)?)(<[^<>\n]*>|<?[^\s<>]+)/y;
const AUTOLINK = new RegExp(
  `<((?:${SCHEMES}):[^\\s<>]*|www\\.[^\\s<>]+)>`,
  "iy",
);
// Tags that could render or run; their "<" is dropped so they stay text.
const RAW_TAG =
  /<(?=\/?(?:a|script|img|iframe|svg|object|embed|style|link|meta|base|form|frame|frameset|math|input|button|video|audio|source|template)(?![A-Za-z0-9-]))/iy;
const TRAILING = /[.,;:!?)\]*_~]+$/;
const SCHEME_HEAD = /^([a-z][a-z0-9+.-]*):/i;
// After an allowed prefix: no traversal, encoded separators or userinfo.
const UNSAFE_REST = /\.\.|%(?:2e|2f|5c|40)|\\|@/i;

// Lowercase scheme and host, default to https, drop a leading "www.".
// Returns null for anything that can never be allowed.
function canonical(url: string): string | null {
  const head = SCHEME_HEAD.exec(url);
  if (!head) return canonical(`https://${url}`);
  const scheme = (head[1] as string).toLowerCase();
  let rest = url.slice(head[0].length);
  if (scheme === "mailto") return `mailto:${rest.toLowerCase()}`;
  if (scheme !== "https" && scheme !== "http") return null;
  if (!rest.startsWith("//")) return null;
  rest = rest.slice(2);
  const cut = rest.search(/[/?#]/);
  let host = (cut === -1 ? rest : rest.slice(0, cut)).toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  return `${scheme}://${host}${cut === -1 ? "" : rest.slice(cut)}`;
}

// The contact links in the knowledge base (the ones the prompt tells Blob it
// may use), in the order of the PII allowlist. Paths under them stay links.
const KB_URLS = extractKbUrls(buildKb(bundledKbSources()));
export const FIXED_ALLOWED_URL_PREFIXES: readonly string[] = [
  ...ALLOWED_URL_PREFIXES.flatMap((p) =>
    KB_URLS.filter((u) => canonical(u) === canonical(`https://${p}`)),
  ),
  ...KB_URLS.filter((u) => u.toLowerCase() === `mailto:${ALLOWED_EMAIL}`),
];

type Policy = (url: string) => boolean;

function urlPolicy(opts: ScrubOptions): Policy {
  const exact = new Set<string>();
  for (const u of opts.allowedUrls) {
    const c = canonical(u);
    if (c !== null) exact.add(c);
  }
  const prefixes = FIXED_ALLOWED_URL_PREFIXES.map((p) =>
    (canonical(p) as string).toLowerCase(),
  );
  return (url) => {
    if (RELATIVE_LINKS.has(url)) return true;
    // Any other scheme-less path, or a protocol-relative one, is not a link
    // we can vouch for.
    if (/^[/\\#.?]/.test(url)) return false;
    const c = canonical(url);
    if (c === null) return false;
    if (exact.has(c)) return true;
    const lc = c.toLowerCase();
    return prefixes.some((p) => {
      if (!lc.startsWith(p)) return false;
      const rest = lc.slice(p.length);
      return (
        (rest === "" || "/?#".includes(rest.charAt(0))) &&
        !UNSAFE_REST.test(rest)
      );
    });
  };
}

// ---------------------------------------------------------------------------
// Segment scrubbing

// A replacement of raw range [s, e). Higher `pri` wins where edits overlap.
type Edit = { s: number; e: number; out: string; pri: number };
const PRI_FORMAT = 0;
const PRI_URL = 1;
const PRI_PII = 2;

// URL detection runs on a folded copy: format characters dropped, fullwidth
// and other compatibility forms mapped to ASCII (NFKC), so a fullwidth domain
// or one with a zero-width space inside is still seen. Folded unit k maps to raw
// [start[k], end[k]).
type Folded = { f: string; start: number[]; end: number[] };

const FORMAT = /^\p{Cf}$/u;
const PRINTABLE_ASCII = /^[!-~]+$/;
const DOTS = new Set([0x3002, 0xff61]);

function fold(seg: string): Folded {
  let f = "";
  const start: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < seg.length;) {
    const cp = seg.codePointAt(i) as number;
    const n = cp > 0xffff ? 2 : 1;
    const ch = seg.slice(i, i + n);
    let out = ch;
    if (cp >= 0x80) {
      if (FORMAT.test(ch)) out = "";
      else if (DOTS.has(cp)) out = ".";
      else {
        const k = ch.normalize("NFKC");
        if (PRINTABLE_ASCII.test(k)) out = k;
      }
    }
    for (let u = 0; u < out.length; u++) {
      f += out.charAt(u);
      start.push(i);
      end.push(i + n);
    }
    i += n;
  }
  return { f, start, end };
}

const ALNUM = /[A-Za-z0-9]/;

// A bare URL starting exactly at `i`, without trailing punctuation.
function bareUrlAt(f: string, i: number): string | null {
  SCHEME_URL.lastIndex = i;
  const s = SCHEME_URL.exec(f);
  if (s) {
    const head = (SCHEME_HEAD.exec(s[0]) as RegExpExecArray)[0];
    const body = s[0].slice(head.length).replace(TRAILING, "");
    return body === "" ? null : head + body;
  }
  WWW_URL.lastIndex = i;
  const w = WWW_URL.exec(f);
  if (w) return w[0].replace(TRAILING, "");
  DOMAIN_URL.lastIndex = i;
  const d = DOMAIN_URL.exec(f);
  if (d) {
    const u = d[0].replace(TRAILING, "");
    return NOT_DOMAINS.test(u) ? null : u;
  }
  return null;
}

// Is the "]" at raw position `at` the end of a definition label?
type DefCheck = (at: number) => boolean;

function urlEdits(
  fd: Folded,
  allow: Policy,
  isDef: DefCheck,
  lo: number,
  hi: number,
  links: boolean,
  edits: Edit[],
): void {
  const f = fd.f.slice(lo, hi);
  const add = (a: number, b: number, out: string) => {
    edits.push({
      s: fd.start[lo + a] as number,
      e: fd.end[lo + b - 1] as number,
      out,
      pri: PRI_URL,
    });
  };
  let i = 0;
  while (i < f.length) {
    const c = f.charAt(i);
    if (links && c === "[") {
      MD_LINK.lastIndex = i;
      const m = MD_LINK.exec(f);
      if (m) {
        const text = m[1] as string;
        const textEnd = i + 1 + text.length;
        if (text !== "")
          urlEdits(fd, allow, isDef, lo + i + 1, lo + textEnd, false, edits);
        if (!allow(m[2] as string)) {
          add(i, i + 1, "");
          add(textEnd, i + m[0].length, ` ${LINK_REMOVED}`);
        }
        i += m[0].length;
        continue;
      }
    }
    if (c === "]") {
      LINK_TARGET.lastIndex = i;
      const m = LINK_TARGET.exec(f);
      if (m) {
        const target = m[1] as string;
        if (target === "" || !allow(target)) {
          add(i + 1, i + m[0].length, ` ${LINK_REMOVED}`);
        }
        i += m[0].length;
        continue;
      }
      REF_TARGET.lastIndex = i;
      const r = REF_TARGET.exec(f);
      if (r && isDef(fd.start[lo + i] as number)) {
        const raw = r[2] as string;
        const target =
          raw.startsWith("<") && raw.endsWith(">")
            ? raw.slice(1, -1)
            : raw.replace(/^</, "");
        if (target === "" || !allow(target)) {
          add(i + 2 + (r[1] as string).length, i + r[0].length, LINK_REMOVED);
        }
        i += r[0].length;
        continue;
      }
    }
    if (c === "<") {
      AUTOLINK.lastIndex = i;
      const m = AUTOLINK.exec(f);
      if (m) {
        if (!allow(m[1] as string)) add(i, i + m[0].length, LINK_REMOVED);
        i += m[0].length;
        continue;
      }
      RAW_TAG.lastIndex = i;
      if (RAW_TAG.test(f)) add(i, i + 1, "");
      i++;
      continue;
    }
    if (ALNUM.test(c)) {
      const url = bareUrlAt(f, i);
      if (url !== null) {
        if (!allow(url)) add(i, i + url.length, LINK_REMOVED);
        i += url.length;
        continue;
      }
    }
    i++;
  }
}

const ZWJ = 0x200d;
const PICTO = /^\p{Extended_Pictographic}$/u;
// Variation selector 16 or a skin-tone modifier.
const EMOJI_TAIL = /^(?:\u{FE0F}|\p{Emoji_Modifier})$/u;

// Invisible format characters are dropped, except a zero-width joiner inside
// an emoji sequence.
function formatEdits(seg: string, edits: Edit[]): void {
  for (let i = 0; i < seg.length;) {
    const cp = seg.codePointAt(i) as number;
    const n = cp > 0xffff ? 2 : 1;
    const ch = seg.slice(i, i + n);
    if (cp >= 0x80 && FORMAT.test(ch)) {
      let keep = false;
      if (cp === ZWJ) {
        const prev = Array.from(seg.slice(Math.max(0, i - 2), i)).pop() ?? "";
        const next = String.fromCodePoint(seg.codePointAt(i + 1) ?? 0x20);
        keep = (PICTO.test(prev) || EMOJI_TAIL.test(prev)) && PICTO.test(next);
      }
      if (!keep) edits.push({ s: i, e: i + n, out: "", pri: PRI_FORMAT });
    }
    i += n;
  }
}

// The edited text; output unit k comes from raw [from[k], to[k]).
type Applied = { s: string; from: number[]; to: number[] };

function apply(seg: string, edits: Edit[]): Applied {
  edits.sort((a, b) => a.s - b.s || b.e - a.e);
  const merged: Edit[] = [];
  for (const ed of edits) {
    const prev = merged[merged.length - 1];
    if (prev && ed.s < prev.e) {
      if (ed.pri > prev.pri) {
        prev.out = ed.out;
        prev.pri = ed.pri;
      }
      prev.e = Math.max(prev.e, ed.e);
    } else merged.push({ ...ed });
  }
  let out = "";
  const from: number[] = [];
  const to: number[] = [];
  const copy = (a: number, b: number) => {
    out += seg.slice(a, b);
    for (let k = a; k < b; k++) {
      from.push(k);
      to.push(k + 1);
    }
  };
  let last = 0;
  for (const m of merged) {
    copy(last, m.s);
    out += m.out;
    for (let k = 0; k < m.out.length; k++) {
      from.push(m.s);
      to.push(m.e);
    }
    last = m.e;
  }
  copy(last, seg.length);
  return { s: out, from, to };
}

// Line-start markers before a definition label: indentation, list bullets
// and numbers, blockquote markers.
const LINE_HEAD = /[ \t>*+\-.)0-9]/;

// ---------------------------------------------------------------------------
// Commit points

// Fast path, conservative: every phone, address, ZIP and email pattern needs
// a digit, an "@" or "tel:" once NFKC-normalized, with tags, format
// characters and line breaks taken out; entities ("&") always take the full
// check.
const PII_HINT = /[\p{Nd}@&]/u;
const TEL = /tel:/i;
// Both tag readings piiSpans uses, to the first ">" and without a "<" inside,
// are taken out by hideMarkup() below.

// Markdown emphasis, strikethrough and code-span markers.
const MD_MARK = /[*_~`]/;

function markEdits(text: string): Edit[] {
  const edits: Edit[] = [];
  for (let i = 0; i < text.length; i++) {
    if (MD_MARK.test(text.charAt(i))) {
      edits.push({ s: i, e: i + 1, out: "", pri: PRI_FORMAT });
    }
  }
  return edits;
}

// The same as n.replace(R, "") for R = /<[^>]*>|\p{Cf}|\s*\n\s*/gu, or with
// <[^<>]*> as the tag for `inner`, in one linear pass (P5-12).
// The regexes rescan from every position: a "<" with no ">" after it scans
// to the end, and so does each space of a run with no line break, so long
// runs made them quadratic. Plain text between those characters is copied
// as whole slices, found with native regexes. Exported for tests only.
const HIDE_NEXT = /[<\s\p{Cf}]/gu; // where any alternative could start
const CF_AT = /\p{Cf}/uy;
const WS_RUN = /\s+/y;
const ANGLE = /[<>]/g;
const CF_ALL = /\p{Cf}/gu;

export function hideMarkup(n: string, inner: boolean): string {
  let out = "";
  let gt = n.indexOf(">");
  let i = 0;
  while (i < n.length) {
    HIDE_NEXT.lastIndex = i;
    const hit = HIDE_NEXT.exec(n);
    if (!hit) break;
    const k = hit.index;
    out += n.slice(i, k);
    if (n.charCodeAt(k) === 0x3c) {
      // The tag alternative: to the first ">" (none after this "<" means
      // none after any later one), or for the inner reading only if a ">"
      // comes before the next "<".
      let close = -1;
      if (inner) {
        ANGLE.lastIndex = k + 1;
        const a = ANGLE.exec(n);
        if (a && a[0] === ">") close = a.index;
      } else {
        if (gt !== -1 && gt < k) gt = n.indexOf(">", k);
        close = gt;
      }
      if (close >= 0) {
        i = close + 1;
      } else {
        out += "<";
        i = k + 1;
      }
      continue;
    }
    // \p{Cf} comes before the line-break alternative, so U+FEFF (both a
    // format character and \s) is always dropped on its own.
    CF_AT.lastIndex = k;
    if (CF_AT.test(n)) {
      i = CF_AT.lastIndex;
      continue;
    }
    // \s*\n\s* from a space matches the rest of its run when the run holds
    // a line break, and fails at every position of it otherwise (where only
    // a U+FEFF inside it is dropped, as a format character).
    WS_RUN.lastIndex = k;
    WS_RUN.test(n);
    const r = WS_RUN.lastIndex;
    const run = n.slice(k, r);
    if (!run.includes("\n")) out += run.replace(CF_ALL, "");
    i = r;
  }
  return i < n.length ? out + n.slice(i) : out;
}

function mayHavePii(text: string): boolean {
  const n = text.normalize("NFKC");
  if (PII_HINT.test(n)) return true;
  // Taking characters out never adds one, so without a ":" there is no
  // "tel:" in either hidden reading.
  if (!n.includes(":")) return false;
  return TEL.test(hideMarkup(n, false)) || TEL.test(hideMarkup(n, true));
}

const WS = /\s/;
const SIGNIFICANT = /^[\p{L}\p{N}@\u{FF20}\u{FE6B}]$/u;
// An entity right before the whitespace at a candidate ("&nbsp; ...").
const ENTITY_END = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);?$/i;

type Pending = {
  p: number;
  from: number;
  i: number;
  sig: number;
  words: number;
};

// Append-only text kept as code units. A string grown with += is a rope that
// V8 flattens (copies whole) on the first read after each append, so reading
// it after every one-unit push would be quadratic.
class Units {
  private codes: number[] = [];

  get length(): number {
    return this.codes.length;
  }

  push(s: string): void {
    for (let i = 0; i < s.length; i++) this.codes.push(s.charCodeAt(i));
  }

  code(i: number): number {
    return this.codes[i] ?? NaN;
  }

  charAt(i: number): string {
    const c = this.codes[i];
    return c === undefined ? "" : String.fromCharCode(c);
  }

  slice(a: number, b: number): string {
    const end = Math.min(b, this.codes.length);
    let out = "";
    for (let k = Math.max(0, a); k < end; k += 4096) {
      out += String.fromCharCode(
        ...this.codes.slice(k, Math.min(end, k + 4096)),
      );
    }
    return out;
  }
}

class Engine {
  private text = new Units();
  // Per code unit, each from the text before it (and the unit itself):
  private weight: number[] = []; // 1 for a significant unit
  private word: boolean[] = []; // a word starts here, outside any tag
  private stray: boolean[] = []; // a stray "<", emitted as U+FF1C
  private ready = 0; // units decided so far (every "<" before them settled)
  private tagOpen = false;
  private prev = -1; // previous code unit
  private prevWs = false;
  private segStart = 0;
  private scan = 1;
  private pending: Pending | null = null;
  private held = false; // HOLD_CAP passed: emit nothing until flush
  private readonly allow: Policy;

  constructor(opts: ScrubOptions) {
    this.allow = urlPolicy(opts);
  }

  append(chunk: string): void {
    this.text.push(chunk);
    this.decide(false);
  }

  // The "<" at `i`: true for a stray, false for markup, null while the
  // lookahead has not arrived (at the end of the text it never will).
  private isStray(i: number, final: boolean): boolean | null {
    const t = this.text;
    const stop = i + 1 + STRAY_LOOKAHEAD;
    for (let k = i + 1; k < Math.min(t.length, stop); k++) {
      const c = t.code(k);
      if (c === 0x3e) return false;
      if (c === 0x0a || c === 0x0d) return true;
    }
    return t.length >= stop || final ? true : null;
  }

  // Per-unit state for every unit up to the first undecided "<". A surrogate
  // pair weighs on its low half, so a split pair is never counted early. A
  // markup "<" opens a tag until the next ">", and a nested "<" keeps it
  // open: piiSpans strips both "<x <b>" and its inner "<b>", so the unit
  // counts as markup if either reading says so (windows only get wider). Reads
  // only new units (and the previous one), never the joined text as a whole,
  // so one-unit chunks don't re-flatten the string on every push.
  private decide(final: boolean): void {
    const t = this.text;
    for (; this.ready < t.length; this.ready++) {
      const c = t.code(this.ready);
      const prev = this.prev;
      const inTag = this.tagOpen;
      let stray = false;
      if (c === 0x3c) {
        const st = this.isStray(this.ready, final);
        if (st === null) return;
        stray = st;
      }
      let w = 0;
      if (c === 0x3c && !stray) this.tagOpen = true;
      else if (c === 0x3e) this.tagOpen = false;
      else if (inTag || (c >= 0xd800 && c <= 0xdbff)) w = 0;
      else if (c >= 0xdc00 && c <= 0xdfff) {
        const pair = prev >= 0xd800 && prev <= 0xdbff;
        w = pair && SIGNIFICANT.test(String.fromCharCode(prev, c)) ? 1 : 0;
      } else w = SIGNIFICANT.test(String.fromCharCode(c)) ? 1 : 0;
      const ws = WS.test(String.fromCharCode(c));
      this.weight.push(w);
      this.stray.push(stray);
      this.word.push(!inTag && !ws && (prev < 0 || this.prevWs));
      this.prev = c;
      this.prevWs = ws;
    }
  }

  // End of the lookahead window after `p` (a word start, so the last word is
  // whole), or -1 while it has not arrived. Progress is cached, so a long
  // insignificant tail fed one unit at a time stays linear.
  private ahead(p: number, from: number): number {
    const pd =
      this.pending?.p === p
        ? this.pending
        : { p, from, i: p, sig: 0, words: 0 };
    const len = this.ready;
    for (; pd.i < len; pd.i++) {
      if (this.word[pd.i]) {
        if (pd.i > p && pd.words >= WORDS && pd.sig >= LOOKAHEAD) {
          this.pending = null;
          return pd.i;
        }
        pd.words++;
      }
      pd.sig += this.weight[pd.i] as number;
    }
    this.pending = pd;
    return -1;
  }

  // Start of the context window before `p`: a word start with enough words
  // and significant units between it and `p`.
  private behind(p: number): number {
    let sig = 0;
    let words = 0;
    for (let i = p - 1; i > 0; i--) {
      sig += this.weight[i] as number;
      if (this.word[i] && ++words >= WORDS && sig >= LOOKBACK) return i;
    }
    return 0;
  }

  // An entity run, an open markdown link or a reference definition's target
  // at `p`. (`p` is a word start, so it is never inside markup.)
  private blocked(p: number, from: number): boolean {
    const t = this.text;
    if (t.charAt(p) === "&") return true;
    let j = p - 1;
    while (j > 0 && WS.test(t.charAt(j))) j--;
    if (ENTITY_END.test(t.slice(Math.max(0, j - 15), j + 1))) return true;
    if (t.charAt(j) === ":" && t.charAt(j - 1) === "]") return true;
    for (let i = j; i >= from; i--) {
      const c = t.charAt(i);
      if (c === "\n" || c === "]") return false;
      if (c === "[") return true;
    }
    return false;
  }

  // The label's "[" (up to 1000 units back, across line breaks) starts a
  // line, after indentation and list or blockquote markers only. Reads only
  // the text before `at`, so it does not depend on where segments are cut.
  private readonly isDef: DefCheck = (at) => {
    const t = this.text;
    for (let k = at - 1; k >= Math.max(0, at - 1000); k--) {
      const c = t.charAt(k);
      if (c === "]") return false;
      if (c !== "[") continue;
      for (let h = k - 1; h >= 0; h--) {
        const d = t.charAt(h);
        if (d === "\n" || d === "\r") return true;
        if (!LINE_HEAD.test(d)) return false;
      }
      return true;
    }
    return false;
  };

  // Every edit but PII removal, for raw [a, b): links, format characters,
  // strays.
  private edits(a: number, b: number): Edit[] {
    const seg = this.text.slice(a, b);
    const edits: Edit[] = [];
    const fd = fold(seg);
    const isDef: DefCheck = (at) => this.isDef(a + at);
    urlEdits(fd, this.allow, isDef, 0, fd.f.length, true, edits);
    formatEdits(seg, edits);
    for (let i = a; i < b; i++) {
      if (this.stray[i]) {
        edits.push({ s: i - a, e: i - a + 1, out: STRAY_LT, pri: PRI_FORMAT });
      }
    }
    return edits;
  }

  // PII in raw [from, to), read both as written and as it would be emitted
  // (strays as U+FF1C, dropped "<", removed links): an edit that takes out a
  // "<" or ">" can turn text into a tag that piiSpans strips.
  private piiIn(from: number, to: number): Array<[number, number]> {
    const text = this.text.slice(from, to);
    if (!mayHavePii(text)) return [];
    const out = piiSpans(text, PII_RULES).map((s): [number, number] => [
      from + s.start,
      from + s.end,
    ]);
    const views: Applied[] = [];
    if (text.includes("<")) views.push(apply(text, this.edits(from, to)));
    // Markdown emphasis between digit groups ("**617**-555-...") hides a
    // phone from the patterns, so read the text without it too (P4-15).
    if (MD_MARK.test(text)) views.push(apply(text, markEdits(text)));
    for (const em of views) {
      for (const sp of piiSpans(em.s, PII_RULES)) {
        out.push([
          from + (em.from[sp.start] as number),
          from + (em.to[sp.end - 1] as number),
        ]);
      }
    }
    return out;
  }

  private segment(a: number, b: number, end: number): string {
    const seg = this.text.slice(a, b);
    const edits = this.edits(a, b);
    for (const [s, e] of this.piiIn(this.behind(a), end)) {
      const cs = Math.max(s, a) - a;
      const ce = Math.min(e, b) - a;
      if (cs < ce) edits.push({ s: cs, e: ce, out: PII_REMOVED, pri: PRI_PII });
    }
    return apply(seg, edits).s;
  }

  // Scrub every segment whose end is settled. A candidate whose window has
  // not arrived stops the scan; at flush it is simply not a commit point.
  step(): string {
    if (this.held) return "";
    let out = "";
    let p = Math.max(this.scan, this.segStart + MIN_SEGMENT);
    for (; p < this.ready; p++) {
      if (!this.word[p]) continue;
      if (p - this.segStart > HOLD_CAP) {
        this.held = true;
        return out;
      }
      // A pending candidate already passed these checks.
      let from = this.pending?.p === p ? this.pending.from : -1;
      if (from < 0) {
        from = this.behind(p);
        if (this.blocked(p, from)) continue;
      }
      const end = this.ahead(p, from);
      if (end < 0) {
        this.scan = p;
        return out;
      }
      if (!this.piiIn(from, end).some(([s, e]) => s < p && e > p)) {
        out += this.segment(this.segStart, p, end);
        this.segStart = p;
        p += MIN_SEGMENT - 1;
      }
    }
    this.scan = Math.max(p, 1);
    return out;
  }

  finish(): string {
    this.decide(true);
    const out = this.step();
    const len = this.text.length;
    const rest =
      len > this.segStart ? this.segment(this.segStart, len, len) : "";
    this.text = new Units();
    this.weight = [];
    this.word = [];
    this.stray = [];
    this.ready = 0;
    this.tagOpen = false;
    this.prev = -1;
    this.prevWs = false;
    this.segStart = 0;
    this.scan = 1;
    this.pending = null;
    this.held = false;
    return out + rest;
  }
}

// Reference implementation: the whole text in one pass.
export function scrub(text: string, opts: ScrubOptions): string {
  const e = new Engine(opts);
  e.append(text);
  return e.finish();
}

// Streaming: push() returns the text that is settled so far; flush() returns
// the rest. For any chunking, the pieces joined equal scrub(input).
export function createScrubber(opts: ScrubOptions): {
  push(chunk: string): string;
  flush(): string;
} {
  const e = new Engine(opts);
  return {
    push(chunk: string): string {
      e.append(chunk);
      return e.step();
    },
    flush(): string {
      return e.finish();
    },
  };
}
