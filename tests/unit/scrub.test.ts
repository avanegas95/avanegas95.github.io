import { describe, expect, it } from "vitest";
import {
  FIXED_ALLOWED_URL_PREFIXES,
  LINK_REMOVED,
  PII_REMOVED,
  createScrubber,
  scrub,
  type ScrubOptions,
} from "../../src/lib/server/scrub.ts";
import { piiSpans, type PiiRule } from "../../src/lib/pii.ts";
import { buildKb, loadKbSources } from "../../src/lib/kb.ts";
import {
  ALLOWED_SITE_PATHS,
  buildSystemPrompt,
  extractKbUrls,
} from "../../src/lib/prompt.ts";

// PII-shaped samples are assembled at runtime from fragments (CLAUDE.md rule
// 2): fictional 555-01xx numbers, made-up streets, reserved example domains.
const j = (...parts: string[]) => parts.join("");
const cp = (n: number) => String.fromCodePoint(n);
const AREA = "617";
const EXCH = "555";
const LINE = j("01", "23");
const PHONE = [AREA, EXCH, LINE].join("-");
const PHONE_PAREN = j("(", AREA, ") ", EXCH, "-", LINE);
const STREET = j("12", "3 Main ", "Street");
const CITY_ZIP = j("Anytown, ", "MA ", "01", "234");
const EVIL_EMAIL = j("someone", "@", "example.com");
// Mathematical bold digits: surrogate pairs that NFKC maps to ASCII.
const astral = (s: string) => s.replace(/[0-9]/g, (d) => cp(0x1d7ce + +d));
const fullwidth = (s: string) => s.replace(/[0-9]/g, (d) => cp(0xff10 + +d));
const PHONE_ASTRAL = astral(PHONE);
const PHONE_FULLWIDTH = fullwidth(PHONE);

const KB_URL = "https://vercel.com/docs/botid/get-started";
const OPTS: ScrubOptions = { allowedUrls: [KB_URL] };
const s = (text: string) => scrub(text, OPTS);

describe("exports", () => {
  it("fixes the allowlist prefixes and markers", () => {
    expect(FIXED_ALLOWED_URL_PREFIXES).toEqual([
      "https://www.linkedin.com/in/avanegas95",
      "https://github.com/avanegas95",
      "mailto:avanegas95@gmail.com",
    ]);
    expect(LINK_REMOVED).toBe("[link removed]");
    expect(PII_REMOVED).toBe("[removed]");
  });
});

// [input, a fragment that must not survive]
const mustRemove: ReadonlyArray<readonly [string, string]> = [
  ["https://evil.example/x", "evil"],
  ["www.evil.example", "evil"],
  ["evil.example/login", "evil"],
  ["<https://evil.example>", "evil"],
  ["javascript:alert(1)", "javascript:"],
  ["JavaScript:alert(1)", "alert"],
  ["data:text/html,<b>x</b>", "data:"],
  ["vbscript:msgbox", "vbscript:"],
  [j("tel", ":", AREA, EXCH, LINE), EXCH],
  ["mailto:" + EVIL_EMAIL, "someone"],
  ["github.com/avanegas95x", "avanegas95x"],
  ["https://github.com/avanegas95x", "avanegas95x"],
  ["https://www.linkedin.com/in/avanegas95.evil.com", "evil"],
  ["https://github.com/avanegas95/../../evil", "evil"],
  ["https://github.com/avanegas95%2F..%2Fevil", "evil"],
  ["https://github.com@evil.example/avanegas95", "evil"],
  ["http://evil.example", "evil"],
  ["//evil.example/x", "evil"],
  [EVIL_EMAIL, "someone"],
  [PHONE, LINE],
  [PHONE_PAREN, LINE],
  [PHONE_ASTRAL, astral(LINE)],
  [PHONE_FULLWIDTH, fullwidth(LINE)],
  // P4-15: markdown between the digit groups.
  [j("**", AREA, "**-", EXCH, "-", LINE), LINE],
  [j("_", AREA, "_ ", EXCH, " ", LINE), LINE],
  [j(AREA, "-~~", EXCH, "~~-", LINE), LINE],
  [STREET, "Main"],
  [CITY_ZIP, j("01", "234")],
  ["<script>alert(1)</script>", "<script"],
  ['<img src="x" onerror="y">', "<img"],
  ["<iframe>", "<iframe"],
  ['<a href="https://evil.example">x</a>', "<a"],
  ["[x](javascript:alert(1))", "javascript"],
  ["[x]( https://evil.example )", "evil"],
  // Relative targets: only the fixed same-site list may stay links.
  ["[x](/admin)", "admin"],
  ["[x](//evil.zz)", "evil"],
  ["[x](/\\evil.zz)", "evil"],
  ["[x](/orbithop/../x)", "orbithop"],
  ["[x](/Anderson_Vanegas_Resume.pdf)", "Resume"],
  ["[x](evil.zz/login)", "evil"],
  ["x](evil.zz/login)", "evil"],
  ['[x](evil.zz "t")', "evil"],
  ["![img](https://evil.example/p.png)", "evil"],
  ["<javascript:alert(1)>", "javascript"],
  // Obfuscated hosts and schemes still read as URLs.
  [j("evil", cp(0x200b), ".example/x"), "evil"],
  [j("java", cp(0x200b), "script:alert(1)"), "alert"],
  [j("evil", cp(0xff0e), "example/x"), "evil"],
];

