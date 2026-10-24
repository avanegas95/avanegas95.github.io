// CI: make every voice.lock.json change visible in review (P5.5-13c).
// Usage: node scripts/ci/voice-lock-annotate.ts <base-sha>
// Compares the lock at <base-sha> with the working tree and prints one GitHub
// annotation per changed field, plus a job summary. Exit 0 always: this is
// visibility, not the gate; reviewers decide on the visible lock diff.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { diffLock, type Hashes } from "../voice-lock.ts";

export function lockChanges(oldFields: Hashes, newFields: Hashes): string[] {
  const d = diffLock(oldFields, newFields);
  return [
    ...d.changed.map((k) => `changed: ${k}`),
    ...d.added.map((k) => `added: ${k}`),
    ...d.removed.map((k) => `removed: ${k}`),
  ];
}

export function annotations(lines: string[]): string[] {
  return lines.map(
    (l) => `::warning file=voice.lock.json,title=Voice lock changed::${l}`,
  );
}

function main(base: string | undefined): void {
  const path = "voice.lock.json";
  if (!base || /^0+$/.test(base) || !existsSync(path)) return;
  let before: Hashes = {};
  try {
    const old = execFileSync("git", ["show", `${base}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    before = (JSON.parse(old) as { fields: Hashes }).fields;
  } catch {
    // New lock or base not fetched: every field shows as added.
  }
  const now = (JSON.parse(readFileSync(path, "utf8")) as { fields: Hashes })
    .fields;
  const lines = lockChanges(before, now);
  if (lines.length === 0) return;
  for (const a of annotations(lines)) console.log(a);
  const summary = [
    "### voice.lock.json changed",
    "Only Anderson accepts these. Review the lock diff:",
    ...lines.map((l) => `- \`${l}\``),
    "",
  ].join("\n");
  const out = process.env["GITHUB_STEP_SUMMARY"];
  if (out) appendFileSync(out, summary);
  else console.log(summary);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv[2]);
}
