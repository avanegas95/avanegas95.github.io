// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  renderMarkdown,
  type Block,
  type Inline,
} from "../../src/scripts/blob/markdown";

const GH = "https://github.com/avanegas95";
const LI = "https://www.linkedin.com/in/avanegas95";
const txt = (v: string): Inline => ({ t: "text", v });
const P = (...c: Inline[]): Block => ({ t: "p", c });
const link = (href: string, ...c: Inline[]): Inline => ({
  t: "link",
  href,
  external: !href.startsWith("#") && !href.startsWith("/"),
  c,
});

function allInlines(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  const walk = (xs: Inline[]): void => {
    for (const x of xs) {
      out.push(x);
      if (x.t === "strong" || x.t === "em" || x.t === "link") walk(x.c);
    }
  };
  for (const b of blocks) {
    if (b.t === "p") walk(b.c);
    else b.items.forEach(walk);
  }
  return out;
}

describe("parseMarkdown: supported constructs", () => {
  it.each<[string, Block[]]>([
    ["Hello world", [P(txt("Hello world"))]],
    ["", []],
    ["\n\n  \n", []],
    ["line one\nline two", [P(txt("line one line two"))]],
    ["a\r\nb", [P(txt("a b"))]],
    ["para one\n\npara two", [P(txt("para one")), P(txt("para two"))]],
    ["a\n \n\n\nb", [P(txt("a")), P(txt("b"))]],
    ["- one\n- two", [{ t: "ul", items: [[txt("one")], [txt("two")]] }]],
    ["* one\n* two", [{ t: "ul", items: [[txt("one")], [txt("two")]] }]],
    [
      "1. one\n2. two\n10. ten",
      [{ t: "ol", items: [[txt("one")], [txt("two")], [txt("ten")]] }],
    ],
    [
      "Intro:\n- one\n- two\n\nAfter.",
      [
        P(txt("Intro:")),
        { t: "ul", items: [[txt("one")], [txt("two")]] },
        P(txt("After.")),
      ],
    ],
    [
      "- one\n  continued\n- two",
      [{ t: "ul", items: [[txt("one continued")], [txt("two")]] }],
    ],
    [
      "- a\n1. b",
      [
        { t: "ul", items: [[txt("a")]] },
        { t: "ol", items: [[txt("b")]] },
      ],
    ],
    ["**bold**", [P({ t: "strong", c: [txt("bold")] })]],
    ["*em*", [P({ t: "em", c: [txt("em")] })]],
    ["_em_", [P({ t: "em", c: [txt("em")] })]],
    ["`code`", [P({ t: "code", v: "code" })]],
    ["`<b>**x**</b>`", [P({ t: "code", v: "<b>**x**</b>" })]],
    [
      "a **b** c *d* e _f_ `g`",
      [
        P(
          txt("a "),
          { t: "strong", c: [txt("b")] },
          txt(" c "),
          { t: "em", c: [txt("d")] },
          txt(" e "),
          { t: "em", c: [txt("f")] },
          txt(" "),
          { t: "code", v: "g" },
        ),
      ],
    ],
    [
      "**bold with *em* inside**",
      [
        P({
          t: "strong",
          c: [txt("bold with "), { t: "em", c: [txt("em")] }, txt(" inside")],
        }),
      ],
    ],
    [
      "*em with **bold** inside*",
      [
        P({
          t: "em",
          c: [
            txt("em with "),
            { t: "strong", c: [txt("bold")] },
            txt(" inside"),
          ],
        }),
      ],
    ],
    [`[GitHub](${GH})`, [P(link(GH, txt("GitHub")))]],
    [`[LinkedIn](${LI})`, [P(link(LI, txt("LinkedIn")))]],
    [
      "[email](mailto:avanegas95@gmail.com)",
      [P(link("mailto:avanegas95@gmail.com", txt("email")))],
    ],
    ["[contact](#contact)", [P(link("#contact", txt("contact")))]],
    ["[OrbitHop](/orbithop/)", [P(link("/orbithop/", txt("OrbitHop")))]],
    [`[**GitHub**](${GH})`, [P(link(GH, { t: "strong", c: [txt("GitHub")] }))]],
    [`See ${GH}.`, [P(txt("See "), link(GH, txt(GH)), txt("."))]],
    [`(${GH})`, [P(txt("("), link(GH, txt(GH)), txt(")"))]],
    [
      `- [GitHub](${GH})\n- ${LI}`,
      [
        {
          t: "ul",
          items: [[link(GH, txt("GitHub"))], [link(LI, txt(LI))]],
        },
      ],
    ],
  ])("%j", (src, expected) => {
    expect(parseMarkdown(src)).toEqual(expected);
  });

  it("nested **[x](url)** is strong > link", () => {
    expect(parseMarkdown(`**[x](${GH})**`)).toEqual([
      P({ t: "strong", c: [link(GH, txt("x"))] }),
    ]);
  });
});

