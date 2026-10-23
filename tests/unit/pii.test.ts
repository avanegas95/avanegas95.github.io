import { describe, expect, it } from "vitest";
import {
  ALLOWED_EMAIL,
  ALLOWED_URL_PREFIXES,
  mask,
  piiSpans,
  scanMarkers,
  scanText,
  type PiiRule,
} from "../../src/lib/pii.ts";

// No literal phone numbers, addresses or markers live in the repo (CLAUDE.md
// rule 2): every sample is assembled at runtime from fragments, using the
// fictional 555-01xx range and made-up streets.
const j = (...parts: string[]) => parts.join("");
const AREA = "617";
const EXCH = "555";
const LINE = j("01", "23");
const PH = [AREA, EXCH, LINE];
const cp = (n: number) => String.fromCodePoint(n);
// Re-encode ASCII digits into another Unicode digit block (zero at `base`).
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
  // Unicode separators, digits and spacing variants.
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
  // HTML markup and entities.
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
  // Split across a line break.
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

describe("scanText mustFind", () => {
  for (const [sample, rule] of mustFind) {
    it(`flags ${mask(sample)} as ${rule}`, () => {
      const found = scanText(`Context: ${sample} end.`, "f.md");
      expect(found.map((f) => f.rule)).toContain(rule);
      for (const f of found) {
        expect(f.masked).not.toContain(sample);
      }
    });
  }
});

describe("scanText mustNotFind", () => {
  for (const sample of mustNotFind) {
    it(`ignores ${sample}`, () => {
      expect(scanText(sample, "f.md")).toEqual([]);
    });
  }
});

describe("scanText details", () => {
  it("reports file and 1-based line numbers", () => {
    const phone = [AREA, EXCH, LINE].join("-");
    const text = `line one\r\nline two\n\ncall ${phone}\n${j("TO", "DO")}\n`;
    const found = scanText(text, "kb/a.md");
    expect(found).toEqual([
      { file: "kb/a.md", line: 4, rule: "phone", masked: "61***" },
      { file: "kb/a.md", line: 5, rule: "placeholder", masked: "TO***" },
    ]);
  });

  it("restricts to the given rules", () => {
    const text = `${j("Place", "holder")} and ${j(AREA, EXCH, LINE)}`;
    const found = scanText(text, "x.html", ["phone"]);
    expect(found.map((f) => f.rule)).toEqual(["phone"]);
  });

  it("does not double-report one phone number", () => {
    const found = scanText(j("tel", ":+1", AREA, EXCH, LINE), "f");
    expect(found).toHaveLength(1);
  });

  it("exports the allowlist", () => {
    expect(ALLOWED_EMAIL).toBe("avanegas95@gmail.com");
    expect(ALLOWED_URL_PREFIXES).toEqual([
      "linkedin.com/in/avanegas95",
      "github.com/avanegas95",
    ]);
  });
});

describe("scanMarkers", () => {
  const markers = [
    j("To be ", "confirmed"),
    j("to be\n", "confirmed"),
    j("T", "BC"),
    j("X", "XX"),
    j("Coming ", "soon"),
  ];
  for (const m of markers) {
    it(`warns on ${mask(m)}`, () => {
      const found = scanMarkers(`Line: ${m}.`, "f.md");
      expect(found).toHaveLength(1);
      expect(found[0]?.rule).toBe("unresolved-marker");
      expect(found[0]?.masked).not.toContain(m);
    });
  }
  for (const ok of ["upcoming soonish", "XXXL", "TBCx", "confirmed soon"]) {
    it(`ignores ${ok}`, () => {
      expect(scanMarkers(ok, "f.md")).toEqual([]);
    });
  }
  it("is not part of scanText", () => {
    expect(scanText(j("T", "BC"), "f.md")).toEqual([]);
  });
});