describe("mustRemove", () => {
  for (const [input, gone] of mustRemove) {
    it(`removes ${JSON.stringify(input)}`, () => {
      const out = s(`See ${input} now.`);
      expect(out).not.toContain(gone);
      expect(out.startsWith("See ")).toBe(true);
      expect(out.endsWith(" now.")).toBe(true);
    });
  }

  it("rewrites a disallowed markdown link to its text", () => {
    expect(s("[click](https://evil.example)")).toBe(`click ${LINK_REMOVED}`);
    expect(s("Go [here now](evil.example/x).")).toBe(
      `Go here now ${LINK_REMOVED}.`,
    );
  });

  it("replaces URLs and PII with the markers", () => {
    expect(s("Visit https://evil.example/x.")).toBe(`Visit ${LINK_REMOVED}.`);
    expect(s(`Call ${PHONE} today`)).toBe(`Call ${PII_REMOVED} today`);
    expect(s(`Mail ${EVIL_EMAIL}.`)).toBe(`Mail ${PII_REMOVED}.`);
    expect(s(`At ${STREET}, ${CITY_ZIP}.`)).toBe(
      `At ${PII_REMOVED}, Anytown, ${PII_REMOVED}.`,
    );
  });

  it("drops the < of dangerous tags and keeps the rest as text", () => {
    expect(s("<script>x</script>")).toBe("script>x/script>");
    expect(s("<b>bold</b>")).toBe("<b>bold</b>");
  });

  it("scrubs URLs inside the text of an allowed link", () => {
    const out = s("[https://evil.example](https://github.com/avanegas95)");
    expect(out).toBe(`[${LINK_REMOVED}](https://github.com/avanegas95)`);
  });

  it("removes invisible format characters", () => {
    expect(s(j("a", cp(0x200b), "b", cp(0xfeff), "c"))).toBe("abc");
    const family = j(cp(0x1f469), cp(0x200d), cp(0x1f467));
    expect(s(`hi ${family}`)).toBe(`hi ${family}`);
  });

  it("never allows a non-web scheme, even from allowedUrls", () => {
    const opts = { allowedUrls: ["javascript:alert(1)"] };
    expect(scrub("javascript:alert(1)", opts)).not.toContain("javascript");
  });
});

const mustKeep: readonly string[] = [
  "https://www.linkedin.com/in/avanegas95",
  "https://linkedin.com/in/avanegas95/",
  "https://github.com/avanegas95/portfolio-v3",
  "github.com/avanegas95",
  "mailto:avanegas95@gmail.com",
  "mailto:avanegas95@gmail.com?subject=Hi",
  KB_URL,
  "avanegas95@gmail.com",
  "[GitHub](https://github.com/avanegas95)",
  "<https://github.com/avanegas95>",
  "700+ test cases",
  "2026-10-13",
  "Boston area, MA",
  "WCAG 2.1 AA",
  "e.g.",
  "Node.js",
  "ASP.NET",
  "Astro 7.3.8",
  "README.md",
  "Note: it works; really!",
  "<b>bold</b> & <em>more</em>",
  "Blob says hi 👋",
  "[Top](#home)",
  "[About](#about)",
  "[Experiences](#experiences)",
  "[Projects](#projects)",
  "[Contact](#contact)",
  "[Home](/)",
  "[Blog](/blog/)",
  "[Orbit Hop](/orbithop/)",
  "[Privacy](/privacy/)",
  "[Blob privacy](/blob-privacy/)",
];

describe("mustKeep", () => {
  for (const text of mustKeep) {
    it(`keeps ${JSON.stringify(text)}`, () => {
      expect(s(`Info: ${text} end`)).toBe(`Info: ${text} end`);
    });
  }

  it("keeps trailing punctuation as text after an allowed URL", () => {
    expect(s("See https://github.com/avanegas95.")).toBe(
      "See https://github.com/avanegas95.",
    );
    expect(s("(https://github.com/avanegas95), ok")).toBe(
      "(https://github.com/avanegas95), ok",
    );
  });

  it("allows KB URLs only exactly", () => {
    expect(s(`${KB_URL}/more`)).toBe(LINK_REMOVED);
    expect(s(`${KB_URL}.`)).toBe(`${KB_URL}.`);
  });
});

// --- Streaming -------------------------------------------------------------

// Small seeded PRNG (mulberry32) so failures replay exactly.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cutAt(text: string, cuts: readonly number[]): string[] {
  const points = [...new Set(cuts)]
    .filter((c) => c > 0 && c < text.length)
    .sort((a, b) => a - b);
  const out: string[] = [];
  let last = 0;
  for (const c of points) {
    out.push(text.slice(last, c));
    last = c;
  }
  out.push(text.slice(last));
  return out;
}

function streamed(chunks: readonly string[], opts = OPTS): string {
  const sc = createScrubber(opts);
  return chunks.map((c) => sc.push(c)).join("") + sc.flush();
}

const CORPUS = [
  ...mustRemove.map(([x]) => x),
  ...mustKeep,
  "[click](https://evil.example)",
  `Reach him at avanegas95@gmail.com or ${EVIL_EMAIL}.`,
  `Phones: ${PHONE}, ${PHONE_PAREN}, ${PHONE_ASTRAL}, ${PHONE_FULLWIDTH}.`,
  `Spaced ${[AREA, EXCH, LINE].join("   ")} and split ${j(AREA, "-", EXCH, "-\n", LINE)}`,
  `Mail ${j("someone", "@\n", "example.com")} works.`,
  `Lives at ${STREET}\n${CITY_ZIP}.`,
  "**Bold** and _em_ with [GitHub](https://github.com/avanegas95/portfolio-v3).",
  "A long run without links ".repeat(6),
  "Open [bracket that never closes and keeps going for a while",
  "Unicode: café, naïve, 日本語, emoji 🎉 and ①②③.",
].join(" ");

