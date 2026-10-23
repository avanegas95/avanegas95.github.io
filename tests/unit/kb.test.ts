import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildKb,
  estimateTokens,
  kbSha256,
  loadKbSources,
  type KbSource,
} from "../../src/lib/kb.ts";

const fm = (extra: string, pub = "true") =>
  `---\ntopic: bio\ntitle: Bio\nsummary: Short.\nupdated: 2026-01-01\npublic: ${pub}\n${extra}---\n\nBody.\n`;

const sources: KbSource[] = [
  {
    path: "b.md",
    raw: "---\ntopic: bio\ntitle: About\nsummary: Who he is.\nupdated: 2026-01-01\npublic: true\n---\n\nHello there.\n",
  },
  {
    path: "projects/a.md",
    raw: "---\ntopic: project\ntitle: Orbit\nsummary: A game.\nupdated: 2026-02-02\npublic: true\norder: 1\n---\n\nFun game.\n",
  },
];

const expected =
  "## About\n\nWho he is.\n\nHello there.\n\n## Project: Orbit\n\nA game.\n\nFun game.\n";

describe("buildKb", () => {
  it("golden", () => {
    expect(buildKb(sources)).toBe(expected);
  });

  it("order-independent", () => {
    expect(buildKb([...sources].reverse())).toBe(buildKb(sources));
  });

  it("crlf+bom", () => {
    const alt = sources.map((s) => ({
      path: s.path,
      raw: "﻿" + s.raw.replaceAll("\n", "\r\n"),
    }));
    expect(buildKb(alt)).toBe(expected);
  });

  it("updated/order ignored", () => {
    const alt = sources.map((s) => ({
      path: s.path,
      raw: s.raw
        .replace("2026-02-02", "2030-05-05")
        .replace("order: 1", "order: 9"),
    }));
    expect(buildKb(alt)).toBe(expected);
  });

  it("public false excluded", () => {
    const out = buildKb([...sources, { path: "z.md", raw: fm("", "false") }]);
    expect(out).toBe(expected);
  });

  it("quoted summary with colon", () => {
    const raw = `---\ntopic: bio\ntitle: 'It''s: me'\nsummary: "Skills: QA, \\"CI\\""\npublic: true\n---\nBody\n`;
    expect(buildKb([{ path: "q.md", raw }])).toBe(
      `## It's: me\n\nSkills: QA, "CI"\n\nBody\n`,
    );
  });

  it("empty input", () => {
    expect(buildKb([])).toBe("");
  });

  it("ends with exactly one newline and no CR", () => {
    const out = buildKb(sources);
    expect(out).not.toContain("\r");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("throws with path on missing frontmatter", () => {
    expect(() => buildKb([{ path: "x.md", raw: "no fm" }])).toThrow(
      "kb: missing frontmatter in x.md",
    );
    expect(() => buildKb([{ path: "x.md", raw: "---\ntitle: a\n" }])).toThrow(
      /x\.md/,
    );
  });

  it("throws with path on public: yes", () => {
    expect(() => buildKb([{ path: "y.md", raw: fm("", "yes") }])).toThrow(
      /y\.md/,
    );
  });

  it("throws with path on empty body", () => {
    const raw =
      "---\ntopic: bio\ntitle: T\nsummary: S\npublic: true\n---\n\n  \n";
    expect(() => buildKb([{ path: "e.md", raw }])).toThrow(/e\.md/);
  });

  it("throws with path on missing title or summary", () => {
    const raw = "---\ntopic: bio\nsummary: S\npublic: true\n---\nBody\n";
    expect(() => buildKb([{ path: "t.md", raw }])).toThrow(/t\.md/);
    const raw2 = "---\ntopic: bio\ntitle: T\npublic: true\n---\nBody\n";
    expect(() => buildKb([{ path: "s.md", raw: raw2 }])).toThrow(/s\.md/);
  });

  it("sorts an unsorted input list by path", () => {
    const mk = (path: string, title: string): KbSource => ({
      path,
      raw: `---\ntopic: bio\ntitle: ${title}\nsummary: S\npublic: true\n---\nB\n`,
    });
    const out = buildKb([
      mk("projects/z.md", "third"),
      mk("m.md", "second"),
      mk("a.md", "first"),
    ]);
    expect(out.indexOf("## first")).toBeLessThan(out.indexOf("## second"));
    expect(out.indexOf("## second")).toBeLessThan(out.indexOf("## third"));
  });

  it("sorts by code unit, not locale", () => {
    const mk = (path: string, title: string): KbSource => ({
      path,
      raw: `---\ntopic: bio\ntitle: ${title}\nsummary: S\npublic: true\n---\nB\n`,
    });
    const out = buildKb([mk("a.md", "lower"), mk("B.md", "upper")]);
    expect(out.indexOf("## upper")).toBeLessThan(out.indexOf("## lower"));
  });
});

describe("frontmatter strictness", () => {
  const one = (summary: string): KbSource => ({
    path: "p/f.md",
    raw: `---\ntopic: bio\ntitle: T\nsummary: ${summary}\npublic: true\n---\nB\n`,
  });

  it("throws with path on unquoted value with a ' #' comment", () => {
    expect(() => buildKb([one("Fast # not a comment")])).toThrow(/p\/f\.md/);
  });

  it("allows '#' inside a plain scalar without a leading space", () => {
    expect(buildKb([one("C# and F#")])).toContain("C# and F#");
  });

  it("throws with path on block scalars and multi-line values", () => {
    expect(() => buildKb([one(">")])).toThrow(/p\/f\.md/);
    expect(() => buildKb([one("|")])).toThrow(/p\/f\.md/);
    expect(() => buildKb([one("first\n  second")])).toThrow(/p\/f\.md/);
    expect(() => buildKb([one("")])).toThrow(/p\/f\.md/);
  });

  it("throws with path on a quoted value with trailing content", () => {
    expect(() => buildKb([one('"a" # note')])).toThrow(/p\/f\.md/);
    expect(() => buildKb([one('"unterminated')])).toThrow(/p\/f\.md/);
    expect(() => buildKb([one("'it's'")])).toThrow(/p\/f\.md/);
  });

  it("throws with path on flow collections, anchors and tags", () => {
    for (const v of ["[a, b]", "{a: b}", "&x y", "*x", "!!str y"]) {
      expect(() => buildKb([one(v)])).toThrow(/p\/f\.md/);
    }
  });
});

describe("loadKbSources file selection", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tmpKb(files: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "kb-"));
    dirs.push(root);
    for (const f of files) {
      const full = join(root, f);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, fm(""));
    }
    return root;
  }

  it("excludes _-prefixed files and directories", () => {
    const root = tmpKb([
      "bio.md",
      "_draft.md",
      "projects/a.md",
      "projects/_wip.md",
      "_hidden/x.md",
      "projects/_hidden/y.md",
    ]);
    expect(loadKbSources(root).map((s) => s.path)).toEqual([
      "bio.md",
      "projects/a.md",
    ]);
  });

  it("excludes nested/deep.md and other depths and extensions", () => {
    const root = tmpKb([
      "bio.md",
      "nested/deep.md",
      "projects/sub/deep.md",
      "projects/a.md",
      "notes.txt",
    ]);
    expect(loadKbSources(root).map((s) => s.path)).toEqual([
      "bio.md",
      "projects/a.md",
    ]);
  });

  it("tolerates a missing projects directory", () => {
    const root = tmpKb(["bio.md"]);
    expect(loadKbSources(root).map((s) => s.path)).toEqual(["bio.md"]);
  });
});