describe("mask", () => {
  it("keeps two chars and never returns the input", () => {
    for (const [sample] of mustFind) {
      const m = mask(sample);
      expect(m).not.toBe(sample);
      expect(m).toBe(`${sample.slice(0, 2)}***`);
    }
    for (const s of ["", "a", "ab", "abc"]) expect(mask(s)).not.toBe(s);
  });
});

describe("fused addresses and dedupe", () => {
  const ALLOWED = ALLOWED_EMAIL;
  const EVIL = j("ev", "il");

  it("flags a prefix fused onto the allowed address in KB markdown", () => {
    const found = scanText(`${EVIL}<span></span>${ALLOWED}`, "kb/a.md");
    expect(found.map((f) => f.rule)).toContain("email");
  });

  it("flags the same in HTML with a non-label prefix", () => {
    const html = `<p>${EVIL}<span></span>${ALLOWED}</p>`;
    const found = scanText(html, "x.html", ["email"]);
    expect(found.map((f) => f.rule)).toContain("email");
  });

  it("does not accept a label fused onto the address (no loosening)", () => {
    for (const label of ["Email", "mail", "contact"]) {
      const found = scanText(`<b>${label}</b><a>${ALLOWED}</a>`, "x.html");
      expect(found.map((f) => f.rule)).toContain("email");
    }
  });

  it("accepts the label when separated by whitespace", () => {
    expect(scanText(`<b>Email</b> <a>${ALLOWED}</a>`, "x.html")).toEqual([]);
  });

  it("flags a fullwidth phone and email (NFKC)", () => {
    const fw = (s: string) =>
      s.replace(/[!-~]/g, (c) => cp(c.charCodeAt(0) + 0xfee0));
    const phone = j(cp(0xff08), fw(AREA), cp(0xff09), fw(` ${EXCH}-${LINE}`));
    expect(scanText(phone, "f.md").map((f) => f.rule)).toContain("phone");
    const mail = j(EVIL, cp(0xff20), "example.com");
    expect(scanText(mail, "f.md").map((f) => f.rule)).toContain("email");
    const fullAllowedLookalike = j("x", ALLOWED.replace("@", cp(0xff20)));
    expect(scanText(fullAllowedLookalike, "f.md").map((f) => f.rule)).toContain(
      "email",
    );
  });

  it("block boundaries do not fuse adjacent items", () => {
    const li = `<ul><li><a href="x">${ALLOWED}</a></li>
<li>LinkedIn: <a>https://www.linkedin.com/in/avanegas95</a></li></ul>`;
    expect(scanText(li, "x.html")).toEqual([]);
    const flat = `<li>${ALLOWED}</li><li>LinkedIn</li><br>${ALLOWED}<p>x</p>`;
    expect(scanText(flat, "x.html")).toEqual([]);
  });

  it("an inline span split is still one phone", () => {
    const inline = `<span>${AREA}</span>-${EXCH}-${LINE}`;
    expect(scanText(inline, "x.html").map((f) => f.rule)).toContain("phone");
  });

  // Block tags read as one space for every non-email rule, so a value split
  // across items or a <br> is still caught.
  const blockPhones: ReadonlyArray<string> = [
    `<p>${AREA}</p>-${EXCH}-${LINE}`,
    `${AREA}<br>${EXCH}-${LINE}`,
    `${AREA}<br/>${EXCH}-${LINE}`,
    `${AREA}<p class="x">${EXCH}-${LINE}`,
    `<div>${AREA}-${EXCH}-</div><div>${LINE}</div>`,
    `<li>${AREA}</li><li>${EXCH}-${LINE}</li>`,
    `<td>(${AREA})</td><td>${EXCH}-${LINE}</td>`,
    `<li>${AREA}</li>
  <li>${EXCH}-${LINE}</li>`,
    `<td>${AREA}</td>  <td>${EXCH}</td> <td>${LINE}</td>`,
  ];
  for (const [n, html] of blockPhones.entries()) {
    it(`flags a phone split by block tags (#${n})`, () => {
      expect(scanText(html, "x.html").map((f) => f.rule)).toContain("phone");
    });
  }

  it("flags an address split across list items", () => {
    const html = `<li>${STREET[0]}</li><li>${STREET[1]} ${STREET[2]}</li>`;
    expect(scanText(html, "x.html").map((f) => f.rule)).toContain(
      "street-address",
    );
  });

  const SOME = j("some", "one");
  const DOM = j("exam", "ple");
  const blockEmails: ReadonlyArray<string> = [
    `<p>${SOME}@</p><p>${DOM}.com</p>`,
    `${SOME}<br>@${DOM}.com`,
    `<li>${SOME}@${DOM}.</li><li>com</li>`,
    `<p>${SOME}@</p>
<p>${DOM}.com</p>`,
    `<li>${SOME}@</li>  <li>${DOM}.com</li>`,
  ];
  for (const [n, html] of blockEmails.entries()) {
    it(`flags an email split by block tags (#${n})`, () => {
      expect(scanText(html, "x.html").map((f) => f.rule)).toContain("email");
    });
  }

  it("flags a split email even when the allowed address follows", () => {
    const html = `<p>${SOME}@</p><p>${DOM}.com</p><p>${ALLOWED}</p>`;
    expect(scanText(html, "x.html").map((f) => f.rule)).toContain("email");
  });

  it("allows a separate block line before the allowed address", () => {
    expect(scanText(`<p>${EVIL}</p>${ALLOWED}`, "x.html")).toEqual([]);
  });

  it("allowed email and URL in adjacent items pass", () => {
    const html = j(
      `<ul><li><a href="mailto:${ALLOWED}">${ALLOWED}</a></li>`,
      `<li>LinkedIn: <a href="https://www.linkedin.com/in/avanegas95">`,
      `https://www.linkedin.com/in/avanegas95</a></li>`,
      `<li>GitHub: <a href="https://github.com/avanegas95">`,
      `github.com/avanegas95</a></li></ul>`,
    );
    expect(scanText(html, "x.html")).toEqual([]);
    // Same list with one item per line, as the built homepage renders it.
    const lined = html.replaceAll("</li>", "</li>\n");
    expect(scanText(lined, "x.html")).toEqual([]);
  });

  it("a tight line join never fuses across a block boundary", () => {
    const url = "github.com/avanegas95";
    expect(scanText(`<li>${url}</li>\n<li>Extra</li>`, "x.html")).toEqual([]);
    // A plain line break inside one block still joins tightly.
    const split = `<p>${url.slice(0, 7)}\n${url.slice(7)}x</p>`;
    expect(scanText(split, "x.html").map((f) => f.rule)).toContain(
      "contact-url",
    );
  });

  it("counts every occurrence on one line", () => {
    const m = j("TO", "DO");
    expect(scanText(`${m} ${m} ${m}`, "f.md")).toHaveLength(3);
    const u = j("to be ", "confirmed");
    expect(scanMarkers(`${u}, ${u}, ${u}`, "f.md")).toHaveLength(3);
  });

  it("counts one phone once across the decoded/stripped copies", () => {
    const ph = PH.join("-");
    expect(scanText(`<p>${ph}</p>&amp;`, "x.html")).toHaveLength(1);
  });
});