// Positions strictly inside every URL, email, phone and astral character of
// the corpus: chunk boundaries the property test must hit.
function hardCuts(text: string): number[] {
  const cuts: number[] = [];
  const res = [
    /(?:https?|javascript|data|vbscript|mailto|tel):\S+|www\.\S+|\S+\.example\S*/gi,
    /\S+@\s*\S+/g,
    /[(+]?\d[\d\s().-]{6,}\d/g,
    /[\u{1D7CE}-\u{1D7FF}\u{FF10}-\u{FF19}]+/gu,
    /[\uD800-\uDBFF][\uDC00-\uDFFF]/g,
  ];
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      for (let k = 1; k < m[0].length; k++) cuts.push(m.index + k);
    }
  }
  return cuts;
}

// The property runs are CPU-bound; give slow CI runners room.
describe("streaming invariant", { timeout: 60_000 }, () => {
  const whole = scrub(CORPUS, OPTS);

  it("the corpus scrubs to something safe", () => {
    expect(whole).not.toContain("evil");
    expect(whole).not.toContain(LINE);
    expect(whole).not.toContain("someone");
    expect(whole).toContain("avanegas95@gmail.com");
  });

  it("one-character chunks match scrub()", () => {
    expect(streamed(Array.from(CORPUS))).toBe(whole);
    expect(streamed(CORPUS.split(""))).toBe(whole);
  });

  it("covers splits inside URLs, emails, phones and surrogate pairs", () => {
    const cuts = hardCuts(CORPUS);
    expect(cuts.length).toBeGreaterThan(200);
    // A lone high surrogate at a chunk end is part of the hard cut set.
    const lone = cuts.some((c) => /[\uD800-\uDBFF]/.test(CORPUS.charAt(c - 1)));
    expect(lone).toBe(true);
    for (let k = 0; k < cuts.length; k += 7) {
      const cut = cuts[k] as number;
      expect(streamed(cutAt(CORPUS, [cut]))).toBe(whole);
    }
  });

  it("200 seeded random chunkings match scrub()", () => {
    const hard = hardCuts(CORPUS);
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const cuts: number[] = [];
      const mean = 1 + Math.floor(r() * 40);
      for (let at = 0; at < CORPUS.length; at += 1 + Math.floor(r() * mean)) {
        cuts.push(at);
      }
      for (let n = 0; n < 20; n++) {
        cuts.push(hard[Math.floor(r() * hard.length)] as number);
      }
      const chunks = cutAt(CORPUS, cuts);
      expect(chunks.join("")).toBe(CORPUS);
      expect(streamed(chunks), `seed ${seed}`).toBe(whole);
    }
  });

  it("random chunkings of random mixes match scrub()", () => {
    const parts = CORPUS.split(" ");
    for (let seed = 1000; seed < 1100; seed++) {
      const r = rng(seed);
      const pick = () => parts[Math.floor(r() * parts.length)] as string;
      const seps = [" ", "\n", "  ", ""];
      let text = "";
      for (let n = 0; n < 40; n++) {
        text += pick() + (seps[Math.floor(r() * seps.length)] as string);
      }
      const cuts: number[] = [];
      for (let n = 0; n < 30; n++) cuts.push(Math.floor(r() * text.length));
      expect(streamed(cutAt(text, cuts)), `seed ${seed}`).toBe(
        scrub(text, OPTS),
      );
    }
  });

  it("a URL split across five chunks is still removed", () => {
    const chunks = ["Go to ht", "tps://ev", "il.exam", "ple/lo", "gin now"];
    const out = streamed(chunks);
    expect(out).toBe(`Go to ${LINK_REMOVED} now`);
    expect(out).toBe(scrub(chunks.join(""), OPTS));
  });

  it("a phone split as 617-5 + 55-0123 is removed", () => {
    const chunks = [j("Call ", AREA, "-5"), j("5", "5-", LINE, " please")];
    expect(chunks.join("")).toBe(`Call ${PHONE} please`);
    expect(streamed(chunks)).toBe(`Call ${PII_REMOVED} please`);
  });

  it("never emits a partial phone before it can be judged", () => {
    const sc = createScrubber(OPTS);
    let out = sc.push(j("Some words first. Call ", AREA, " "));
    out += sc.push(`${EXCH} `);
    expect(out).not.toContain(AREA);
    out += sc.push(`${LINE} and then a lot more ordinary words follow here`);
    out += sc.flush();
    expect(out).not.toContain(AREA);
    expect(out).toContain(PII_REMOVED);
  });

  it("emits settled text before flush and holds back the tail", () => {
    const sc = createScrubber(OPTS);
    const text = "Anderson is a Staff SQA Engineer who builds test suites. ";
    let early = "";
    for (let n = 0; n < 6; n++) early += sc.push(text);
    expect(early.length).toBeGreaterThan(0);
    expect(text.repeat(6).startsWith(early)).toBe(true);
    expect(early + sc.flush()).toBe(text.repeat(6));
  });

  it("padding a phone with spaces or zero-width characters does not hide it", () => {
    const zw = cp(0x200b).repeat(150);
    const pads = [
      j("(", " ".repeat(150), AREA, ") ", EXCH, "-", LINE),
      j(AREA, " ", EXCH, zw, "-", LINE),
      j(AREA, " ", EXCH, "<b></b>".repeat(40), "-", LINE),
    ];
    for (const p of pads) {
      const text = `Words before. ${p} words after it.`;
      const out = scrub(text, OPTS);
      expect(out).not.toContain(LINE);
      expect(out).not.toContain(EXCH);
      expect(streamed(Array.from(text))).toBe(out);
    }
  });

  it("is reusable after flush and handles empty input", () => {
    const sc = createScrubber(OPTS);
    expect(sc.push("")).toBe("");
    expect(sc.flush()).toBe("");
    expect(sc.push("hello ")).toBe("");
    expect(sc.flush()).toBe("hello ");
    expect(scrub("", OPTS)).toBe("");
  });
});

