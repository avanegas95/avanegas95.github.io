// Post-build client bundle gate (CLAUDE.md rules 3 and 8). Runs under plain node (type
// stripping): erasable TS only. Reads .vercel/output/static after `npm run build`.
//
// 1. Budget: the JS graph reachable from the `<blob-agent>` entry module (the chunk that calls
//    customElements.define("blob-agent", ...), i.e. src/scripts/blob/index) must stay within
//    25 KB gzip. React island chunks are excluded from that budget.
// 2. Secrets: EVERY client JS chunk is scanned for forbidden strings.
// 3. Fail closed: once any HTML contains <blob-agent>, a missing Blob entry chunk is an error.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildSystemPrompt } from "../src/lib/prompt.ts";

export const ISLAND_BUDGET_BYTES = 25 * 1024;
export const STATIC_DIR = ".vercel/output/static";

// Fail closed: plain substring matching, so prose such as "upstashing" is flagged too.
// A false positive costs a reworded string; a false negative leaks a secret or server module.
export const FORBIDDEN: readonly (string | RegExp)[] = [
  "ANTHROPIC_API_KEY",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "IP_HASH_SALT",
  "DAILY_BUDGET_USD",
  /sk-ant-/,
  "anthropic-version",
  "@upstash",
  "upstash",
  // A slice of the real system prompt: proves the prompt never reaches the client.
  buildSystemPrompt("").slice(0, 60),
];

// The Blob entry module registers the custom element. Astro renames chunks, so we match the
// code that defines <blob-agent>, not a file name.
const BLOB_DEFINE = /customElements\s*\.\s*define\s*\(\s*["'`]blob-agent["'`]/;
const BLOB_TAG = /<blob-agent[\s>/]/i;
// React island runtime chunks (react, react-dom client, jsx-runtime) are not part of the budget.
const REACT_CHUNK = /(^|\/)(react|react-dom|client|jsx-runtime)\.[\w-]+\.m?js$/;

// Static `import x from "./a.js"`, side-effect `import"./a.js"`, re-exports, and `import("./a.js")`.
const IMPORT_SPEC = /(?:\bfrom|\bimport)\s*\(?\s*["'`]([^"'`]+)["'`]/g;

// File keys are paths relative to the static root, posix style, no leading slash.
function resolveSpec(spec: string, from: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(spec)) return null; // absolute URLs are not local files
  const clean = spec.replace(/[?#].*$/, "");
  const joined = clean.startsWith("/")
    ? clean.slice(1)
    : posix.join(posix.dirname(from), clean);
  return posix.normalize(joined);
}

export function findBlobEntries(files: Map<string, string>): string[] {
  return [...files].filter(([, src]) => BLOB_DEFINE.test(src)).map(([k]) => k);
}

export function hasBlobTag(htmls: Map<string, string>): boolean {
  return [...htmls.values()].some((h) => BLOB_TAG.test(h));
}

export function isReactChunk(file: string): boolean {
  return REACT_CHUNK.test(file);
}

/** Files reachable from `entries` through static and dynamic imports. */
export function reachableGraph(
  entries: string[],
  files: Map<string, string>,
): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    const src = files.get(key);
    if (src === undefined || seen.has(key)) continue;
    seen.add(key);
    for (const m of src.matchAll(IMPORT_SPEC)) {
      const next = resolveSpec(m[1] ?? "", key);
      if (next !== null) queue.push(next);
    }
  }
  return [...seen];
}

export function gzipSize(src: string): number {
  return gzipSync(Buffer.from(src, "utf8"), { level: 9 }).length;
}

export function scanForbidden(
  files: Map<string, string>,
): { file: string; match: string }[] {
  const found: { file: string; match: string }[] = [];
  for (const [file, src] of files) {
    for (const f of FORBIDDEN) {
      const hit = typeof f === "string" ? src.includes(f) : f.test(src);
      // Report the rule, never surrounding source text.
      if (hit)
        found.push({ file, match: typeof f === "string" ? f : String(f) });
    }
  }
  return found;
}

export interface BundleReport {
  entries: string[];
  graph: { file: string; gzip: number }[];
  excluded: string[];
  total: number;
  notes: string[];
  problems: string[];
}

export function evaluate(
  htmls: Map<string, string>,
  files: Map<string, string>,
): BundleReport {
  const notes: string[] = [];
  const problems: string[] = [];
  const entries = findBlobEntries(files);
  const reachable = reachableGraph(entries, files);
  const excluded = reachable.filter(isReactChunk);
  const graph = reachable
    .filter((f) => !excluded.includes(f))
    .map((file) => ({ file, gzip: gzipSize(files.get(file) ?? "") }));
  const total = graph.reduce((n, g) => n + g.gzip, 0);

  if (entries.length === 0) {
    if (hasBlobTag(htmls))
      problems.push(
        "<blob-agent> appears in the HTML but no Blob entry chunk was found",
      );
    else notes.push("no Blob entry found (no <blob-agent> in any HTML)");
  } else if (total > ISLAND_BUDGET_BYTES) {
    problems.push(
      `Blob JS is ${total} B gzip, over the ${ISLAND_BUDGET_BYTES} B budget`,
    );
  }
  for (const f of scanForbidden(files))
    problems.push(`forbidden content in ${f.file}: ${f.match}`);
  return { entries, graph, excluded, total, notes, problems };
}

function readTree(
  root: string,
  accept: (name: string) => boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (accept(name))
        out.set(
          relative(root, full).split("\\").join("/"),
          readFileSync(full, "utf8"),
        );
    }
  };
  walk(root);
  return out;
}

export const readJsFiles = (root: string): Map<string, string> =>
  readTree(root, (n) => /\.m?js$/.test(n));
export const readHtmlFiles = (root: string): Map<string, string> =>
  readTree(root, (n) => n.endsWith(".html"));

export function main(root = STATIC_DIR): number {
  const htmls = readHtmlFiles(root);
  const files = readJsFiles(root);
  const r = evaluate(htmls, files);
  console.log("Blob JS graph (gzip, React chunks excluded):");
  for (const g of r.graph)
    console.log(`  ${String(g.gzip).padStart(6)} B  ${g.file}`);
  if (r.graph.length > 0)
    console.log(
      `  ${String(r.total).padStart(6)} B  total / ${ISLAND_BUDGET_BYTES} B budget`,
    );
  for (const n of r.notes) console.log(`NOTE: ${n}`);
  console.log(
    `Scanned ${files.size} client JS file(s) in ${htmls.size} page(s) for forbidden content.`,
  );
  for (const p of r.problems) console.error(`FAIL: ${p}`);
  return r.problems.length === 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
