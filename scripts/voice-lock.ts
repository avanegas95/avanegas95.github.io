// Voice lock (P5.5-13c). Server/tooling only. Runs under plain `node` (type
// stripping): erasable TS only.
//
// Anderson-owned prose (VOICE_FIELDS in src/lib/kb-schema.ts, plus every KB
// body and project label) is hashed into voice.lock.json. `check` fails CI when
// any hash differs; only Anderson, in an interactive terminal, runs `accept`.
// This script never writes or rewrites prose: it only reads the KB and writes
// the lock file.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import {
  KB_ROOT,
  loadKbSources,
  parseKbSource,
  renderKbSection,
  type KbSource,
} from "../src/lib/kb.ts";
import { VOICE_FIELDS } from "../src/lib/kb-schema.ts";

export const LOCK_PATH = "voice.lock.json";
export const SITE_COPY_PATH = "docs/content-intake/site-copy.md";
// VOICE_FIELDS lists the frontmatter prose. Every KB body, and the project
// stack label, are Anderson's too (H3: all prose is locked unless he says
// otherwise for a specific field).
export const EXTRA_VOICE_FIELDS: readonly string[] = [
  "*.body",
  "projects.techLabel",
];
// kb.ts renderStructured() hard-codes headings and labels that reach Blob's
// prompt ("Ways to reach him", "Location", "Stack", ...). A synthetic render
// with fixed inputs is hashed, so changing any of them is a lock diff.
export const RENDER_LABELS_KEY = "kb.ts#render-labels";

export type Hashes = Record<string, string>;
export type Diff = { changed: string[]; added: string[]; removed: string[] };
export type Lock = { version: 1; fields: Hashes };

const sha256 = (s: string): string =>
  createHash("sha256").update(s.normalize("NFC"), "utf8").digest("hex");

// "projects/x.md" -> "projects"; otherwise the file's topic.
function topicOf(path: string, data: { topic: string }): string {
  return path.startsWith("projects/") ? "projects" : data.topic;
}

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "experience.roles[].bullets[]" -> topic "experience", /^roles\[\d+\]\.bullets\[\d+\]$/
function compile(pattern: string): { topic: string; re: RegExp } {
  const dot = pattern.indexOf(".");
  const topic = pattern.slice(0, dot);
  const rest = pattern
    .slice(dot + 1)
    .split("[]")
    .map(escapeRe)
    .join("\\[\\d+\\]");
  return { topic, re: new RegExp(`^${rest}$`) };
}

function leaves(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      leaves(v, path === "" ? k : `${path}.${k}`, out);
    }
  }
}

const head = (topic: string, extra: string[]): string =>
  [
    "---",
    `topic: ${topic}`,
    "title: t",
    "summary: s",
    "updated: 2026-01-01",
    "public: true",
    ...extra,
    "---",
    "body",
  ].join("\n");

function renderedLabels(): string {
  const samples: KbSource[] = [
    {
      path: "contact.md",
      raw: head("contact", [
        "links:",
        "  email: a@example.com",
        "  linkedin: https://www.example.com/in/x",
        "  github: https://github.com/x",
        "location: L",
      ]),
    },
    {
      path: "projects/p.md",
      raw: head("project", [
        "order: 1",
        "status: st",
        "role: r",
        "tech: [a, b]",
        "techNote: n",
      ]),
    },
    {
      path: "experience.md",
      raw: head("experience", [
        "roles:",
        "  - company: C",
        "    title: T",
        "    employment: full time",
        "    start: '2020-01'",
        "    end: null",
        "    showOnSite: true",
        "    bullets: [b]",
        "    note: n",
      ]),
    },
    {
      path: "skills.md",
      raw: head("skills", ["groups:", "  - name: G", "    items: [i]"]),
    },
  ];
  return samples.map((s) => renderKbSection(s) ?? "").join("\n---\n");
}

/** Every locked field's raw value, keyed "<file>#<fieldPath>". */
export function collectFields(sources: readonly KbSource[]): Hashes {
  const patterns = [...VOICE_FIELDS, ...EXTRA_VOICE_FIELDS].map(compile);
  const out: Hashes = {};
  for (const src of sources) {
    const file = parseKbSource(src);
    const topic = topicOf(file.path, file.data);
    const all: [string, string][] = [];
    leaves(file.data, "", all);
    if (file.body !== "") all.push(["body", file.body]);
    for (const [path, value] of all) {
      const locked = patterns.some(
        (p) => (p.topic === "*" || p.topic === topic) && p.re.test(path),
      );
      if (locked) out[`${file.path}#${path}`] = value;
    }
  }
  out[RENDER_LABELS_KEY] = renderedLabels();
  return out;
}