// --- Adversarial padding (review round 1) ----------------------------------

const RULES: readonly PiiRule[] = ["phone", "street-address", "zip", "email"];
const ZW = cp(0x200b);
const PARTY = cp(0x1f389);
const TAIL =
  " and then more words follow, plenty of them to fill the window up nicely today.";

describe("padding cannot split a value across a commit point", () => {
  const x150 = "x".repeat(150);
  const leaks = [
    j(AREA, "-", EXCH, '-<span class="a ', x150, " ", x150, '">', LINE),
    j(AREA, "-", EXCH, "-<x ", "&nbsp; ".repeat(100), ">", LINE),
    // The same 80 "ab " as before P2-12, now in tags that close within 64
    // units, so they stay markup.
    j(AREA, "-", EXCH, "-", `<x ${"ab ".repeat(20)}>`.repeat(4), LINE),
    j(AREA, " ", EXCH, "-<i ", `${ZW} `.repeat(90), ">", LINE),
    j("12", "3 ", "A", "a".repeat(300), " Street"),
    j("someone", "@\n", "x".repeat(300), ".example.com"),
  ];
  for (const [n, value] of leaks.entries()) {
    it(`removes padded value #${n}`, () => {
      const text = `Some opening words here. ${value}${TAIL}`;
      const out = scrub(text, OPTS);
      expect(piiSpans(out, RULES)).toEqual([]);
      expect(out).not.toContain(LINE);
      expect(out).toContain(PII_REMOVED);
      expect(streamed(Array.from(text))).toBe(out);
    });
  }

  it("leaves nothing to find when word padding follows a stray <", () => {
    // P2-12: this "<" has no ">" within 64 units, so it is emitted as U+FF1C
    // and the padding is plain text: the halves are no longer one value.
    const value = j(AREA, "-", EXCH, "-<x ", "ab ".repeat(80), ">", LINE);
    const text = `Some opening words here. ${value}${TAIL}`;
    const out = scrub(text, OPTS);
    expect(piiSpans(out, RULES)).toEqual([]);
    expect(out).not.toContain("<x");
    expect(out).toContain(`${cp(0xff1c)}x`);
    expect(streamed(Array.from(text))).toBe(out);
  });

  it("piiSpans(scrub(x)) is empty for a seeded adversarial corpus", () => {
    const r = rng(4242);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
    const values: ReadonlyArray<readonly [string, string]> = [
      [j(AREA, "-", EXCH, "-"), LINE],
      [j(AREA, " ", EXCH, " "), LINE],
      [j("(", AREA, ") "), j(EXCH, "-", LINE)],
      [j("12", "3 Main "), "Street"],
      ["Anytown, MA ", j("01", "234")],
      [j("someone", "@"), "example.com"],
    ];
    const fillers = [
      () => "x".repeat(20 + Math.floor(r() * 200)),
      () => "ab ".repeat(10 + Math.floor(r() * 80)),
      () => "&nbsp; ".repeat(5 + Math.floor(r() * 60)),
      () => `${ZW} `.repeat(5 + Math.floor(r() * 60)),
      () => "!? ;: ".repeat(5 + Math.floor(r() * 40)),
      () => `${PARTY} `.repeat(5 + Math.floor(r() * 60)),
      () => `W${"o".repeat(50 + Math.floor(r() * 300))} `,
    ];
    const pads = [
      () => `<span class="${pick(fillers)()}">`,
      () => `<x ${pick(fillers)()}>`,
      () => ZW.repeat(10 + Math.floor(r() * 300)),
      () => "<b></b>".repeat(5 + Math.floor(r() * 60)),
      () => "",
    ];
    const prose = [
      "Anderson leads QA",
      "for mobile and web,",
      "with 700+ test cases",
      PARTY,
      "and loves clean pipelines.",
      "Long" + "g".repeat(120),
      "e.g.",
    ];
    const words = (k: number) =>
      Array.from({ length: k }, () => pick(prose)).join(" ");
    for (let n = 0; n < 150; n++) {
      const [left, right] = pick(values);
      const head = words(3 + Math.floor(r() * 10));
      const tail = words(3 + Math.floor(r() * 20));
      const text = `${head} ${left}${pick(pads)()}${right} ${tail}`;
      const out = scrub(text, OPTS);
      expect(piiSpans(out, RULES), `case ${n}: ${text}`).toEqual([]);
      if (n % 10 === 0) {
        const cuts = Array.from({ length: 25 }, () =>
          Math.floor(r() * text.length),
        );
        expect(streamed(cutAt(text, cuts)), `case ${n}`).toBe(out);
      }
    }
  }, 60_000); // 150 adversarial cases took 6.4 s under load; leave generous headroom.
});

