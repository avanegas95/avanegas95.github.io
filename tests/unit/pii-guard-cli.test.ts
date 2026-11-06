import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Samples are assembled at runtime (CLAUDE.md rule 2): fictional 555-01xx
// numbers and a made-up street, never literals in the repo.
const j = (...parts: string[]) => parts.join("");
const PHONE = ["617", "555", j("01", "23")].join("-");
const STREET = j("12", "3 Example ", "Street");
const MARKER = j("TO", "DO");
const UNRESOLVED = j("to be ", "confirmed");
const BREAK = String.fromCharCode(10);
const SCRIPT = resolve("scripts/pii-guard.ts");

// Each case spawns `node` on the TypeScript CLI. Under load a cold spawn can
// take several seconds, so this file gets a realistic budget instead of the
// 5 s default, and every spawn shares one compile cache so the CLI and its
// imports are type-stripped and compiled once, not once per case. spawnSync
// blocks, so the cases already run one at a time; the child gets its own
// timeout so a hang fails with a message instead of stalling the run.
const SPAWN_TIMEOUT_MS = 45_000;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const COMPILE_CACHE = mkdtempSync(join(tmpdir(), "pii-guard-cache-"));
afterAll(() => rmSync(COMPILE_CACHE, { recursive: true, force: true }));

// Minimal one-page PDF with a single text run (built at runtime, never a committed fixture).
function textPdf(...lines: string[]): Buffer {
  const stream = `BT /F1 12 Tf 14 TL 20 150 Td ${lines
    .map((l) => `(${l}) Tj T*`)
    .join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>${BREAK}stream${BREAK}${stream}${BREAK}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = `%PDF-1.4${BREAK}`;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj${BREAK}${o}${BREAK}endobj${BREAK}`;
  });
  const xref = out.length;
  out += `xref${BREAK}0 ${objs.length + 1}${BREAK}0000000000 65535 f ${BREAK}`;
  for (const o of offsets) {
    out += `${String(o).padStart(10, "0")} 00000 n ${BREAK}`;
  }
  out += `trailer${BREAK}<< /Size ${objs.length + 1} /Root 1 0 R >>${BREAK}startxref${BREAK}${xref}${BREAK}%%EOF${BREAK}`;
  return Buffer.from(out, "latin1");
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "pii-guard-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const kbFile = (body: string, extra = "") =>
  `---\ntopic: bio\ntitle: About\nsummary: Who he is.\nupdated: 2026-01-01\npublic: true\ngreeting: g\nname: n\nheadline: h\nlede: l\nabout: [a]\ntools: [[t]]\n${extra}---\n\n${body}\n`;

function kbRoot(files: Record<string, string>): string {
  const root = tmp();
  for (const [name, raw] of Object.entries(files)) {
    writeFileSync(join(root, name), raw, "utf8");
  }
  return root;
}

function cleanHtml(): string {
  const d = tmp();
  writeFileSync(join(d, "index.html"), "<p>Hello</p>");
  return d;
}

type RunOpts = {
  html?: string | null;
  extra?: string[];
  cwd?: string;
  ci?: string;
};

// html: undefined = clean temp dir, null = omit --html.
function run(root: string, opts: RunOpts = {}) {
  const html = opts.html === undefined ? cleanHtml() : opts.html;
  const args = [SCRIPT, "--root", root];
  if (html !== null) args.push("--html", html);
  args.push(...(opts.extra ?? []));
  const env = {
    ...process.env,
    CI: opts.ci ?? "",
    NODE_COMPILE_CACHE: COMPILE_CACHE,
  };
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: opts.cwd ?? process.cwd(),
    env,
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (r.error) throw r.error;
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}

