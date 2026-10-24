// Scrubber cost on adversarial input (P5-12). Every case must stay near
// linear: a quadratic step turns a 64 KB reply into minutes of CPU on the
// chat route. Sizes run smallest first and each one must beat a generous
// budget, so a regression fails fast at a small size instead of hanging the
// suite at 64 KB; a growth ratio then catches it even on a slow machine.
import { describe, expect, it } from "vitest";
import {
  createScrubber,
  hideMarkup,
  scrub,
  type ScrubOptions,
} from "../../src/lib/server/scrub.ts";
import {
  EMAIL_PATTERN,
  TAG_PATTERN,
  allMatches,
  piiSpans,
  scanText,
} from "../../src/lib/pii.ts";

// PII-shaped samples are assembled at runtime (CLAUDE.md rule 2): fictional
// 555-01xx numbers and reserved example domains.
const j = (...parts: string[]) => parts.join("");
const PHONE = j("617-", "555-", "01", "23");
const HALF = j("555-", "01", "23");
const OPTS: ScrubOptions = { allowedUrls: [] };

const KB = 1024;
const SIZES = [4 * KB, 16 * KB, 32 * KB, 64 * KB];
// Per run. The reported case must finish every size in 1 s (it took about 7
// minutes at 32 KB before the fix). The other shapes do more work per unit
// (many PII hits, many commit points), so they get 1 s or 60 ms per KB,
// whichever is more: still far below what a quadratic step costs at 64 KB.
const REPORTED_BUDGET_MS = 1000;
const budget = (n: number) => Math.max(1000, (n / KB) * 60);
// time(64K) / time(16K): about 4 when linear, 16 when quadratic.
const MAX_RATIO = 8;
// Timer noise floor for the ratio's denominator.
const FLOOR_MS = 5;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

function time(f: () => void, limit: number): number {
  const runs: number[] = [];
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    f();
    const dt = performance.now() - t;
    runs.push(dt);
    expect(dt).toBeLessThan(limit);
  }
  return median(runs);
}

// Runs `run` on `make(n)` for each size, failing at the first size over
// budget, then checks the growth from 16 KB to 64 KB.
function ladder(
  make: (n: number) => string,
  run: (text: string) => void,
  limit: (n: number) => number = budget,
) {
  const t = new Map<number, number>();
  for (const n of SIZES) {
    const text = make(n);
    t.set(
      n,
      time(() => run(text), limit(n)),
    );
  }
  const ratio =
    (t.get(64 * KB) as number) / Math.max(t.get(16 * KB) as number, FLOOR_MS);
  expect(ratio).toBeLessThan(MAX_RATIO);
}

// A text of about `n` code units: `head`, `unit` repeated, `tail`.
const fill = (head: string, unit: string, tail: string) => (n: number) =>
  head + unit.repeat(Math.max(1, Math.ceil(n / unit.length))) + tail;

const SHAPES: Record<string, (n: number) => string> = {
  // The reported case: a stray "<" and one long tag-like word between a
  // phone number's halves.
  "stray < with a long run between phone halves": fill(
    j("Some words. ", PHONE, "<x "),
    "w",
    j(">", HALF, " tail"),
  ),
  "long word after a phone, no markup": fill(j(PHONE, " "), "w", " tail"),
  "long local-part run before an @": fill(j(PHONE, " "), "a.b-", "@ x"),
  "many stray <": fill(j(PHONE, " "), "< ", " tail"),
  "stray < followed by long words": fill(
    j(PHONE, " "),
    `<${"q".repeat(70)} `,
    "",
  ),
  "tags with nothing significant": fill(j(PHONE, " "), "a <i         >", ""),
  "nested partial URLs": fill(
    j(PHONE, " "),
    "[x](https://a.example/[y](www.b.example/(",
    "",
  ),
  "dotted run without a TLD end": fill(j(PHONE, " "), "a.", "1"),
  "www chains": fill(j(PHONE, " "), "www.", " x"),
  "interleaved phone and email fragments": fill(
    "",
    j("617-555-", "x", "@ex", "ample.c ", "01", "23 a", "@b.", "c "),
    "",
  ),
  "digits and @ everywhere": fill("", "1@2@3-4.5 ", ""),
  "entity runs": fill(j(PHONE, " "), "&amp;", " x"),
  "markdown emphasis between digit groups": fill("", j("**617**-5", "55 "), ""),
  "open link brackets": fill(j(PHONE, " "), "[", " x"),
  "link targets": fill(j(PHONE, " "), "](", " x"),
  "line breaks between fragments": fill("", j("617-\n555-\n", "01\n23 "), ""),
  "long spaces with no line break": fill(j(PHONE, " x"), " ", "x"),
  "spaces and byte-order marks": fill(j(PHONE, " "), " ﻿", "x"),
  "block tags padded with spaces": fill(PHONE, "<p>      ", ""),
  // No digit or "@": the scrubber's own tel: precheck reads all of it.
  "no digits, many stray < and a tel:": fill("words ", "< ", " tel: x"),
  "no digits, long spaces and a tel:": fill("words ", " ", "tel: x"),
};