describe("markdown link targets", () => {
  it("removes a target whose [ is far away or padded", () => {
    const padded = j("[", `a${ZW}`.repeat(130), " b](evil.zz/login)");
    const wide = j("[", "w ".repeat(140), "](evil.zz/login)");
    for (const link of [padded, wide]) {
      const text = `Intro words here. ${link}${TAIL}`;
      const out = scrub(text, OPTS);
      expect(out).not.toContain("evil");
      expect(out).toContain(LINK_REMOVED);
      expect(streamed(Array.from(text))).toBe(out);
    }
  });

  it("does not split a short link's text across segments", () => {
    // Kills the open-link guard: without it, a commit point inside the link
    // text leaves the "[" behind in an earlier segment.
    const before = "Anderson writes clear test plans for every release ";
    const link = "[see the full write up here](https://evil.example)";
    const text = `${before}${link}${TAIL.repeat(3)}`;
    const out = scrub(text, OPTS);
    expect(out).toBe(
      `${before}see the full write up here ${LINK_REMOVED}${TAIL.repeat(3)}`,
    );
    expect(streamed(Array.from(text))).toBe(out);
  });
});

describe("holdback", () => {
  // P2-12: an unclosed "<" no longer holds (it is a stray after 64 units), so
  // these use an entity run, which still blocks every commit point.
  it("withholds a region with no commit point until flush", () => {
    const parts = [
      "Hello there, this is fine. &nbsp; span",
      " &nbsp;".repeat(3000),
      ` ${LINE}${TAIL}`,
    ];
    const sc = createScrubber(OPTS);
    const early = parts.map((p) => sc.push(p));
    expect(early.join("")).not.toContain("span");
    expect(early.join("") + sc.flush()).toBe(scrub(parts.join(""), OPTS));
  });

  it("stops emitting past the hold cap until flush", () => {
    // An entity run blocks every commit point; once the held region passes
    // the cap, even the text after the run waits for flush().
    const parts = [
      `Start of reply here. &nbsp;${" &nbsp;".repeat(1200)}`,
      TAIL.repeat(20),
    ];
    const sc = createScrubber(OPTS);
    const early = parts.map((p) => sc.push(p));
    expect(early[1]).toBe("");
    expect(early.join("") + sc.flush()).toBe(scrub(parts.join(""), OPTS));
  });
});

// Scaling, not wall-clock: absolute thresholds flake under parallel workers.
// 32x the input should cost about 32x (linear); quadratic work costs ~1000x.
describe("performance", { timeout: 60_000 }, () => {
  // Each run is n code units. The opening words put a commit candidate in
  // front of the run, so its lookahead window stays pending all the way.
  const runs: ReadonlyArray<readonly [string, (n: number) => string]> = [
    ["zero-width", (n) => ZW.repeat(n)],
    ["punctuation", (n) => "! ? ".repeat(n / 4)],
    ["spaced emoji", (n) => `${PARTY} `.repeat(Math.round(n / 3))],
    ["emoji", (n) => PARTY.repeat(n / 2)],
    ["short tags", (n) => "<b>x</b> ".repeat(Math.round(n / 9))],
    // P4-15: bare hosts under any TLD, and one long dotted word.
    ["bare hosts", (n) => "evil.zz ".repeat(n / 8)],
    ["dotted word", (n) => "a.".repeat(n / 2)],
    ["hyphenated labels", (n) => "a-b.c-d.".repeat(n / 8)],
    // P4-15: markdown around digits takes the emphasis-free PII pass.
    ["bold digits", (n) => "**12** ".repeat(Math.round(n / 7))],
  ];
  const HEAD = "Anderson builds test suites that catch bugs early. ";

  // One pass in 1-char chunks; returns ms and checks the output.
  function pass(text: string): number {
    const sc = createScrubber(OPTS);
    const t0 = performance.now();
    let out = "";
    for (let i = 0; i < text.length; i++) out += sc.push(text.charAt(i));
    out += sc.flush();
    const ms = performance.now() - t0;
    expect(out.endsWith(" the end.")).toBe(true);
    return ms;
  }

  for (const [name, run] of runs) {
    it(`a ${name} run in 1-char chunks scales linearly (2 KB vs 64 KB)`, () => {
      const small = `${HEAD}${run(2_000)} the end.`;
      const large = `${HEAD}${run(64_000)} the end.`;
      pass(small); // warm-up
      pass(large);
      // Interleaved samples see the same load; the fastest of each is the
      // least disturbed by other workers (noise only ever adds time). A small
      // sample is 32 passes, the same work as one large pass.
      let fastSmall = Infinity;
      let fastLarge = Infinity;
      for (let k = 0; k < 7; k++) {
        let ms = 0;
        for (let r = 0; r < 32; r++) ms += pass(small);
        fastSmall = Math.min(fastSmall, ms / 32);
        fastLarge = Math.min(fastLarge, pass(large));
      }
      const ratio = fastLarge / Math.max(fastSmall, 0.01);
      // Linear is ~32x; short tags measure ~26x (a second piiSpans pass over
      // windows containing "<"). Quadratic would be ~1000x.
      expect(ratio, `${name}: ${fastSmall}ms vs ${fastLarge}ms`).toBeLessThan(
        100,
      );
      expect(fastLarge).toBeLessThan(2_000); // backstop
    });
  }
});