describe("pii-guard CLI", () => {
  it("clean KB exits 0 with the OK line", () => {
    const r = run(kbRoot({ "bio.md": kbFile("Builds test suites.") }));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /^pii-guard OK files=1 html=1 assets=0 pdfs=0 kbChars=\d+ kbEstTokens=\d+ kbSha256=[0-9a-f]{64}$/m,
    );
  });

  it.each([
    ["phone", PHONE],
    ["street-address", STREET],
    ["placeholder", MARKER],
  ])("planted %s in a KB file exits 1, masked", (rule, value) => {
    const r = run(kbRoot({ "bio.md": kbFile(`Reach out: ${value} soon.`) }));
    expect(r.code).toBe(1);
    expect(r.out).toContain(rule);
    expect(r.out).toContain("bio.md:");
    expect(r.out).not.toContain(value);
  });

  it("flags the planted value in the built KB too", () => {
    const r = run(kbRoot({ "bio.md": kbFile(`Call ${PHONE}.`) }));
    expect(r.out).toContain("<built-kb>");
  });

  it("phone in an HTML file exits 1, masked", () => {
    const html = tmp();
    mkdirSync(join(html, "sub"));
    writeFileSync(join(html, "sub", "index.html"), `<p>${PHONE}</p>`);
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("phone");
    expect(r.out).not.toContain(PHONE);
  });

  it("placeholder marker only in HTML exits 0", () => {
    const html = tmp();
    writeFileSync(
      join(html, "index.html"),
      `<input placeholder="Ask"><!-- ${MARKER} -->`,
    );
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("html=1");
  });

  it("bad frontmatter exits 2 with the builder message", () => {
    const r = run(kbRoot({ "bio.md": "no frontmatter here\n" }));
    expect(r.code).toBe(2);
    expect(r.out).toContain("missing frontmatter");
  });

  it("over the token budget exits 1", () => {
    const r = run(kbRoot({ "bio.md": kbFile("word ".repeat(13_000)) }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/budget/i);
  });

  it("empty root exits 0 with a warning", () => {
    const r = run(tmp());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/warn/i);
    expect(r.stdout).toMatch(/^pii-guard OK files=0 /m);
  });

  it("missing root exits 2", () => {
    const r = run(join(tmp(), "nope"));
    expect(r.code).toBe(2);
  });

  it("scans files the builder skips (drafts, nested, non-md)", () => {
    for (const [name, sub] of [
      ["_draft.md", ""],
      ["deep.md", "a/b"],
      ["notes.txt", ""],
    ] as const) {
      const root = kbRoot({ "bio.md": kbFile("Clean.") });
      mkdirSync(join(root, sub), { recursive: true });
      writeFileSync(join(root, sub, name), `Call ${PHONE}.`);
      const r = run(root);
      expect(r.code).toBe(1);
      expect(r.out).toContain(name);
      expect(r.out).not.toContain(PHONE);
    }
  });

  it("phone split across lines in KB exits 1", () => {
    const split = ["617", "555", j("-", BREAK, "01", "23")].join("-");
    const r = run(kbRoot({ "bio.md": kbFile(`Call ${split} now.`) }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("phone");
  });

  it("entity-encoded phone in HTML exits 1", () => {
    const html = tmp();
    const enc = ["617", "555", j("01", "23")].join("&#45;");
    writeFileSync(join(html, "index.html"), `<p><span>${enc}</span></p>`);
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(enc);
  });

  it("explicit --html that is missing exits non-zero", () => {
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), {
      html: join(tmp(), "missing"),
    });
    expect(r.code).toBe(2);
  });

  it("explicit --html with no HTML files exits non-zero", () => {
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html: tmp() });
    expect(r.code).toBe(2);
  });

  it("default HTML dir missing: warns locally, fails under CI", () => {
    const root = kbRoot({ "bio.md": kbFile("Clean.") });
    const local = run(root, { html: null, cwd: tmp() });
    expect(local.code).toBe(0);
    expect(local.out).toMatch(/WARN no HTML/);
    const ci = run(root, { html: null, cwd: tmp(), ci: "true" });
    expect(ci.code).toBe(2);
  });

  it("warns when a linked directory is skipped", () => {
    const root = kbRoot({ "bio.md": kbFile("Clean.") });
    const target = tmp();
    symlinkSync(target, join(root, "linked"), "junction");
    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/WARN skipped link .*linked/);
  });

  it("unresolved markers warn (masked) by default", () => {
    const r = run(kbRoot({ "bio.md": kbFile(`Dates ${UNRESOLVED}.`) }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("unresolved-marker");
    expect(r.out).not.toContain(UNRESOLVED);
  });

  it("unresolved markers exit 3 with --strict-markers", () => {
    const root = kbRoot({ "bio.md": kbFile(`Dates ${UNRESOLVED}.`) });
    const r = run(root, { extra: ["--strict-markers"] });
    expect(r.code).toBe(3);
    expect(r.out).not.toContain(UNRESOLVED);
    const clean = run(kbRoot({ "bio.md": kbFile("Clean.") }), {
      extra: ["--strict-markers"],
    });
    expect(clean.code).toBe(0);
  });

  it("prints KB findings before failing on missing HTML", () => {
    const root = kbRoot({ "bio.md": kbFile(`Call ${PHONE}.`) });
    const r = run(root, { html: join(tmp(), "missing") });
    expect(r.code).toBe(2);
    expect(r.out).toContain("bio.md:");
    expect(r.out).toContain("phone");
    expect(r.out.indexOf("phone")).toBeLessThan(r.out.indexOf("ERROR no HTML"));
    expect(r.out).not.toContain(PHONE);
  });

  it("flags a fused prefix on the allowed email in KB and HTML", () => {
    const fused = j("ev", "il", "<span></span>", "avanegas95", "@gmail.com");
    const kb = run(kbRoot({ "bio.md": kbFile(fused) }));
    expect(kb.code).toBe(1);
    expect(kb.out).toContain("email");
    const html = tmp();
    writeFileSync(join(html, "index.html"), `<p>${fused}</p>`);
    const h = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(h.code).toBe(1);
  });

  it("reports 3 markers on one line as 3 warnings", () => {
    const u = UNRESOLVED;
    const r = run(kbRoot({ "bio.md": kbFile(`${u}, ${u}, ${u}`) }));
    expect(r.code).toBe(0);
    const n = r.out.split("\n").filter((l) => l.includes("unresolved-marker"));
    expect(n.filter((l) => l.includes("bio.md:"))).toHaveLength(3);
  });

  it.each(["robots.txt", "sitemap.xml", "data.json", "site.webmanifest"])(
    "planted phone in %s fails",
    (name) => {
      const html = cleanHtml();
      writeFileSync(join(html, name), `x ${PHONE} y`);
      const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
      expect(r.code).toBe(1);
      expect(r.out).toContain(name);
      expect(r.out).not.toContain(PHONE);
    },
  );

  it("a clean text asset passes", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "robots.txt"), "User-agent: *\n");
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("html=1 assets=1 ");
  });

  it("an unreadable pdf in the static output fails closed", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "broken.pdf"), "not a pdf");
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("broken.pdf pdf-unreadable");
  });

  it("a pdf whose text holds a phone number fails (masked in output)", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "r.pdf"), textPdf(`Call ${PHONE} today`));
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("r.pdf");
    expect(r.out).toContain("phone");
    expect(r.out).not.toContain(PHONE);
  });

  it("a pdf whose text holds a street address fails", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "r.pdf"), textPdf(`Lives at ${STREET}, Boston`));
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("street-address");
  });

  it.each([
    ["phone split after a dash", [PHONE.slice(0, 8), PHONE.slice(8)]],
    [
      "phone split with area code",
      [`(${PHONE.slice(0, 3)}) ${PHONE.slice(4, 7)}`, PHONE.slice(7)],
    ],
    ["street split from its suffix", [STREET.slice(0, 11), STREET.slice(11)]],
  ])("a pdf with a %s across lines fails", (_n, lines) => {
    const html = cleanHtml();
    writeFileSync(join(html, "r.pdf"), textPdf(...lines));
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("r.pdf");
  });

  it("a pdf over the byte cap fails closed", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "big.pdf"), Buffer.alloc(6 * 1024 * 1024, 32));
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("big.pdf pdf-unreadable");
  });

  it("the OK line counts pdfs", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "r.pdf"), textPdf("Boston Dynamics"));
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.stdout).toContain("pdfs=1 ");
  });

  it("a pdf with clean text passes", () => {
    const html = cleanHtml();
    writeFileSync(join(html, "r.pdf"), textPdf("Boston Dynamics, Boston MA"));
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(0);
  });

  it("the real public resume PDF passes", () => {
    const html = cleanHtml();
    copyFileSync(
      "public/Anderson_Vanegas_Resume.pdf",
      join(html, "Anderson_Vanegas_Resume.pdf"),
    );
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("pdf-");
  });

  it("a symlinked pdf in the static output fails", () => {
    const html = cleanHtml();
    const target = tmp();
    symlinkSync(target, join(html, "link.pdf"), "junction");
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain("link.pdf");
  });

  it.each(["resume.pdf", "Old.PDF"])("a %s in the static output fails", (n) => {
    const html = cleanHtml();
    writeFileSync(join(html, n), "%PDF-1.4");
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }), { html });
    expect(r.code).toBe(1);
    expect(r.out).toContain(n);
  });
});