// --- P2-12: line joins after the allowed address, both tag readings -------

const AT = "@";
const OK_MAIL = j("avanegas95", AT, "gmail.com");
const EVIL_MAIL = j("someone", AT, "example.com");

describe("a line break after the allowed address", () => {
  const keep = [
    `Email: ${OK_MAIL}\nLinkedIn: https://www.linkedin.com/in/avanegas95`,
    `You can reach him at ${OK_MAIL}\nThanks for asking!`,
    `Write to ${OK_MAIL}.\nHe usually answers fast.`,
    `Mail (${OK_MAIL})\nor GitHub.`,
  ];
  for (const [n, text] of keep.entries()) {
    it(`does not fuse the next line onto it (#${n})`, () => {
      expect(scanText(text, "x.md")).toEqual([]);
      expect(piiSpans(text)).toEqual([]);
      const html = `<p>${text.replace("\n", "</p>\n<p>")}</p>`;
      expect(scanText(html, "x.html")).toEqual([]);
      expect(piiSpans(html)).toEqual([]);
    });
  }

  const flag = [
    `${EVIL_MAIL}\nfoo`,
    // Not the complete allowed address before the break, so the tight join
    // still applies: "...gmail.c" + "om.evil.zz" is a different address.
    j("avanegas95", AT, "gmail.c\nom.evil.zz"),
    j("evil-", OK_MAIL, "\nx"),
    j("x", OK_MAIL, "\nfoo"),
  ];
  for (const [n, text] of flag.entries()) {
    it(`still flags an email at a line break (#${n})`, () => {
      expect(scanText(text, "x.md").map((f) => f.rule)).toContain("email");
      expect(piiSpans(text, ["email"]).length).toBeGreaterThan(0);
    });
  }
});