const REPORTED = SHAPES["stray < with a long run between phone halves"] as (
  n: number,
) => string;

function streamed(text: string, size: number): string {
  const sc = createScrubber(OPTS);
  let out = "";
  for (let i = 0; i < text.length; i += size) {
    out += sc.push(text.slice(i, i + size));
  }
  return out + sc.flush();
}

describe("the reported case", () => {
  it("removes the phone and streams to the same output", () => {
    const text = REPORTED(32 * KB);
    const out = scrub(text, OPTS);
    expect(out).not.toContain(PHONE);
    expect(streamed(text, 64)).toBe(out);
  });

  it("scrub() takes under 1 s at 32 KB and 64 KB", () => {
    ladder(
      REPORTED,
      (text) => scrub(text, OPTS),
      () => REPORTED_BUDGET_MS,
    );
  }, 60_000);

  it("streaming takes under 1 s at 32 KB and 64 KB", () => {
    ladder(
      REPORTED,
      (text) => streamed(text, 64),
      () => REPORTED_BUDGET_MS,
    );
  }, 60_000);
});

describe("scrub() stays near linear", () => {
  for (const [name, make] of Object.entries(SHAPES)) {
    it(name, () => ladder(make, (text) => scrub(text, OPTS)), 120_000);
  }
});

describe("streaming scrubber stays near linear", () => {
  for (const [name, make] of Object.entries(SHAPES)) {
    it(
      name,
      () => {
        const text = make(16 * KB);
        expect(streamed(text, 64)).toBe(scrub(text, OPTS));
        ladder(make, (t) => streamed(t, 64));
      },
      240_000,
    );
  }
});

describe("PII scan stays near linear", () => {
  for (const name of [
    "long word after a phone, no markup",
    "many stray <",
    "long spaces with no line break",
    "block tags padded with spaces",
  ]) {
    const make = SHAPES[name] as (n: number) => string;
    it(`piiSpans: ${name}`, () => {
      ladder(make, (text) => piiSpans(text));
    }, 120_000);
    it(`scanText: ${name}`, () => {
      ladder(make, (text) => scanText(text, "x.md"));
    }, 120_000);
  }
});

// The linear forms must find exactly what the regexes they replace find.
// Random strings over small alphabets hit the edge cases (runs, nesting,
// matches that end where the next run starts) far more often than prose.
// Deterministic PRNG (mulberry32) so a failure reproduces.
function sampler(alphabet: readonly string[], seed: number) {
  let st = seed;
  const rand = () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    let s = "";
    const n = Math.floor(rand() * 40);
    for (let k = 0; k < n; k++) {
      s += alphabet[Math.floor(rand() * alphabet.length)] as string;
    }
    return s;
  };
}

const all = (re: RegExp, s: string) =>
  [...s.matchAll(re)].map((m) => [m.index, m[0]]);
const linearAll = (re: RegExp, s: string) =>
  [...allMatches(s, re)].map((m) => [m.index, m[0]]);