// --- P2-12: stray "<", reference links, single-source allowlist ------------

const LT = cp(0xff1c);

describe("stray <", () => {
  it("emits a < with no > in the next 64 units as U+FF1C", () => {
    expect(s("I <3 testing")).toBe(`I ${LT}3 testing`);
    expect(s("stay < 25 KB")).toBe(`stay ${LT} 25 KB`);
    expect(s("a <")).toBe(`a ${LT}`);
    // The > is the 65th unit after the <: too far.
    expect(s(`<${"b".repeat(64)}>`)).toBe(`${LT}${"b".repeat(64)}>`);
    // The > is the 64th unit after it: markup, kept as it is.
    expect(s(`<${"b".repeat(63)}>`)).toBe(`<${"b".repeat(63)}>`);
    // The end of the line comes first.
    expect(s("a <b\n> c")).toBe(`a ${LT}b\n> c`);
    expect(s("a <b\r\n> c")).toBe(`a ${LT}b\r\n> c`);
  });

  it("still drops the < of a dangerous tag", () => {
    expect(s("<script x")).toBe("script x");
  });

  it("streams prose after a stray < without holding it to the end", () => {
    const prose = "Anderson builds reliable test suites for mobile and web. ";
    let text = "I <3 testing. ";
    while (text.length < 750) text += prose;
    const sc = createScrubber(OPTS);
    let pushed = 0;
    let out = "";
    let maxHeld = 0;
    for (let i = 0; i < text.length; i += 4) {
      const chunk = text.slice(i, i + 4);
      pushed += chunk.length;
      out += sc.push(chunk);
      maxHeld = Math.max(maxHeld, pushed - out.length);
    }
    out += sc.flush();
    expect(maxHeld).toBeLessThanOrEqual(200);
    expect(out).toBe(scrub(text, OPTS));
    expect(out).toBe(text.replace("<", LT));
  });

  it("chunking around the 64-unit decision matches scrub()", () => {
    const texts = [
      `Words first here. <${"b".repeat(63)}> and after it, more words come.`,
      `Words first here. <${"b".repeat(64)}> and after it, more words come.`,
      `Words <x\n${"y ".repeat(40)}> end of it all now.`,
      "Ends with a stray <",
      "Many <<<< strays < and <b>tags</b> < mixed < in here > ok.",
    ];
    for (const text of texts) {
      const whole = scrub(text, OPTS);
      expect(streamed(Array.from(text))).toBe(whole);
      for (let c = 1; c < text.length; c += 3) {
        expect(streamed(cutAt(text, [c]))).toBe(whole);
      }
    }
  });

  it("a stray < padded with 2 KB before a phone leaves nothing to find", () => {
    const pads = [
      `<span class="${"x ".repeat(1000)}">`,
      `<x ${"ab ".repeat(700)}>`,
      `<i ${`${ZW} `.repeat(1000)}>`,
      `<x ${"w".repeat(2048)}>`,
    ];
    const values = [
      [j(AREA, "-", EXCH, "-"), LINE],
      [j(AREA, " ", EXCH, " "), LINE],
      [j("someone", "@"), "example.com"],
    ] as const;
    for (const pad of pads) {
      for (const [left, right] of values) {
        const text = `Some opening words here. ${left}${pad}${right}${TAIL}`;
        const out = scrub(text, OPTS);
        expect(piiSpans(out, RULES)).toEqual([]);
        expect(out).not.toMatch(/<(?:span|x|i) /);
        expect(streamed(cutAt(text, [40, 300, 1500, 2050]))).toBe(out);
      }
    }
  });
});

// [definition, a fragment that must not survive]
const refRemove: ReadonlyArray<readonly [string, string]> = [
  ["[1]: //evil.zz/x", "evil"],
  ["[1]: evil.zz/x", "evil"],
  ["[a]: <evil.zz>", "evil"],
  ["[a]:evil.zz", "evil"],
  ['[a]: evil.zz "Title"', "evil"],
  ["[a]:\n   evil.zz/x", "evil"],
  ["   [a]: https://evil.example/x", "evil"],
  ["[a]: javascript:alert(1)", "javascript"],
  ["[a]: /admin", "admin"],
  ["[a]: <>", "<>"],
  ["[a]: https://github.com/avanegas95x", "avanegas95x"],
  ["[a]: <evil.zz/a b>", "evil"],
];

const refKeep: readonly string[] = [
  "[gh]: https://github.com/avanegas95",
  "[gh]: <https://github.com/avanegas95/portfolio-v3>",
  "[in]: https://www.linkedin.com/in/avanegas95",
  "[m]: mailto:avanegas95@gmail.com",
  "[c]: #contact",
  "[o]: /orbithop/",
  `[kb]: ${KB_URL}`,
];