describe("parseMarkdown: everything else is literal text", () => {
  it.each([
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    '<a href="javascript:alert(1)">x</a>',
    "# Heading",
    "## Sub heading",
    "![alt](https://github.com/avanegas95)",
    "![alt](x)",
    "| a | b |",
    "> quoted",
    "[a]: https://evil.zz",
    "[a]: https://github.com/avanegas95",
    '[1]: https://github.com/avanegas95 "title"',
    "[a][1]",
    "[a][]",
    "[a]",
    "<https://github.com/avanegas95>",
    "<mailto:avanegas95@gmail.com>",
    "snake_case_name",
    "2 * 3 * 4",
    "a ** b ** c",
    "price: $5 _ $6",
    "http://github.com/avanegas95",
    "www.github.com",
    "mailto:avanegas95@gmail.com",
    "\\*not em\\*",
  ])("%j", (src) => {
    expect(parseMarkdown(src)).toEqual([P(txt(src))]);
  });

  it("keeps heading text but makes no heading block", () => {
    const blocks = parseMarkdown("# Title\n\nBody");
    expect(blocks).toEqual([P(txt("# Title")), P(txt("Body"))]);
  });

  it("renders code fences as plain text", () => {
    expect(parseMarkdown("```js\nconst x = `a` + **b**;\n```")).toEqual([
      P(txt("```js const x = `a` + **b**; ```")),
    ]);
  });

  it("fence content never becomes a list", () => {
    expect(parseMarkdown("```\n- a\n1. b\n```")).toEqual([
      P(txt("``` - a 1. b ```")),
    ]);
  });

  it("reference definitions stay text inside a paragraph", () => {
    expect(parseMarkdown(`Hi **there**\n[1]: ${GH}\nbye`)).toEqual([
      P(txt("Hi "), { t: "strong", c: [txt("there")] }, txt(` [1]: ${GH} bye`)),
    ]);
  });

  it("disallowed links render only their label", () => {
    for (const url of [
      "https://evil.zz",
      "http://github.com/avanegas95",
      "data:text/html,x",
      "https://github.com.evil.zz",
      "https://github.com@evil.zz",
      "#nope",
    ]) {
      const blocks = parseMarkdown(`[click me](${url})`);
      expect(blocks).toEqual([P(txt("click me"))]);
    }
  });

  it("javascript: links never produce a link node or show the URL scheme", () => {
    const blocks = parseMarkdown("[click](javascript:alert(1))");
    const inl = allInlines(blocks);
    expect(inl.some((x) => x.t === "link")).toBe(false);
    expect(JSON.stringify(blocks)).not.toMatch(/javascript/i);
    expect(blocks).toEqual([P(txt("click"))]);
  });

  it("consumes one level of parens in a link target", () => {
    expect(parseMarkdown("[a](https://evil.zz/x(1)) b")).toEqual([
      P(txt("a b")),
    ]);
    expect(parseMarkdown("[a](javascript:alert(1)")).toEqual([
      P(txt("[a](javascript:alert(1)")),
    ]);
  });

  it("links to other paths on the allowed hosts stay label text", () => {
    for (const url of [
      "https://github.com/evil/malware",
      "https://github.com/avanegas95evil",
      "https://github.com/avanegas95/../../evil/repo",
      "https://github.com/avanegas95/%2e%2e/evil",
      "https://linkedin.com/in/evil",
      "mailto:evil@evil.zz",
    ]) {
      expect(parseMarkdown(`[x](${url})`)).toEqual([P(txt("x"))]);
      expect(
        allInlines(parseMarkdown(`see ${url}`)).some((x) => x.t === "link"),
      ).toBe(false);
    }
  });

  describe("reference definitions behind prefixes or split lines stay literal (P2-12)", () => {
    it.each([
      `> [1]: ${GH}`,
      `- [1]: ${GH}`,
      `* [1]: ${GH}`,
      `1. [1]: ${GH}`,
      `  > - [1]: ${GH}`,
      `>> [a]: <${GH}>`,
    ])("%j", (src) => {
      expect(parseMarkdown(src)).toEqual([P(txt(src.trim()))]);
    });

    it("keeps a target on the next line literal", () => {
      expect(parseMarkdown(`[1]:\n${GH}`)).toEqual([P(txt(`[1]: ${GH}`))]);
      expect(parseMarkdown(`> [1]:\n  ${GH} "t"\nafter **x**`)).toEqual([
        P(txt(`> [1]: ${GH} "t" after `), { t: "strong", c: [txt("x")] }),
      ]);
    });

    it("a definition inside a list does not continue the list", () => {
      expect(parseMarkdown(`- one\n- [1]: ${GH}`)).toEqual([
        { t: "ul", items: [[txt("one")]] },
        P(txt(`- [1]: ${GH}`)),
      ]);
    });

    it("a blank line ends a pending next-line target", () => {
      expect(parseMarkdown(`[1]:\n\n${GH}`)).toEqual([
        P(txt("[1]:")),
        P(link(GH, txt(GH))),
      ]);
    });

    it("ordinary bracketed text in lists is unaffected", () => {
      expect(parseMarkdown(`- [GitHub](${GH})\n- [x] done`)).toEqual([
        {
          t: "ul",
          items: [[link(GH, txt("GitHub"))], [txt("[x] done")]],
        },
      ]);
    });
  });

  it("hostile bare URLs stay text", () => {
    expect(parseMarkdown("go https://evil.zz/x now")).toEqual([
      P(txt("go https://evil.zz/x now")),
    ]);
  });

  it("does not autolink inside link labels", () => {
    expect(parseMarkdown(`[${GH}](${GH})`)).toEqual([P(link(GH, txt(GH)))]);
  });

  it("unfinished constructs render as text", () => {
    expect(parseMarkdown("see [GitHub](")).toEqual([P(txt("see [GitHub]("))]);
    expect(parseMarkdown("see [GitHub](https://github.com/ava")).toEqual([
      P(txt("see [GitHub](https://github.com/ava")),
    ]);
    expect(parseMarkdown("**bold")).toEqual([P(txt("**bold"))]);
    expect(parseMarkdown("**")).toEqual([P(txt("**"))]);
    expect(parseMarkdown("`code")).toEqual([P(txt("`code"))]);
    expect(parseMarkdown("1.")).toEqual([P(txt("1."))]);
    expect(parseMarkdown("-")).toEqual([P(txt("-"))]);
  });
});