describe("both tag readings", () => {
  const ph = (mid: string) => j(AREA, "-", EXCH, "-", mid, LINE);
  const cases = [
    // A "<" with no ">" before the next "<" does not hide the text after it.
    `I <3 ${ph("<b>")}`,
    `I <3 x ${ph(`<x ${"ab ".repeat(19)}>`)}`,
    // The HTML reading: "<x <b>" is one tag.
    ph("<x <b>"),
  ];
  for (const [n, text] of cases.entries()) {
    it(`flags a phone split by a tag (#${n})`, () => {
      expect(scanText(text, "x.html").map((f) => f.rule)).toContain("phone");
      expect(piiSpans(text, ["phone"]).length).toBeGreaterThan(0);
    });
  }
});

// --- P4-07: piiSpans contract, line joins after allowed values --------------

const ZIP_LINE = j("Anytown, ", "MA ", ZIP5);
const EVIL_HOST = j("ev", "il.zz");
const LI = "https://www.linkedin.com/in/avanegas95";
const GH = "https://github.com/avanegas95";

// Inputs whose spans must not change (captured before P4-07). Cases the new
// rules deliberately change live in the tables below, not here.
const SPAN_CORPUS: readonly string[] = [
  `Reach him at ${OK_MAIL} or ${EVIL_MAIL}.`,
  PH.join("-"),
  j("(", AREA, ") ", EXCH, "-", LINE),
  digitsIn(PH.join("-"), 0x1d7ce),
  digitsIn(PH.join("-"), 0xff10),
  j(AREA, "-", EXCH, "-\n", LINE),
  j("Mail someone", AT, "\nexample.com works."),
  j("Lives at ", STREET.join(" "), "\n", ZIP_LINE, "."),
  `[GitHub](${GH}/portfolio-v3) and ${LI}`,
  "https://www.linkedin.com/in/someone-else",
  j("evil-", OK_MAIL),
  j("<p>", AREA, "</p><p>", EXCH, "-", LINE, "</p>"),
  PH.join("&#45;"),
  `${OK_MAIL}\nLinkedIn: ${LI}`,
  `Write to ${OK_MAIL}.\nHe usually answers fast.`,
  `${EVIL_MAIL}\nfoo`,
  j("avanegas95", AT, "gmail.c\nom.", EVIL_HOST),
  j("I <3 ", AREA, "-", EXCH, "-<b>", LINE),
  "see x.com/evil and t.me/x",
  j("P.O. Box ", "12", " and Apt ", "4"),
  j("tel", ":+1", AREA, EXCH, LINE),
  j("someone", AT, "</p><p>example.com"),
  `<p>Email: ${OK_MAIL}</p>\n<p>LinkedIn: ${LI}</p>`,
  `Mail (${OK_MAIL})\nor GitHub.`,
];

