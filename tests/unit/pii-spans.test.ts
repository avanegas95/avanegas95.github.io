import { describe, expect, it } from "vitest";
import {
  mask,
  piiSpans,
  scanText,
  type PiiRule,
  type PiiSpan,
} from "../../src/lib/pii.ts";

// The P1 corpus from pii.test.ts, rebuilt the same way: every sample is
// assembled at runtime from fragments (CLAUDE.md rule 2), using the
// fictional 555-01xx range and made-up streets.
const j = (...parts: string[]) => parts.join("");
const AREA = "617";
const EXCH = "555";
const LINE = j("01", "23");
const PH = [AREA, EXCH, LINE];
const cp = (n: number) => String.fromCodePoint(n);
const digitsIn = (s: string, base: number) =>
  s.replace(/[0-9]/g, (d) => cp(base + Number(d)));
const ZIP5 = j("01", "234");
const STREET = ["12" + "3", "Example", "St"];

const mustFind: ReadonlyArray<readonly [string, PiiRule]> = [
  [[AREA, EXCH, LINE].join("-"), "phone"],
  [j("(", AREA, ") ", EXCH, "-", LINE), "phone"],
  [[AREA, EXCH, LINE].join("."), "phone"],
  [j("+1 ", [AREA, EXCH, LINE].join(" ")), "phone"],
  [j(AREA, EXCH, LINE), "phone"],
  [j("tel", ":+1", AREA, EXCH, LINE), "phone"],
  [j("+1-", [AREA, EXCH, LINE].join("-")), "phone"],
  [j("tel", ":", EXCH, LINE), "phone"],
  [PH.join(cp(0xa0)), "phone"],
  [PH.join(cp(0x2011)), "phone"],
  [PH.join(cp(0x2013)), "phone"],
  [PH.join(cp(0x2014)), "phone"],
  [PH.join(cp(0x2212)), "phone"],
  [digitsIn(PH.join("-"), 0xff10), "phone"],
  [digitsIn(PH.join("-"), 0x0660), "phone"],
  [PH.join("  "), "phone"],
  [PH.join(" - "), "phone"],
  [PH.join(cp(0x200b)), "phone"],
  [j("(", AREA, ")", cp(0xa0), EXCH, cp(0x2013), LINE), "phone"],
  [j("<span>", AREA, "</span>-", EXCH, "-", LINE), "phone"],
  [PH.join("&#45;"), "phone"],
  [PH.join("&#x2d;"), "phone"],
  [PH.join("&nbsp;"), "phone"],
  [j("someone", "&#64;", "example.com"), "email"],
  [j("<span>someone</span>", "@", "example.com"), "email"],
  [j("Email <a>evil", "avanegas95", "@gmail.com</a>"), "email"],
  [
    j("<li>", STREET[0] as string, "</li><li>Example St</li>"),
    "street-address",
  ],
  [j("MA", "&nbsp;", ZIP5), "zip"],
  [j(AREA, "-", EXCH, "-\n", LINE), "phone"],
  [j(AREA, " ", EXCH, "\n", LINE), "phone"],
  [j(STREET[0] as string, " Example\nStreet"), "street-address"],
  [j("someone", "@\n", "example.com"), "email"],
  [j("Anytown, MA\n", ZIP5), "zip"],
  [j("Lorem\n", "ipsum"), "placeholder"],
  [j("12", "3 Main ", "Street"), "street-address"],
  [STREET.join(cp(0xa0)), "street-address"],
  [STREET.join("  "), "street-address"],
  [j("sui", "te 400"), "street-address"],
  [j("ap", "t 4"), "street-address"],
  [j("St", "e 210"), "street-address"],
  [j("Post Office ", "Box 9"), "street-address"],
  [j("12", "3 Example ", "St"), "street-address"],
  [j("4", "5 Elm ", "St."), "street-address"],
  [j("9 Old ", "Mill ", "Road"), "street-address"],
  [j("1", "0 Harbor ", "Way"), "street-address"],
  [j("P", "O Box ", "12"), "street-address"],
  [j("P.", "O. Box ", "7"), "street-address"],
  [j("Sui", "te ", "400"), "street-address"],
  [j("Ap", "t #", "4"), "street-address"],
  [j("Anytown, ", "MA ", "01", "234"), "zip"],
  [j("Anytown, ", "MA ", "01", "234-", "5678"), "zip"],
  [j("MA", cp(0xa0), ZIP5), "zip"],
  [j("MA, ", ZIP5), "zip"],
  [j("MA  ", ZIP5), "zip"],
  [j("MA ", ZIP5, cp(0x2013), "5678"), "zip"],
  [j("MA ", digitsIn(ZIP5, 0xff10)), "zip"],
  [j("someone", "@", "example.com"), "email"],
  [j("Someone.Else", "@", "Example.org"), "email"],
  [j("linkedin.com/in/", "andersonvanegas"), "contact-url"],
  [j("https://www.", "linkedin.com/in/", "andersonvanegas"), "contact-url"],
  [j("github.com/", "someoneelse"), "contact-url"],
  [j("linkedin.com/in/", "avanegas95x"), "contact-url"],
  [j("github.com/", "avanegas95-alt"), "contact-url"],
  [j("instagram", ".com/x"), "contact-url"],
  [j("https://", "x.com/someone"), "contact-url"],
  [j("twitter", ".com/someone"), "contact-url"],
  [j("facebook", ".com/someone"), "contact-url"],
  [j("tiktok", ".com/@someone"), "contact-url"],
  [j("https://", "wa.me/", "15550100"), "contact-url"],
  [j("t", ".me/someone"), "contact-url"],
  [j("TO", "DO: x"), "placeholder"],
  [j("tb", "d"), "placeholder"],
  [j("FIX", "ME later"), "placeholder"],
  [j("[A", "DD LINK]"), "placeholder"],
  [j("Place", "holder copy"), "placeholder"],
  [j("Lorem ", "ipsum dolor"), "placeholder"],
];