const CORPUS = [
  "Anderson is a **Staff SQA Engineer** in the Boston area.",
  `You can reach him on [LinkedIn](${LI}) or [GitHub](${GH}).`,
  "Email: [avanegas95@gmail.com](mailto:avanegas95@gmail.com)",
  "- **Playwright** and *Cypress*\n- `pytest`\n- CI with _GitHub Actions_",
  "1. Plan\n2. Test\n3. Ship",
  `Check out ${GH} for code.`,
  "Blob doesn't know, contact Anderson. See [contact](#contact).",
  "He built [OrbitHop](/orbithop/), a tiny game.",
  "**Bold [link](https://github.com/avanegas95) inside**",
  "*em with `code` inside*",
  "Paragraph one.\n\nParagraph two\ncontinues here.",
  "<img src=x onerror=alert(1)>",
  "[x](javascript:alert(1))",
  "![img](https://github.com/avanegas95/a.png)",
  "[ref][1]\n\n[1]: https://github.com/avanegas95",
  "```\ncode **fence**\n```",
  "# Heading\nText",
  "> quote with [link](https://evil.zz)",
  "| a | b |\n|---|---|",
  "<https://github.com/avanegas95>",
  "Nested **bold *and em* together** done",
  "Edge ***triple*** stars",
  "Unicode: café ✨ — fine",
  "snake_case and __dunder__",
  "Trailing link (https://www.linkedin.com/in/avanegas95).",
  "List:\n* a\n* b\n\n1. c",
  "Mixed `a` **b** _c_ [d](#about) https://github.com",
  "Escapes \\*x\\* and \\[y\\]",
  '[a](https://github.com/avanegas95 "title")',
  "Privacy: [policy](/privacy/) and [home](/)",
];

