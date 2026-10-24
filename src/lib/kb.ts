// Server/tooling only. Must run under plain `node` (type stripping): erasable TS only.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isScalar,
  parseDocument,
  visit,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
} from "yaml";
import {
  KnowledgeSchema,
  ProjectSchema,
  YEAR_MONTH_KEYS,
  type Knowledge,
  type Project,
  type Role,
} from "./kb-schema.ts";

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

// Frontmatter is parsed with the same YAML library and options as Astro's
// content collections (core schema, timestamps), plus unique keys, then
// validated with the shared schema in kb-schema.ts. A parity test proves both
// paths yield equal data. Anything invalid throws with the file path.
const YAML_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  customTags: ["timestamp"],
  merge: true,
  schema: "core",
  uniqueKeys: true,
  prettyErrors: false,
};

export type KbFile = {
  readonly path: string;
  readonly data: Knowledge | Project;
  readonly body: string;
};

function fail(path: string, why: string): never {
  throw new Error(`kb: ${why} in ${path}`);
}

function parseYaml(src: string, path: string): unknown {
  const doc = parseDocument(src, YAML_OPTIONS);
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem) fail(path, `invalid frontmatter (${problem.message})`);
  const noTagOrAnchor = (n: { tag?: string; anchor?: string }) => {
    if (n.tag || n.anchor) fail(path, "YAML tag or anchor in frontmatter");
  };
  visit(doc, {
    Alias() {
      fail(path, "YAML alias in frontmatter");
    },
    Collection(_, node) {
      noTagOrAnchor(node);
    },
    Scalar(_, node) {
      noTagOrAnchor(node);
      // An unquoted " #" silently truncates a value; make the author quote it.
      if (node.comment) fail(path, "inline comment in frontmatter; quote it");
    },
    Pair(_, pair) {
      const key = isScalar(pair.key) ? pair.key.value : null;
      const v = pair.value;
      if (
        (YEAR_MONTH_KEYS as readonly unknown[]).includes(key) &&
        isScalar(v) &&
        v.value !== null &&
        v.type !== "QUOTE_DOUBLE" &&
        v.type !== "QUOTE_SINGLE"
      ) {
        fail(path, `${String(key)} must be a quoted "YYYY-MM" string`);
      }
    },
  });
  try {
    return doc.toJS();
  } catch (e) {
    return fail(path, `invalid frontmatter (${(e as Error).message})`);
  }
}

export function parseKbSource(src: KbSource): KbFile {
  const stripped = src.raw.startsWith(BOM) ? src.raw.slice(1) : src.raw;
  const lines = stripped.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---") fail(src.path, "missing frontmatter");
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (end === -1) fail(src.path, "missing frontmatter");

  const raw = parseYaml(lines.slice(1, end).join("\n"), src.path);
  const schema = src.path.startsWith("projects/")
    ? ProjectSchema
    : KnowledgeSchema;
  const res = schema.safeParse(raw ?? {});
  if (!res.success) {
    const why = res.error.issues
      .map((i) => `${i.path.join(".") || "frontmatter"}: ${i.message}`)
      .join("; ");
    fail(src.path, `invalid frontmatter (${why})`);
  }
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  return { path: src.path, data: res.data, body };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function month(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

const list = (items: readonly string[]): string =>
  items.map((i) => `- ${i}`).join("\n");

function renderRole(r: Role): string {
  const kind = r.employment ? ` (${r.employment})` : "";
  const to = r.end === null ? "present" : month(r.end);
  const parts = [
    `### ${r.company}: ${r.title}${kind}, ${month(r.start)} to ${to}`,
  ];
  if (r.bullets.length > 0) parts.push(list(r.bullets));
  if (r.note) parts.push(r.note);
  return parts.join("\n\n");
}

const display = (url: string): string =>
  url.replace(/^https:\/\/(?:www\.)?/, "");

// Renders the structured frontmatter back to the markdown it replaced, so the
// prompt stays byte-identical (per-file goldens in tests/fixtures/kb/golden).
function renderStructured(d: Knowledge | Project): string[] {
  switch (d.topic) {
    case "experience":
      return (d.roles ?? []).map(renderRole);
    case "skills":
      return (d.groups ?? []).map((g) => `### ${g.name}\n\n${list(g.items)}`);
    case "contact": {
      const out: string[] = [];
      const l = d.links;
      if (l) {
        out.push(
          "### Ways to reach him",
          list([
            `Email: [${l.email}](mailto:${l.email})`,
            `LinkedIn: [${display(l.linkedin)}](${l.linkedin})`,
            `GitHub: [${display(l.github)}](${l.github})`,
          ]),
        );
      }
      if (d.location) out.push("### Location", `${d.location}.`);
      return out;
    }
    case "project": {
      const note = d.techNote ? ` (${d.techNote})` : "";
      return [
        `**Status:** ${d.status} · **Role:** ${d.role} · **${d.techLabel}:** ${d.tech.join(", ")}${note}`,
      ];
    }
    default:
      return [];
  }
}

/** One file's prompt section, or null when the file is not public. */
export function renderKbSection(src: KbSource): string | null {
  const { data, body } = parseKbSource(src);
  const content = [...renderStructured(data), body].filter((p) => p !== "");
  if (content.length === 0) fail(src.path, "empty body");
  if (!data.public) return null;
  const heading =
    data.topic === "project" ? `Project: ${data.title}` : data.title;
  return `## ${heading}\n\n${data.summary}\n\n${content.join("\n\n")}\n`;
}

export function buildKb(sources: readonly KbSource[]): string {
  return [...sources]
    .sort((a, b) => cmp(a.path, b.path))
    .map(renderKbSection)
    .filter((t): t is string => t !== null)
    .join("\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function kbSha256(kb: string): string {
  return createHash("sha256").update(kb, "utf8").digest("hex");
}