const mustNotFind: readonly string[] = [
  "pub-2112756252403033",
  "2026-10-13",
  "May 2017",
  "16 to 33 automated tests",
  "700+ test cases",
  "React 18, Vite 6",
  "WCAG 2.1 AA",
  "~50 KB",
  "Lighthouse ≥ 0.95",
  "Astro 7.3.8",
  "17 content variants",
  "Boston area, MA",
  "Boston Dynamics",
  "the Appium suite grew to 33 tests",
  "mailto:avanegas95@gmail.com?subject=Hi",
  "https://www.linkedin.com/in/avanegas95",
  "https://www.linkedin.com/in/avanegas95/",
  "https://github.com/avanegas95/portfolio-v3",
  "github.com/avanegas95",
  "AVANEGAS95@GMAIL.COM",
  "avanegas95.github.io",
  "today",
  "Hotel: downtown",
  "things to\ndo more",
  "a test\nsuite grew",
  "Unit tests run in CI",
  "<p>2026</p><p>10</p>",
  "&amp; &lt;b&gt;",
  '<strong>Email</strong> <a href="mailto:avanegas95@gmail.com">avanegas95@gmail.com</a>',
  "unit tests",
  "the test suite",
];

const lineOf = (text: string, at: number) =>
  text.slice(0, at).split(/\r\n?|\n/).length;

const covers = (text: string, s: PiiSpan, line: number) =>
  lineOf(text, s.start) <= line && line <= lineOf(text, s.end - 1);

describe("piiSpans agrees with scanText (mustFind)", () => {
  for (const [sample, rule] of mustFind) {
    it(`spans every finding for ${mask(sample)} (${rule})`, () => {
      const text = `Context: ${sample} end.`;
      const findings = scanText(text, "f.md");
      expect(findings.map((f) => f.rule)).toContain(rule);
      for (const f of findings) {
        const spans = piiSpans(text, [f.rule]);
        expect(spans.some((s) => covers(text, s, f.line))).toBe(true);
        for (const s of spans) expect(s.rule).toBe(f.rule);
      }
      // Same rule set both ways: no rule fires in one and not the other.
      const ruleSet = new Set(findings.map((f) => f.rule));
      for (const r of ruleSet) {
        expect(piiSpans(text, [r]).length).toBeGreaterThan(0);
      }
    });
  }

  it("a span sits on the sample, not on the context words", () => {
    const sample = PH.join("-");
    const text = `Call ${sample} today.`;
    const spans = piiSpans(text);
    expect(spans).toEqual([
      { start: 5, end: 5 + sample.length, rule: "phone" },
    ]);
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe(sample);
  });
});

describe("piiSpans agrees with scanText (mustNotFind)", () => {
  for (const sample of mustNotFind) {
    it(`finds nothing in ${JSON.stringify(sample)}`, () => {
      expect(scanText(sample, "f.md")).toEqual([]);
      expect(piiSpans(sample)).toEqual([]);
    });
  }
});

describe("piiSpans mapping", () => {
  it("maps decoded entities back to the raw source range", () => {
    const text = `x ${PH.join("&#45;")} y`;
    const [span] = piiSpans(text, ["phone"]);
    expect(span && text.slice(span.start, span.end)).toBe(PH.join("&#45;"));
  });

  it("maps fullwidth and astral digits (NFKC) to whole code points", () => {
    // Mathematical bold digits are surrogate pairs that NFKC maps to ASCII.
    const astral = digitsIn(PH.join("-"), 0x1d7ce);
    const text = `call ${astral}.`;
    const [span] = piiSpans(text, ["phone"]);
    expect(span && text.slice(span.start, span.end)).toBe(astral);
  });

  it("covers tag-split values from their first to last character", () => {
    const html = `<span>${AREA}</span>-${EXCH}-${LINE}`;
    const [span] = piiSpans(`a ${html} b`, ["phone"]);
    expect(span).toEqual({ start: 8, end: 2 + html.length, rule: "phone" });
  });

  it("covers a value split across a line break", () => {
    const text = j("mail someone", "@\n", "example.com now");
    const [span] = piiSpans(text, ["email"]);
    expect(span && text.slice(span.start, span.end)).toBe(
      j("someone", "@\n", "example.com"),
    );
  });

  it("does not join across a blank line", () => {
    expect(piiSpans(j("someone", "@\n\n", "example.com"), ["email"])).toEqual(
      [],
    );
  });

  it("sorts and merges overlapping spans", () => {
    const tel = j("tel", ":", PH.join(""));
    const text = `${tel} and ${STREET.join(" ")} and ${tel}`;
    const spans = piiSpans(text);
    expect(spans.map((s) => s.rule)).toEqual([
      "phone",
      "street-address",
      "phone",
    ]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    }
  });

  it("restricts to the given rules and keeps the allowed email", () => {
    const text = `${j("TO", "DO")} avanegas95@gmail.com ${PH.join("-")}`;
    expect(piiSpans(text, ["placeholder"]).map((s) => s.rule)).toEqual([
      "placeholder",
    ]);
    expect(piiSpans(text, ["email"])).toEqual([]);
  });
});