describe("streaming prefixes", () => {
  it("has a 30-sample corpus", () => {
    expect(CORPUS).toHaveLength(30);
  });

  it("every prefix of every sample parses and renders without throwing", () => {
    for (const sample of CORPUS) {
      const cps = [...sample];
      for (let i = 0; i <= cps.length; i++) {
        const prefix = cps.slice(0, i).join("");
        const blocks = parseMarkdown(prefix);
        expect(() => renderMarkdown(blocks)).not.toThrow();
      }
    }
  });

  it("prefixes never expose a disallowed href", () => {
    for (const sample of CORPUS) {
      for (let i = 0; i <= sample.length; i++) {
        for (const x of allInlines(parseMarkdown(sample.slice(0, i)))) {
          if (x.t === "link") {
            expect(x.href).toMatch(
              /^(https:\/\/(github\.com|linkedin\.com|www\.linkedin\.com)\/|mailto:[^?]+$|#|\/)/,
            );
          }
        }
      }
    }
  });
});

describe("linear-ish time (scaling ratio, not wall clock)", () => {
  // Floor for the small input's per-character cost (ms): 0.25 ms of CPU over
  // its 10 x 2 KB, above CPU timer jitter; real runs are well over it.
  const FLOOR_MS_PER_CHAR = 0.25 / (10 * 2048);
  // Per-character cost of a 20 KB input vs a 2 KB input. Linear ≈ 1, quadratic ≈ 10.
  function perCharRatio(unit: string): number {
    const small = unit.repeat(Math.ceil(2048 / unit.length));
    const big = unit.repeat(Math.ceil(20480 / unit.length));
    // CPU time, not wall clock: a descheduled run says nothing about cost.
    // Best of 3 runs.
    const time = (s: string, reps: number): number => {
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const t0 = process.cpuUsage();
        for (let k = 0; k < reps; k++) parseMarkdown(s);
        const d = process.cpuUsage(t0);
        best = Math.min(best, (d.user + d.system) / 1000);
      }
      return best;
    };
    time(big, 1); // warm up
    const tSmall = time(small, 10) / (10 * small.length);
    const tBig = time(big, 1) / big.length;
    return tBig / Math.max(tSmall, FLOOR_MS_PER_CHAR);
  }

  it.each([
    "*",
    "[",
    "`",
    "_",
    "**a",
    "[a](",
    "[a]",
    "![a](",
    "a_",
    "https://github.com/ ",
    "- ",
    "*a ",
  ])("%j repeated", (unit) => {
    expect(perCharRatio(unit)).toBeLessThan(5);
  });
});