describe("reference-style link definitions", () => {
  for (const [def, gone] of refRemove) {
    it(`removes the target of ${JSON.stringify(def)}`, () => {
      const text = `Intro line.\n${def}\nAnd a closing line.`;
      const out = s(text);
      expect(out).not.toContain(gone);
      expect(out).toContain(LINK_REMOVED);
      expect(out.startsWith("Intro line.\n")).toBe(true);
      expect(out.endsWith("\nAnd a closing line.")).toBe(true);
      expect(streamed(Array.from(text))).toBe(out);
    });
  }

  for (const def of refKeep) {
    it(`keeps ${JSON.stringify(def)}`, () => {
      // A blank line after it: piiSpans joins an email to the next line.
      const text = `Intro line.\n${def}\n\nAnd a closing line.`;
      expect(s(text)).toBe(text);
    });
  }

  it("keeps a far-away target with its definition", () => {
    const before =
      "Anderson writes clear test plans for every single release. ";
    for (const gap of [" ", " ".repeat(80), `\n${" ".repeat(40)}`]) {
      const text = `${before.repeat(3)}\n[1]:${gap}evil.zz/login${TAIL.repeat(3)}`;
      const out = scrub(text, OPTS);
      expect(out).not.toContain("evil");
      expect(out).toContain(LINK_REMOVED);
      expect(streamed(Array.from(text))).toBe(out);
    }
  });
});

describe("allowlist parity with the prompt", () => {
  const kb = buildKb(loadKbSources());
  const kbUrls = extractKbUrls(kb);
  const opts: ScrubOptions = { allowedUrls: kbUrls };
  const prompt = buildSystemPrompt(kb);
  const keep = (x: string) => scrub(`Info:\n${x}\nend`, opts);

  it("the contact prefixes are the knowledge base's links", () => {
    expect(kbUrls.length).toBeGreaterThan(0);
    expect([...FIXED_ALLOWED_URL_PREFIXES].sort()).toEqual(kbUrls);
  });

  it("every link the prompt allows survives scrub()", () => {
    for (const url of kbUrls) {
      expect(prompt).toContain(url);
      for (const x of [url, `[x](${url})`, `<${url}>`, `[x]: ${url}`]) {
        expect(keep(x)).toBe(`Info:\n${x}\nend`);
        // Also when the caller passes no KB URLs: the prefixes cover them.
        expect(scrub(x, { allowedUrls: [] })).toBe(x);
      }
    }
    for (const path of ALLOWED_SITE_PATHS) {
      expect(prompt).toContain(`\`${path}\``);
      for (const x of [`[x](${path})`, `[x]: ${path}`]) {
        expect(keep(x)).toBe(`Info:\n${x}\nend`);
      }
    }
  });

  it("nothing else does", () => {
    const others = [
      ...ALLOWED_SITE_PATHS.flatMap((p) => [`${p}x`, `${p}/..`, `.${p}`]),
      "/orbithop",
      "/privacy",
      "/api/chat",
      "#top",
      "/Anderson_Vanegas_Resume.pdf",
      ...kbUrls.flatMap((u) => [`${u}x`, `${u}.evil.zz`, `${u}@evil.zz`]),
      "https://example.com/",
      "mailto:someone@example.com",
    ];
    for (const target of others) {
      for (const x of [`[x](${target})`, `[x]: ${target}`]) {
        const out = keep(x);
        // A PII match inside the target wins over the link marker.
        expect(out, x).toMatch(/\[(?:link )?removed\]/);
        expect(out, x).not.toContain(target);
      }
    }
  });
});

// --- P5-03b: v1 same-site allowlist ----------------------------------------

describe("v1 same-site allowlist", () => {
  it("is exactly v1's section anchors and pages", () => {
    expect([...ALLOWED_SITE_PATHS]).toEqual([
      "#home",
      "#about",
      "#experiences",
      "#projects",
      "#contact",
      "/",
      "/blog/",
      "/orbithop/",
      "/privacy/",
      "/blob-privacy/",
    ]);
  });

  for (const path of ["#experiences", "/blob-privacy/"]) {
    it(`keeps ${path}`, () => {
      for (const x of [`[x](${path})`, `[x]: ${path}`]) {
        expect(scrub(x, OPTS)).toBe(x);
      }
    });
  }

  for (const path of [
    "#experience",
    "#skills",
    "/Anderson_Vanegas_Resume.pdf",
  ]) {
    it(`strips ${path}`, () => {
      for (const x of [`[x](${path})`, `[x]: ${path}`]) {
        const out = scrub(x, OPTS);
        expect(out, x).toContain(LINK_REMOVED);
        expect(out, x).not.toContain(path);
      }
    });
  }
});

// --- P2-12 review round 1 ----------------------------------------------------

// A tag that closes within 64 units: "<x " + 57 units + ">" (the ">" is the
// 60th unit after the "<").
const TAG61 = `<x ${"ab ".repeat(19)}>`;

describe("phones padded with tags that stay markup", () => {
  for (const n of [1, 50, 100]) {
    it(`removes a phone split by ${n} short tag(s)`, () => {
      const value = j(AREA, "-", EXCH, "-", TAG61.repeat(n), LINE);
      const text = `Some opening words here. ${value}${TAIL}`;
      const out = scrub(text, OPTS);
      expect(out).toContain(PII_REMOVED);
      expect(out).not.toContain(LINE);
      expect(piiSpans(out, RULES)).toEqual([]);
      expect(streamed(cutAt(text, [30, 31, 90, 700, 3001]))).toBe(out);
    });
  }

  it("holds chained short tags past the cap until flush", () => {
    const parts = [`Start of reply here. ${TAG61.repeat(80)}`, TAIL.repeat(10)];
    const sc = createScrubber(OPTS);
    const early = parts.map((p) => sc.push(p));
    expect(early.join("")).toBe("");
    expect(early.join("") + sc.flush()).toBe(scrub(parts.join(""), OPTS));
  });
});