export function hashFields(kbRoot: string = KB_ROOT): Hashes {
  const values = collectFields(loadKbSources(kbRoot));
  const out: Hashes = {};
  for (const k of Object.keys(values).sort()) {
    out[k] = sha256(values[k] as string);
  }
  return out;
}

export function diffLock(lock: Hashes, current: Hashes): Diff {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const k of Object.keys(current).sort()) {
    if (!(k in lock)) added.push(k);
    else if (lock[k] !== current[k]) changed.push(k);
  }
  for (const k of Object.keys(lock).sort()) {
    if (!(k in current)) removed.push(k);
  }
  return { changed, added, removed };
}

export const isClean = (d: Diff): boolean =>
  d.changed.length + d.added.length + d.removed.length === 0;

function readLock(path: string): Lock {
  const j = JSON.parse(readFileSync(path, "utf8")) as Lock;
  if (j.version !== 1 || typeof j.fields !== "object") {
    throw new Error(`${path}: not a voice lock (version 1)`);
  }
  return j;
}

function writeLock(path: string, fields: Hashes): void {
  const sorted: Hashes = {};
  for (const k of Object.keys(fields).sort()) sorted[k] = fields[k] as string;
  writeFileSync(
    path,
    `${JSON.stringify({ version: 1, fields: sorted }, null, 2)}\n`,
  );
}

const squash = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Whether `value` appears verbatim (whitespace-normalised) in the site copy. */
export function inSiteCopy(value: string, siteCopy: string): boolean {
  const v = squash(value);
  return v !== "" && squash(siteCopy).includes(v);
}

export type AcceptIo = {
  ask: (question: string) => Promise<string>;
  out: (line: string) => void;
};

export type AcceptInput = {
  lock: Hashes;
  currentValues: Hashes; // raw values
  oldValues: Hashes | null; // raw values at the last lock commit, if known
  siteCopy: string;
};

/** Shows every diff old -> new; returns the new hashes only if `accept` is typed. */
export async function acceptFlow(
  inp: AcceptInput,
  io: AcceptIo,
): Promise<{ result: "nothing" | "declined" | "accepted"; fields?: Hashes }> {
  const current: Hashes = {};
  for (const [k, v] of Object.entries(inp.currentValues)) {
    current[k] = sha256(v);
  }
  const d = diffLock(inp.lock, current);
  if (isClean(d)) {
    io.out("Nothing to accept: the KB prose already matches voice.lock.json.");
    return { result: "nothing" };
  }
  const verbatim = (v: string) =>
    `  in site-copy.md verbatim: ${inSiteCopy(v, inp.siteCopy) ? "yes" : "NO"}\n`;
  const total = d.changed.length + d.added.length + d.removed.length;
  io.out(`${total} locked field(s) differ from voice.lock.json:\n`);
  for (const k of d.changed) {
    const next = inp.currentValues[k] as string;
    const old =
      inp.oldValues?.[k] ??
      `(text unavailable; lock hash ${(inp.lock[k] as string).slice(0, 12)})`;
    io.out(`CHANGED ${k}\n  old: ${old}\n  new: ${next}\n${verbatim(next)}`);
  }
  for (const k of d.added) {
    const next = inp.currentValues[k] as string;
    io.out(`ADDED ${k}\n  new: ${next}\n${verbatim(next)}`);
  }
  for (const k of d.removed) {
    io.out(
      `REMOVED ${k}\n  old: ${inp.oldValues?.[k] ?? "(text unavailable)"}\n`,
    );
  }
  const answer = (
    await io.ask(
      "Type 'accept' to lock all of the above (anything else cancels): ",
    )
  ).trim();
  if (answer !== "accept") {
    io.out("Not accepted. voice.lock.json is unchanged.");
    return { result: "declined" };
  }
  return { result: "accepted", fields: current };
}