describe("piiSpans contract (P4-07)", () => {
  it("gives the same spans as before on the adversarial corpus", () => {
    expect(SPAN_CORPUS.map((t) => piiSpans(t))).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 56,
            "rule": "email",
            "start": 37,
          },
        ],
        [
          {
            "end": 12,
            "rule": "phone",
            "start": 0,
          },
        ],
        [
          {
            "end": 14,
            "rule": "phone",
            "start": 0,
          },
        ],
        [
          {
            "end": 22,
            "rule": "phone",
            "start": 0,
          },
        ],
        [
          {
            "end": 12,
            "rule": "phone",
            "start": 0,
          },
        ],
        [
          {
            "end": 13,
            "rule": "phone",
            "start": 0,
          },
        ],
        [
          {
            "end": 25,
            "rule": "email",
            "start": 5,
          },
        ],
        [
          {
            "end": 23,
            "rule": "street-address",
            "start": 9,
          },
          {
            "end": 41,
            "rule": "zip",
            "start": 33,
          },
        ],
        [],
        [
          {
            "end": 40,
            "rule": "contact-url",
            "start": 8,
          },
        ],
        [
          {
            "end": 25,
            "rule": "email",
            "start": 0,
          },
        ],
        [
          {
            "end": 21,
            "rule": "phone",
            "start": 3,
          },
        ],
        [
          {
            "end": 20,
            "rule": "phone",
            "start": 0,
          },
        ],
        [],
        [],
        [
          {
            "end": 23,
            "rule": "email",
            "start": 0,
          },
        ],
        [
          {
            "end": 29,
            "rule": "email",
            "start": 0,
          },
        ],
        [
          {
            "end": 20,
            "rule": "phone",
            "start": 5,
          },
        ],
        [
          {
            "end": 9,
            "rule": "contact-url",
            "start": 4,
          },
          {
            "end": 23,
            "rule": "contact-url",
            "start": 19,
          },
        ],
        [
          {
            "end": 11,
            "rule": "street-address",
            "start": 0,
          },
          {
            "end": 21,
            "rule": "street-address",
            "start": 16,
          },
        ],
        [
          {
            "end": 16,
            "rule": "phone",
            "start": 0,
          },
        ],
        [
          {
            "end": 26,
            "rule": "email",
            "start": 0,
          },
        ],
        [],
        [],
      ]
    `);
  });
});

// Rule 1: a complete allowed address ends the line, but the next line starts
// with an address character, so the tight (no-gap) reading still applies.
describe("tight join after the allowed email (P4-07)", () => {
  const flag = [
    `${OK_MAIL}\n.${EVIL_HOST}`,
    `${OK_MAIL}\n-${EVIL_HOST}`,
    `${OK_MAIL}\n${AT}${EVIL_HOST}`,
    `${OK_MAIL}\n%x`,
    `${OK_MAIL}\n+x`,
    `${OK_MAIL}\n_x`,
    `Mail me: ${OK_MAIL}\n.${EVIL_HOST} today`,
    // The same fused tail on one line, and across HTML block breaks.
    `${OK_MAIL}${AT}${EVIL_HOST}`,
    `<p>${OK_MAIL}</p><p>.${EVIL_HOST}</p>`,
    `<li>${OK_MAIL}</li>\n<li>${AT}${EVIL_HOST}</li>`,
  ];
  for (const [n, text] of flag.entries()) {
    it(`flags a value fused across the break (#${n})`, () => {
      expect(scanText(text, "x.md").map((f) => f.rule)).toContain("email");
      expect(piiSpans(text, ["email"]).length).toBeGreaterThan(0);
    });
  }

  const keep = [
    `${OK_MAIL}\nLinkedIn`,
    `${OK_MAIL}\n\n- GitHub`,
    `${OK_MAIL}\n- GitHub`,
    `${OK_MAIL}.\n.next line`,
    `${OK_MAIL}\n(${GH})`,
  ];
  for (const [n, text] of keep.entries()) {
    it(`keeps two separate lines clean (#${n})`, () => {
      expect(scanText(text, "x.md")).toEqual([]);
      expect(piiSpans(text)).toEqual([]);
    });
  }
});