describe("PII is judged on the text as emitted", () => {
  const cases = [
    // The stray "<3" becomes U+FF1C; the tag after it is then a plain tag.
    `I <3 x ${j(AREA, "-", EXCH, "-")}${TAG61}${LINE}`,
    // A removed autolink takes a "<" and a ">" out of a tag.
    j(AREA, "-", EXCH, "-<x ab <https://evil.example> cd>", LINE),
    // A dropped "<" of a dangerous tag.
    j(AREA, "-", EXCH, "-<x <a>", LINE),
    // "<3 617-555-<b>": the innermost tag.
    `I <3 ${j(AREA, "-", EXCH, "-<b>", LINE)}`,
  ];
  for (const [n, value] of cases.entries()) {
    it(`leaves nothing to find (#${n})`, () => {
      const text = `Some opening words here. ${value}${TAIL}`;
      const out = scrub(text, OPTS);
      expect(piiSpans(out, RULES)).toEqual([]);
      expect(out).not.toContain(LINE);
      expect(out).toContain(PII_REMOVED);
      expect(streamed(Array.from(text))).toBe(out);
    });
  }
});

describe("contact replies", () => {
  const mail = j("avanegas95", "@", "gmail.com");
  const replies = [
    `Email: ${mail}\nLinkedIn: https://www.linkedin.com/in/avanegas95`,
    `You can reach him at ${mail}\nThanks for asking!`,
    `Write to ${mail}.\nHe usually answers within a day or two.`,
    `- Email: [${mail}](mailto:${mail})\n- GitHub: [github.com/avanegas95](https://github.com/avanegas95)`,
  ];
  for (const [n, text] of replies.entries()) {
    it(`keeps reply #${n} as it is`, () => {
      expect(scrub(text, OPTS)).toBe(text);
      expect(streamed(Array.from(text))).toBe(text);
    });
  }
});

describe("reference definitions start a line", () => {
  it("keeps a mid-line label followed by a colon", () => {
    for (const text of [
      "He tests with the tools [below]: Playwright, Cypress and Appium.",
      // A definition would remove "evil"; mid-line it is plain text.
      "See [1]: evil for nothing",
    ]) {
      expect(s(text)).toBe(text);
    }
    // A bare host there is still removed, as a host (P4-15).
    expect(s("See [1]: evil.zz for nothing")).toBe(
      `See [1]: ${LINK_REMOVED} for nothing`,
    );
  });

  it("checks a definition after list or blockquote markers", () => {
    for (const head of ["- ", "* ", "1. ", "2) ", "> ", "> - ", "    "]) {
      const text = `Intro line.\n${head}[a]: evil.zz/x\nAnd a closing line.`;
      const out = s(text);
      expect(out, head).not.toContain("evil");
      expect(out, head).toContain(LINK_REMOVED);
    }
  });

  it("checks a label that spans a line break", () => {
    const text = `Intro line.\n[a\nb]: evil.zz/x\nAnd a closing line.`;
    expect(s(text)).not.toContain("evil");
  });
});

// --- P4-15 / S-02 (F-OUT-1): a bare host under any TLD is a link ------------

describe("bare hosts under any TLD", () => {
  const hosts = [
    "evil.zip",
    "evil.click",
    "evil.ru",
    "phish.top",
    "evil.zz/login",
    "EVIL.ZZ",
    "Evil.Top/login?x=1",
    "sub.evil.co.uk",
    "evil.zz:8080/x",
    "evil.xn--p1ai",
    "xn--80ak6aa92e.xn--p1ai/x",
    "evil.photography",
  ];

  it.each(hosts)("removes %j", (host) => {
    expect(s(`Go to ${host} now.`)).toBe(`Go to ${LINK_REMOVED} now.`);
  });

  it.each(hosts)("removes %j in every chunking", (host) => {
    const text = `Go to ${host} now.`;
    const whole = s(text);
    expect(streamed(Array.from(text))).toBe(whole);
    for (let at = 1; at < text.length; at++) {
      expect(streamed(cutAt(text, [at]))).toBe(whole);
    }
  });

  it.each([
    ["evil.c", "om"],
    ["Evil.C", "oM"],
    ["evil.", "zz/login"],
    ["ev", "il.zip"],
  ])("removes a host split across chunks: %j + %j", (a, b) => {
    expect(streamed([`Visit ${a}`, `${b} today.`])).toBe(
      `Visit ${LINK_REMOVED} today.`,
    );
  });

  it.each([
    "Node.js",
    "Vue.js",
    "next.config.ts",
    "package.json",
    "config.yaml",
    "README.md",
    "ASP.NET",
    "e.g.",
    "i.e.",
    "U.S.",
    "Ph.D.",
    "v2.0",
    "3.14",
    "Astro 7.3.8",
  ])("keeps the non-host %j", (text) => {
    expect(s(`Info: ${text} end`)).toBe(`Info: ${text} end`);
  });

  it("a file-like name with a path is still treated as a host", () => {
    expect(s("see evil.json/login now")).toBe(`see ${LINK_REMOVED} now`);
  });

  it("the knowledge base's own links survive with no allowlist passed", () => {
    const kbUrls = extractKbUrls(buildKb(loadKbSources()));
    expect(kbUrls.length).toBeGreaterThan(0);
    for (const url of kbUrls) {
      const bare = url.replace(/^https:\/\//, "");
      for (const x of [url, bare]) {
        expect(scrub(`See ${x} for more.`, { allowedUrls: [] })).toBe(
          `See ${x} for more.`,
        );
      }
    }
  });
});
