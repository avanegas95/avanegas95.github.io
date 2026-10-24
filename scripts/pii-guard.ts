// PII/placeholder guard (CLAUDE.md rule 2, SCOPE §5.2). Runs under plain node.
// Usage: node scripts/pii-guard.ts [--root <dir>] [--html <dir>] [--strict-markers]
//          [--site [--site-root <dir>]]
// PDFs under the --html dir are text-extracted (scripts/pdf-text.ts) and scanned too.
// Output never contains a full match: findings print as `file:line rule masked`.
// Exit: 0 ok, 1 PII/placeholder finding or over budget, 2 config/build error,
// 3 unresolved markers with --strict-markers (they only warn otherwise).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  KB_ROOT,
  KB_TOKEN_BUDGET,
  buildKb,
  estimateTokens,
  kbSha256,
  loadKbSources,
  type KbSource,
} from "../src/lib/kb.ts";
import { extractPdfText } from "./pdf-text.ts";
import { buildSystemPrompt } from "../src/lib/prompt.ts";
import {
  scanMarkers,
  scanText,
  type MarkerFinding,
  type PiiFinding,
  type PiiRule,
} from "../src/lib/pii.ts";

const HTML_RULES: readonly PiiRule[] = [
  "phone",
  "street-address",
  "zip",
  "email",
  "contact-url",
];
// Non-HTML text assets in the static output get the same rules as HTML.
const TEXT_ASSET = /\.(?:txt|xml|json|webmanifest)$/i;
const DEFAULT_HTML = ".vercel/output/static";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const isCi = () => {
  const v = (process.env["CI"] ?? "").toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
};

// Every regular file under `dir` (relative, "/"-separated). Symlinks and
// junctions are never followed; say so instead of skipping them silently.
function allFiles(
  dir: string,
  rel = "",
  out: string[] = [],
  links: string[] = [],
): string[] {
  const abs = rel === "" ? dir : join(dir, rel);
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isSymbolicLink()) {
      console.warn(`pii-guard WARN skipped link ${join(dir, p)}`);
      links.push(p);
    } else if (e.isDirectory()) allFiles(dir, p, out, links);
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const print = (f: PiiFinding) =>
  console.error(`${f.file}:${f.line} ${f.rule} ${f.masked}`);
const PROMPT = "<system-prompt>";
// Files: one warning per occurrence. The system prompt repeats the KB, so its
// markers print once per (rule, masked) with a count, at the first line.
function warnMarkers(markers: readonly MarkerFinding[]): void {
  const prompt = new Map<string, { f: MarkerFinding; n: number }>();
  for (const f of markers) {
    if (f.file !== PROMPT) {
      console.warn(`pii-guard WARN ${f.file}:${f.line} ${f.rule} ${f.masked}`);
      continue;
    }
    const key = `${f.rule}|${f.masked}`;
    const e = prompt.get(key);
    if (e) e.n++;
    else prompt.set(key, { f, n: 1 });
  }
  for (const { f, n } of prompt.values()) {
    console.warn(
      `pii-guard WARN ${f.file}:${f.line} ${f.rule} ${f.masked} x${n}`,
    );
  }
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --site (P5-03a): report-only scan of v1 site sources for phone/street-address.
// Hits never change the exit code; failing on them is P5-07's call (CI does not
// pass --site yet). Paths print relative to --site-root (default: cwd).
const SITE_RULES: readonly PiiRule[] = ["phone", "street-address"];
function siteFiles(siteRoot: string): string[] {
  const data = join(siteRoot, "src/data");
  const components = join(siteRoot, "src/components");
  const out: string[] = [];
  if (isDir(data)) {
    for (const e of readdirSync(data, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".ts")) out.push(`src/data/${e.name}`);
    }
  }
  if (isDir(components)) {
    for (const f of allFiles(components)) out.push(`src/components/${f}`);
  }
  return out.sort();
}
function reportSite(siteRoot: string): void {
  const files = siteFiles(siteRoot);
  if (files.length === 0) {
    console.warn(`pii-guard WARN no site files under ${siteRoot}`);
  }
  let hits = 0;
  for (const rel of files) {
    const raw = readFileSync(join(siteRoot, rel), "utf8");
    for (const f of scanText(raw, rel, SITE_RULES)) {
      hits++;
      console.warn(`pii-guard SITE ${f.file}:${f.line} ${f.rule} ${f.masked}`);
    }
  }
  console.warn(`pii-guard SITE hits=${hits}`);
}