describe("renderMarkdown (happy-dom)", () => {
  const ALLOWED_TAGS = new Set([
    "P",
    "UL",
    "OL",
    "LI",
    "STRONG",
    "EM",
    "CODE",
    "A",
  ]);

  function walk(node: Node, visit: (el: Element) => void): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        visit(child as Element);
        walk(child, visit);
      } else {
        expect(child.nodeType).toBe(3);
      }
    }
  }

  const HOSTILE = [
    ...CORPUS,
    "<script>alert(1)</script> **<b onclick=x>hi</b>**",
    '[x](https://github.com/avanegas95"onmouseover="alert(1))',
    "[x](https://github.com/avanegas95?a=<script>)",
    "`</code><script>alert(1)</script>`",
    "<style>body{display:none}</style>",
  ].join("\n\n");

  it("emits only allowed tags and attributes", () => {
    const frag = renderMarkdown(parseMarkdown(HOSTILE));
    let seen = 0;
    walk(frag, (el) => {
      seen++;
      expect(ALLOWED_TAGS.has(el.tagName)).toBe(true);
      for (const attr of Array.from(el.attributes)) {
        expect(el.tagName).toBe("A");
        expect(["href", "rel", "target"]).toContain(attr.name);
      }
      if (el.tagName === "A") {
        expect(el.getAttribute("href")).toMatch(/^(https:|mailto:|#|\/)/);
      }
    });
    expect(seen).toBeGreaterThan(10);
  });

  it("keeps <script> as text (textContent round-trip)", () => {
    const src = "Hi <script>alert(1)</script> & <img src=x onerror=alert(1)>";
    const frag = renderMarkdown(parseMarkdown(src));
    const host = document.createElement("div");
    host.append(frag);
    expect(host.textContent).toBe(src);
    expect(host.querySelector("script, img")).toBeNull();
  });

  it("builds the expected structure", () => {
    const frag = renderMarkdown(
      parseMarkdown("**a** *b* `c`\n\n- one\n- two\n\n1. x"),
    );
    const host = document.createElement("div");
    host.append(frag);
    expect(Array.from(host.children).map((e) => e.tagName)).toEqual([
      "P",
      "UL",
      "OL",
    ]);
    expect(host.querySelector("p strong")?.textContent).toBe("a");
    expect(host.querySelector("p em")?.textContent).toBe("b");
    expect(host.querySelector("p code")?.textContent).toBe("c");
    expect(host.querySelectorAll("ul > li")).toHaveLength(2);
    expect(host.querySelectorAll("ol > li")).toHaveLength(1);
  });

  it("external links get rel and target; same-site links get neither", () => {
    const frag = renderMarkdown(
      parseMarkdown(
        `[gh](${GH}) [mail](mailto:avanegas95@gmail.com) [c](#contact) [o](/orbithop/)`,
      ),
    );
    const host = document.createElement("div");
    host.append(frag);
    const links = Array.from(host.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      GH,
      "mailto:avanegas95@gmail.com",
      "#contact",
      "/orbithop/",
    ]);
    for (const a of links.slice(0, 2)) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
    for (const a of links.slice(2)) {
      expect(a.hasAttribute("rel")).toBe(false);
      expect(a.hasAttribute("target")).toBe(false);
    }
  });

  it("disallowed link shows only the label, not the URL", () => {
    const host = document.createElement("div");
    host.append(renderMarkdown(parseMarkdown("[label](https://evil.zz/x)")));
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toBe("label");
  });

  it("re-checks a hand-built AST: no foreign tags, no unchecked hrefs", () => {
    const bad = [
      {
        t: "p",
        c: [
          { t: "script", c: [txt("alert(1)")] },
          { t: "img", v: "x" },
          {
            t: "link",
            href: "javascript:alert(1)",
            external: false,
            c: [txt("js")],
          },
          {
            t: "link",
            href: "https://github.com/evil",
            external: false,
            c: [txt("gh")],
          },
          { t: "link", href: "#nope", external: false, c: [txt("hash")] },
          { t: "link", href: GH, external: false, c: [txt("ok")] },
          { t: "strong", c: [txt("s")] },
        ],
      },
      { t: "script", c: [] },
      { t: "iframe", items: [[txt("i")]] },
    ] as unknown as Block[];
    const host = document.createElement("div");
    host.append(renderMarkdown(bad));
    expect(host.querySelector("script, img, iframe")).toBeNull();
    const links = Array.from(host.querySelectorAll("a"));
    expect(links).toHaveLength(1);
    // external comes from safeHref, not from the AST.
    expect(links[0]!.getAttribute("href")).toBe(GH);
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(host.textContent).toBe("jsghhashoks");
    expect(
      Array.from(host.querySelectorAll("*")).map((e) => e.tagName),
    ).toEqual(["P", "A", "STRONG"]);
  });

  it("accepts an explicit document", () => {
    const frag = renderMarkdown([P(txt("x"))], document);
    expect(frag.childNodes).toHaveLength(1);
  });
});