describe("pii-guard CLI --site (P5-03a)", () => {
  const kb = () => kbRoot({ "bio.md": kbFile("Builds test suites.") });
  // A v1-shaped site tree: src/data/*.ts and src/components/**.
  function site(files: Record<string, string>): string {
    const d = tmp();
    for (const [rel, body] of Object.entries(files)) {
      const p = join(d, rel);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, body, "utf8");
    }
    return d;
  }
  const siteRun = (dir: string) =>
    run(kb(), { extra: ["--site", "--site-root", dir] });

  it("lists a phone in a src/data .ts file, masked, and exits 0", () => {
    const dir = site({
      "src/data/contact.ts": `export const phone = "${PHONE}";\n`,
      "src/components/ok.astro": "<p>Hi</p>\n",
    });
    const r = siteRun(dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/pii-guard SITE src\/data\/contact\.ts:1 phone /);
    expect(r.out).not.toContain(PHONE);
    expect(r.out).toMatch(/^pii-guard SITE hits=1$/m);
  });

  it("lists a street address in a nested component", () => {
    const dir = site({
      "src/components/sections/Footer.astro": `<p>${STREET}</p>\n`,
    });
    const r = siteRun(dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /pii-guard SITE src\/components\/sections\/Footer\.astro:1 street-address /,
    );
    expect(r.out).not.toContain(STREET);
  });

  it("clean site fixture exits 0 with no hits", () => {
    const dir = site({
      "src/data/nav.ts": 'export const nav = ["#home", "#contact"];\n',
      "src/components/ui/Button.tsx": "export const B = () => null;\n",
    });
    const r = siteRun(dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^pii-guard SITE hits=0$/m);
    expect(r.stdout).toMatch(/^pii-guard OK /m);
  });

  it("only scans src/data/*.ts (not nested or non-.ts data files)", () => {
    const dir = site({
      "src/data/notes.md": `${PHONE}\n`,
      "src/data/nested/x.ts": `"${PHONE}"\n`,
    });
    const r = siteRun(dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^pii-guard SITE hits=0$/m);
  });

  it("reports only phone and street-address on site files", () => {
    const mail = j("someone", "@", "example.com");
    const dir = site({ "src/data/social.ts": `export const m = "${mail}";\n` });
    const r = siteRun(dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^pii-guard SITE hits=0$/m);
  });

  it("does not scan site paths without --site", () => {
    const dir = site({ "src/data/contact.ts": `"${PHONE}"\n` });
    const r = run(kb(), { extra: ["--site-root", dir] });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/pii-guard SITE/);
  });

  it("a KB finding still fails with --site", () => {
    const dir = site({ "src/data/nav.ts": "export const n = 1;\n" });
    const root = kbRoot({ "bio.md": kbFile(`Call ${PHONE}.`) });
    const r = run(root, { extra: ["--site", "--site-root", dir] });
    expect(r.code).toBe(1);
  });

  it("warns when the site paths are missing", () => {
    const r = siteRun(tmp());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/pii-guard WARN no site files under /);
  });
});