// A fresh, unregistered copy: plain matchAll().
const plain = (re: RegExp) => new RegExp(re.source, re.flags);
const ROUNDS = 20_000;
const BREAK = "\u0001";

describe("linear forms match exactly like the regexes they replace", () => {
  it("the patterns stay plain RegExps (a subclass slows every regex)", () => {
    for (const re of [EMAIL_PATTERN, TAG_PATTERN]) {
      expect(Object.getPrototypeOf(re)).toBe(RegExp.prototype);
    }
  });

  it("allMatches(TAG_PATTERN) and <[^>]*>", () => {
    const sample = sampler(["<", ">", "a", " ", "\n", "<b>"], 1);
    for (let k = 0; k < ROUNDS; k++) {
      const s = sample();
      expect(linearAll(TAG_PATTERN, s), s).toEqual(all(plain(TAG_PATTERN), s));
    }
  });

  it("allMatches(EMAIL_PATTERN) and the plain email pattern", () => {
    const sample = sampler([..."ab1._%+-@@.. x<"], 0x5eed);
    for (let k = 0; k < ROUNDS; k++) {
      const s = sample();
      expect(linearAll(EMAIL_PATTERN, s), s).toEqual(
        all(plain(EMAIL_PATTERN), s),
      );
    }
    for (const s of [
      j("a", "@b.com-x", "@c.com"),
      j("a", "@b.com_x", "@c.com"),
      j("a", "@b.co.uk.", "x@d.io"),
      j("x", "@", "@a.bc"),
      j("@a.bc", "d@e.fg"),
      j("a.b-", "a.b-@ x", "y@z.ab"),
      "",
      "@",
      j("a", "@b.c"),
    ]) {
      expect(linearAll(EMAIL_PATTERN, s), s).toEqual(
        all(plain(EMAIL_PATTERN), s),
      );
    }
  });

  it("allMatches on an unregistered regex is matchAll", () => {
    const s = "a1 b22 c333";
    expect(linearAll(/\d+/g, s)).toEqual(all(/\d+/g, s));
  });

  it("hideMarkup and the tag, format and line-break regexes", () => {
    const sample = sampler(
      ["<", ">", "a", " ", "\t", "\n", "\r", "﻿", "​", "\u{E0041}", " "],
      2,
    );
    const outer = /<[^>]*>|\p{Cf}|\s*\n\s*/gu;
    const inner = /<[^<>]*>|\p{Cf}|\s*\n\s*/gu;
    for (let k = 0; k < ROUNDS; k++) {
      const s = sample();
      expect(hideMarkup(s, false), JSON.stringify(s)).toBe(
        s.replace(outer, ""),
      );
      expect(hideMarkup(s, true), JSON.stringify(s)).toBe(s.replace(inner, ""));
    }
  });

  // The lookbehinds added to pii.ts's break and line-run patterns.
  it("run-start lookbehinds change no match", () => {
    const pairs: Array<[RegExp, RegExp]> = [
      [/\s*\n\s*/g, /(?<!\s)\s*\n\s*/g],
      [
        new RegExp(`[^\\S\\n]*${BREAK}(?:[^\\S\\n]|${BREAK})*`, "g"),
        new RegExp(
          `(?<![^\\S\\n])[^\\S\\n]*${BREAK}(?:[^\\S\\n]|${BREAK})*`,
          "g",
        ),
      ],
      [
        new RegExp(`[^\\S\\n]*${BREAK}(?:\\s*${BREAK})*[^\\S\\n]*`, "g"),
        new RegExp(
          `(?<![^\\S\\n])[^\\S\\n]*${BREAK}(?:\\s*${BREAK})*[^\\S\\n]*`,
          "g",
        ),
      ],
    ];
    const sample = sampler([" ", "\t", "\n", BREAK, "a", "﻿"], 3);
    for (let k = 0; k < ROUNDS; k++) {
      const s = sample();
      for (const [plain, linear] of pairs) {
        expect(all(linear, s), JSON.stringify(s)).toEqual(all(plain, s));
      }
    }
  });
});