// Rule 2: the same line-join rule after an allowed profile URL.
describe("line joins after an allowed profile URL (P4-07)", () => {
  const keep = [
    `${LI}\nGitHub`,
    `${GH}\nLinkedIn`,
    `LinkedIn: ${LI}\nGitHub: ${GH}`,
    `[LinkedIn](${LI})\nGitHub`,
    `${GH}.\nHe codes.`,
    `${LI}\n\n- GitHub`,
  ];
  for (const [n, text] of keep.entries()) {
    it(`keeps two separate lines clean (#${n})`, () => {
      expect(scanText(text, "x.md")).toEqual([]);
      expect(piiSpans(text)).toEqual([]);
    });
  }

  const flag = [
    `${LI}\n.evil`,
    `${LI}\n-x`,
    `${GH}\n.evil`,
    `${GH}\n-x`,
    `${GH}\n_x`,
    `${LI}\nevil`.replace(LI, "https://www.linkedin.com/in/avanegas9"),
    `${LI}.evil`,
  ];
  for (const [n, text] of flag.entries()) {
    it(`still flags a different profile (#${n})`, () => {
      expect(scanText(text, "x.md").map((f) => f.rule)).toContain(
        "contact-url",
      );
      expect(piiSpans(text, ["contact-url"]).length).toBeGreaterThan(0);
    });
  }

  // Review round 1: closing punctuation ends the value, so a next line that
  // starts with a digit is a new sentence or list item, never a fused tail.
  const punctuated = [
    `Email him at ${OK_MAIL}.\n2024 was a big year.`,
    `1. Email: ${OK_MAIL}.\n2. LinkedIn: ${LI}.\n3. GitHub: ${GH}.`,
    `${GH}.\n10+ years of QA.`,
    `${LI},\n2 more links`,
    `(${OK_MAIL})\n3 ways to reach him`,
  ];
  for (const [n, text] of punctuated.entries()) {
    it(`keeps a punctuated value before a digit line (#${n})`, () => {
      expect(scanText(text, "x.md")).toEqual([]);
      expect(piiSpans(text)).toEqual([]);
    });
  }

  // Review round 2: an "@" after a punctuated value still joins (as on main),
  // and a bare URL before a markdown bullet stays clean.
  const atAfterPunct = [
    `${GH}.\n${AT}${EVIL_HOST}`,
    `(${GH}).\n${AT}${EVIL_HOST}`,
  ];
  for (const [n, text] of atAfterPunct.entries()) {
    it(`flags an address split after a punctuated URL (#${n})`, () => {
      expect(scanText(text, "x.md").map((f) => f.rule)).toContain("email");
      expect(piiSpans(text, ["email"]).length).toBeGreaterThan(0);
    });
  }

  it("keeps a bare URL before a markdown bullet", () => {
    const text = `${LI}\n- GitHub`;
    expect(scanText(text, "x.md")).toEqual([]);
    expect(piiSpans(text)).toEqual([]);
  });

  it("scanText and piiSpans agree on the line-join rows", () => {
    const rows = [
      ...punctuated,
      `${OK_MAIL}\n.${EVIL_HOST}`,
      `${OK_MAIL}\n${AT}${EVIL_HOST}`,
      `${OK_MAIL}\nLinkedIn`,
      `${LI}\n.evil`,
      `${GH}\n-x`,
      `${GH}\nLinkedIn`,
    ];
    for (const text of rows) {
      const found = scanText(text, "x.md").length > 0;
      expect(piiSpans(text).length > 0, JSON.stringify(text)).toBe(found);
    }
  });

  it("still reads a phone that starts in the profile's digits", () => {
    const text = `${GH}\n${j("5-", EXCH, "-", LINE)}`;
    expect(scanText(text, "x.md").map((f) => f.rule)).toContain("phone");
    expect(piiSpans(text, ["phone"]).length).toBeGreaterThan(0);
  });
});