/** Raw values of the KB as of the commit that last changed the lock (best effort). */
function oldValuesFromGit(lockPath: string, kbRoot: string): Hashes | null {
  try {
    const git = (a: string[]) =>
      execFileSync("git", a, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    const rev = git(["log", "-1", "--format=%H", "--", lockPath]).trim();
    if (rev === "") return null;
    const sources = loadKbSources(kbRoot).flatMap((s): KbSource[] => {
      try {
        return [
          { path: s.path, raw: git(["show", `${rev}:./${kbRoot}/${s.path}`]) },
        ];
      } catch {
        return [];
      }
    });
    return collectFields(sources);
  } catch {
    return null;
  }
}

export const USAGE = `voice-lock: guards Anderson's prose in the knowledge base.

Usage
  npm run voice:check    Anyone/CI: exit 1 if locked prose differs from voice.lock.json
  npm run voice:accept   Anderson only: review each change (old -> new), type "accept"
  npm run voice:init     Once: snapshot the current, already-approved prose

Typical flow
  1. Someone edits prose under src/content/knowledge/.
  2. voice:check fails and names the fields, e.g. experience.md#roles[0].bullets[2].
  3. Anderson runs \`npm run voice:accept\` in his own terminal. It prints each
     old -> new pair (and whether the new text is verbatim in
     docs/content-intake/site-copy.md). He types "accept", then commits voice.lock.json.

voice:accept refuses non-interactive shells (no TTY, or CI set), so agents cannot run it.
Options: --lock <file> (default ${LOCK_PATH})  --kb <dir> (default ${KB_ROOT})  --site-copy <file>  --help
Exit codes: 0 ok, 1 prose differs (check) or accept declined, 2 usage/config error or refused.
`;

function opt(argv: string[], name: string, dflt: string): string {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : (argv[i + 1] ?? dflt);
}

const isCi = (env: NodeJS.ProcessEnv): boolean => {
  const v = (env["CI"] ?? "").toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
};

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  isTty: boolean,
  log: (s: string) => void = console.log,
  err: (s: string) => void = console.error,
): Promise<number> {
  const mode = argv[0];
  if (mode === undefined) {
    log(USAGE);
    return 2;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return 0;
  }
  const lockPath = opt(argv, "--lock", LOCK_PATH);
  const kbRoot = opt(argv, "--kb", KB_ROOT);
  const siteCopyPath = opt(argv, "--site-copy", SITE_COPY_PATH);
  try {
    if (mode === "init") {
      if (existsSync(lockPath)) {
        err(
          `${lockPath} already exists; refusing to overwrite. Use \`npm run voice:accept\` to update it.`,
        );
        return 2;
      }
      const h = hashFields(kbRoot);
      writeLock(lockPath, h);
      log(`Wrote ${lockPath} with ${Object.keys(h).length} locked fields.`);
      return 0;
    }
    if (mode !== "check" && mode !== "accept") {
      err(`Unknown mode "${mode}".\n\n${USAGE}`);
      return 2;
    }
    if (mode === "accept" && (!isTty || isCi(env))) {
      err(
        "voice:accept needs an interactive terminal and no CI variable: it is for Anderson only.\n" +
          "Run `npm run voice:accept` yourself in a normal terminal. Nothing was changed.",
      );
      return 2;
    }
    if (!existsSync(lockPath)) {
      err(
        `${lockPath} not found. Run \`npm run voice:init\` once to create it.`,
      );
      return 2;
    }
    const lock = readLock(lockPath);
    if (mode === "check") {
      const d = diffLock(lock.fields, hashFields(kbRoot));
      if (isClean(d)) {
        log("voice:check ok: locked prose matches voice.lock.json.");
        return 0;
      }
      for (const k of d.changed) err(`changed: ${k}`);
      for (const k of d.added) err(`added:   ${k}`);
      for (const k of d.removed) err(`removed: ${k}`);
      err(
        "Locked prose differs from voice.lock.json. Only Anderson accepts this: `npm run voice:accept`.",
      );
      return 1;
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const siteCopy = existsSync(siteCopyPath)
        ? readFileSync(siteCopyPath, "utf8")
        : "";
      const res = await acceptFlow(
        {
          lock: lock.fields,
          currentValues: collectFields(loadKbSources(kbRoot)),
          oldValues: oldValuesFromGit(lockPath, kbRoot),
          siteCopy,
        },
        { ask: (q) => rl.question(q), out: log },
      );
      if (res.result === "accepted" && res.fields) {
        writeLock(lockPath, res.fields);
        log(`Updated ${lockPath}. Commit it with your KB change.`);
      }
      return res.result === "declined" ? 1 : 0;
    } finally {
      rl.close();
    }
  } catch (e) {
    err(`voice-lock: ${(e as Error).message}`);
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(
    process.argv.slice(2),
    process.env,
    Boolean(process.stdin.isTTY),
  );
}