async function main(): Promise<number> {
  const root = arg("--root") ?? KB_ROOT;
  const htmlArg = arg("--html");
  const htmlDir = htmlArg ?? DEFAULT_HTML;
  const htmlRequired = htmlArg !== undefined || isCi();
  const strictMarkers = process.argv.includes("--strict-markers");

  if (!isDir(root)) {
    console.error(`pii-guard ERROR KB root not found: ${root}`);
    return 2;
  }
  // Raw scan covers every file under the root, not just what the builder
  // loads (drafts, nested or non-.md files must not hide PII either).
  const rawFiles = allFiles(root);

  let sources: KbSource[];
  try {
    sources = loadKbSources(root);
  } catch (e) {
    console.error(`pii-guard ERROR ${errText(e)}`);
    return 2;
  }
  if (sources.length === 0) {
    console.warn(`pii-guard WARN no KB files under ${root}`);
  }

  const findings: PiiFinding[] = [];
  const markers: MarkerFinding[] = [];
  for (const rel of rawFiles) {
    const file = `${root}/${rel}`;
    const raw = readFileSync(join(root, rel), "utf8");
    findings.push(...scanText(raw, file));
    markers.push(...scanMarkers(raw, file));
  }

  let kb: string;
  try {
    kb = buildKb(sources);
  } catch (e) {
    findings.forEach(print);
    console.error(`pii-guard ERROR ${errText(e)}`);
    return 2;
  }
  findings.push(...scanText(kb, "<built-kb>"));
  markers.push(...scanMarkers(kb, "<built-kb>"));
  // The final system prompt (behaviour contract + KB) is scanned with all rules.
  const prompt = buildSystemPrompt(kb);
  findings.push(...scanText(prompt, PROMPT));
  markers.push(...scanMarkers(prompt, PROMPT));

  let html: string[] = [];
  let assets: string[] = [];
  let pdfs: string[] = [];
  const pdfLinks: string[] = [];
  if (isDir(htmlDir)) {
    const links: string[] = [];
    const all = allFiles(htmlDir, "", [], links);
    html = all.filter((f) => f.endsWith(".html")).map((f) => join(htmlDir, f));
    assets = all.filter((f) => TEXT_ASSET.test(f)).map((f) => join(htmlDir, f));
    pdfs = all.filter((f) => /\.pdf$/i.test(f)).map((f) => join(htmlDir, f));
    // A symlinked PDF cannot be inspected, so it fails closed.
    pdfLinks.push(
      ...links.filter((f) => /\.pdf$/i.test(f)).map((f) => join(htmlDir, f)),
    );
  }
  if (html.length === 0) {
    if (htmlRequired) {
      findings.forEach(print);
      warnMarkers(markers);
      console.error(`pii-guard ERROR no HTML files under ${htmlDir}`);
      return 2;
    }
    console.warn(`pii-guard WARN no HTML files under ${htmlDir}`);
  }
  for (const file of [...html, ...assets]) {
    findings.push(...scanText(readFileSync(file, "utf8"), file, HTML_RULES));
  }

  // Every PDF is read with a real text extractor and scanned with the HTML rules.
  // One that cannot be read fails closed.
  const pdfFailures: string[] = pdfLinks.map((f) => `${f} pdf-symlink`);
  for (const file of pdfs) {
    try {
      const text = await extractPdfText(file);
      // Blank-line joined text for the email rule (single breaks glue an address onto the
      // line above), single-break text for the rest so values split across lines are joined.
      findings.push(
        ...scanText(text.replace(/\n/g, "\n\n"), file, HTML_RULES),
        ...scanText(
          text,
          file,
          HTML_RULES.filter((r) => r !== "email"),
        ),
      );
    } catch (e) {
      pdfFailures.push(`${file} pdf-unreadable (${errText(e)})`);
    }
  }

  if (process.argv.includes("--site")) reportSite(arg("--site-root") ?? ".");

  findings.forEach(print);
  warnMarkers(markers);
  for (const line of pdfFailures) console.error(line);
  const tokens = estimateTokens(kb);
  const overBudget = tokens > KB_TOKEN_BUDGET;
  if (overBudget) {
    console.error(
      `pii-guard ERROR KB over token budget: est ${tokens} > ${KB_TOKEN_BUDGET}`,
    );
  }
  if (findings.length > 0 || pdfFailures.length > 0 || overBudget) {
    console.error(
      `pii-guard FAIL findings=${findings.length + pdfFailures.length}`,
    );
    return 1;
  }
  if (strictMarkers && markers.length > 0) {
    console.error(`pii-guard FAIL unresolved-markers=${markers.length}`);
    return 3;
  }
  console.log(
    `pii-guard OK files=${sources.length} html=${html.length} assets=${assets.length} pdfs=${pdfs.length} kbChars=${kb.length} kbEstTokens=${tokens} kbSha256=${kbSha256(kb)}`,
  );
  return 0;
}

// exitCode (not exit()) so piped output is fully flushed before the process ends.
process.exitCode = await main();
