// Server/tooling only. Must run under plain `node` (type stripping): erasable TS only.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type KbSource = { readonly path: string; readonly raw: string };

export const KB_ROOT = "src/content/knowledge";
export const KB_TOKEN_BUDGET = 15_000;

const BOM = String.fromCharCode(0xfeff);

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Mirrors the content collection globs: `*.md` at the KB root and in
// `projects/`, nothing deeper. Names starting with `_` are skipped, as Astro's
// glob loader does.
const KB_DIRS = ["", "projects"] as const;

function listMarkdown(root: string, dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir === "" ? root : join(root, dir), {
      withFileTypes: true,
    });
  } catch (err) {
    if (dir !== "" && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith("_") || !e.isFile() || !e.name.endsWith(".md")) {
      continue;
    }
    out.push(dir === "" ? e.name : `${dir}/${e.name}`);
  }
  return out;
}

export function loadKbSources(root: string = KB_ROOT): KbSource[] {
  const paths = KB_DIRS.flatMap((d) => listMarkdown(root, d));
  paths.sort(cmp);
  return paths.map((path) => ({
    path,
    raw: readFileSync(join(root, path), "utf8"),
  }));
}

// Strict subset of YAML scalars so this parser cannot disagree with the YAML
// parser behind the content collections: a single-line double-quoted string,
// a single-line single-quoted string, or a plain scalar with no " #", ": " or
// leading indicator character. Anything else throws with the file path.
function parseValue(v: string, path: string, key: string): string {
  const bad = (why: string): never => {
    throw new Error(`kb: unsupported value for ${key} (${why}) in ${path}`);
  };
  const t = v.trim();
  if (t === "") return bad("empty or multi-line");
  if (t.startsWith('"')) {
    if (t.length < 2 || !t.endsWith('"')) return bad("bad double quotes");
    try {
      return String(JSON.parse(t));
    } catch {
      return bad("bad double-quoted string");
    }
  }
  if (t.startsWith("'")) {
    if (t.length < 2 || !t.endsWith("'")) return bad("bad single quotes");
    const inner = t.slice(1, -1).replaceAll("''", "\0");
    if (inner.includes("'")) return bad("unescaped single quote");
    return inner.replaceAll("\0", "'");
  }
  if (/^[|>[\]{}&*!%@`#,?]/.test(t) || t.startsWith("- ")) {
    return bad("unsupported YAML indicator");
  }
  if (t.includes(" #") || t.includes(": ") || t.endsWith(":")) {
    return bad("ambiguous plain scalar; quote it");
  }
  return t;
}

type Entry = { path: string; text: string };

function parseSource(src: KbSource): Entry | null {
  const stripped = src.raw.startsWith(BOM) ? src.raw.slice(1) : src.raw;
  const norm = stripped.replace(/\r\n?/g, "\n");
  const lines = norm.split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    throw new Error(`kb: missing frontmatter in ${src.path}`);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trimEnd() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`kb: missing frontmatter in ${src.path}`);

  const fm: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (!m) {
      throw new Error(`kb: unsupported frontmatter line in ${src.path}`);
    }
    const key = m[1] as string;
    if (
      key === "topic" ||
      key === "title" ||
      key === "summary" ||
      key === "public"
    ) {
      fm[key] = parseValue(m[2] as string, src.path, key);
    }
  }

  const pub = fm["public"];
  if (pub !== "true" && pub !== "false") {
    throw new Error(`kb: public must be true or false in ${src.path}`);
  }
  const title = fm["title"];
  if (!title) throw new Error(`kb: missing title in ${src.path}`);
  const summary = fm["summary"];
  if (!summary) throw new Error(`kb: missing summary in ${src.path}`);
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  if (body === "") throw new Error(`kb: empty body in ${src.path}`);

  if (pub === "false") return null;
  const heading = fm["topic"] === "project" ? `Project: ${title}` : title;
  return { path: src.path, text: `## ${heading}\n\n${summary}\n\n${body}\n` };
}

export function buildKb(sources: readonly KbSource[]): string {
  const entries: Entry[] = [];
  for (const s of sources) {
    const e = parseSource(s);
    if (e) entries.push(e);
  }
  entries.sort((a, b) => cmp(a.path, b.path));
  return entries.map((e) => e.text).join("\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function kbSha256(kb: string): string {
  return createHash("sha256").update(kb, "utf8").digest("hex");
}