describe("pii-guard CLI: system prompt scan", () => {
  it("reports a planted phone as <system-prompt> too", () => {
    const r = run(kbRoot({ "bio.md": kbFile(`Call ${PHONE}.`) }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("<system-prompt>:");
    expect(r.out).not.toContain(PHONE);
  });

  it("prints a repeated prompt marker once, with a count", () => {
    const u = UNRESOLVED;
    const body = [`Dates ${u}.`, `Venue ${u}.`, `Talk ${u}.`].join("\n\n");
    const root = kbRoot({ "bio.md": kbFile(body) });
    const r = run(root);
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    const prompt = lines.filter(
      (l) => l.includes("<system-prompt>") && l.includes("unresolved-marker"),
    );
    expect(prompt).toHaveLength(1);
    expect(prompt[0]).toMatch(/ x3$/);
    expect(r.out).not.toContain(u);
    // Files keep one warning per occurrence; strict mode counts every one.
    expect(lines.filter((l) => l.includes("bio.md:"))).toHaveLength(3);
    const strict = run(root, { extra: ["--strict-markers"] });
    expect(strict.code).toBe(3);
    expect(strict.out).toContain("unresolved-markers=9");
  });

  it("a clean run still prints the OK line", () => {
    const r = run(kbRoot({ "bio.md": kbFile("Clean.") }));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^pii-guard OK files=1 /m);
  });
});

describe("pii-guard CLI on the real KB (P2-12)", () => {
  const mail = j("avanegas95", "@", "gmail.com");
  const reply = [
    `<p>Email: ${mail}</p>`,
    "<p>LinkedIn: https://www.linkedin.com/in/avanegas95</p>",
    `<p>Write to ${mail}.`,
    "He usually answers fast.</p>",
  ].join(BREAK);

  it("passes with the contact reply in HTML", () => {
    const html = tmp();
    writeFileSync(join(html, "index.html"), reply);
    const r = run(resolve("src/content/knowledge"), { html });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^pii-guard OK /m);
  });

  it("still fails on another address at a line break", () => {
    const html = tmp();
    const evil = j("someone", "@", "example.com");
    writeFileSync(join(html, "index.html"), `${reply}${BREAK}${evil}${BREAK}x`);
    const r = run(resolve("src/content/knowledge"), { html });
    expect(r.code).toBe(1);
  });
});