describe("fixture knowledge base", () => {
  it("golden output is unchanged", () => {
    const kb = buildKb(loadKbSources("tests/fixtures/kb"));
    expect(kb).toBe(
      "## About Anderson\n\nA short bio.\n\nAnderson is a Staff SQA Engineer.\n\n## Contact\n\nHow to reach him.\n\nEmail, LinkedIn, GitHub.\n\n## Project: Blob\n\nThe site agent.\n\nBlob answers questions.\n\n## Project: Orbit Hop\n\nA mobile game.\n\nOrbit Hop is a game.\n\n## Skills\n\nTools: test automation.\n\n- Playwright\n- Python\n",
    );
    expect(kb).not.toContain("Underscore");
    expect(kb).not.toContain("Nested");
  });
});

describe("loadKbSources", () => {
  const root = "tests/fixtures/kb";

  it("two loads are byte-identical", () => {
    const a = buildKb(loadKbSources(root));
    const b = buildKb(loadKbSources(root));
    expect(a).toBe(b);
    expect(kbSha256(a)).toBe(kbSha256(b));
    expect(kbSha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("paths are posix and sorted", () => {
    const paths = loadKbSources(root).map((s) => s.path);
    expect(paths.length).toBeGreaterThanOrEqual(5);
    expect(paths.every((p) => !p.includes("\\"))).toBe(true);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain("projects/orbit-hop.md");
  });

  it("excludes the non-public fixture", () => {
    const out = buildKb(loadKbSources(root));
    expect(out).not.toContain("Hidden text");
    expect(out).toContain("## Project: Orbit Hop");
  });
});

describe("estimateTokens", () => {
  it("rounds up length / 4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
