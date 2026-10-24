import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KB_ROOT, loadKbSources } from "../../src/lib/kb.ts";
import {
  RENDER_LABELS_KEY,
  acceptFlow,
  collectFields,
  diffLock,
  hashFields,
  inSiteCopy,
  main,
  makeMeta,
} from "../../scripts/voice-lock.ts";

vi.setConfig({ testTimeout: 60_000 });

let dir = "";
let kb = "";
let lock = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "voice-lock-"));
  kb = join(dir, "kb");
  lock = join(dir, "voice.lock.json");
  cpSync(KB_ROOT, kb, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = async (args: string[], env: NodeJS.ProcessEnv = {}, tty = true) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(
    [...args, "--lock", lock, "--kb", kb],
    env,
    tty,
    (s) => out.push(s),
    (s) => err.push(s),
  );
  return { code, out: out.join("\n"), err: err.join("\n") };
};

// Test edits touch a temp copy of the KB and only append markers; they never
// author prose.
const BULLET = "Owns triage for nightly Hardware-in-the-Loop";
const edit = (file: string, from: string, to: string) => {
  const p = join(kb, file);
  const s = readFileSync(p, "utf8");
  expect(s).toContain(from);
  writeFileSync(p, s.replace(from, to));
};

describe("voice-lock hashFields", () => {
  it("covers bullets, summaries, bodies and project fields as file#path", () => {
    const keys = Object.keys(hashFields(kb));
    expect(keys).toContain("experience.md#roles[0].bullets[2]");
    expect(keys).toContain("bio.md#summary");
    expect(keys).toContain("faq.md#body");
    expect(keys).toContain("projects/orbit-hop.md#role");
    expect(keys).toContain("projects/orbit-hop.md#techNote");
    expect(keys).toContain("projects/orbit-hop.md#body");
    expect(keys).toContain(RENDER_LABELS_KEY);
    // Structure (titles, dates, tech lists) is not prose.
    expect(keys.some((k) => k.endsWith("#roles[0].title"))).toBe(false);
    expect(keys.some((k) => k.endsWith("#tech[0]"))).toBe(false);
  });

  it("locks the headings and labels hard-coded in kb.ts renderStructured", () => {
    const labels = collectFields(loadKbSources(kb))[RENDER_LABELS_KEY];
    for (const l of [
      "Ways to reach him",
      "Location",
      "Stack",
      "Role:",
      "Status:",
    ]) {
      expect(labels).toContain(l);
    }
  });

  it("hashes the NFC-normalised value: composed and decomposed forms agree", () => {
    const composed = hashFields(kb);
    const raw = readFileSync(join(kb, "bio.md"), "utf8");
    const m = /^summary: (.*)$/m.exec(raw);
    expect(m).not.toBeNull();
    const line = m![0];
    const value = m![1] as string;
    // Force a difference at the byte level: NFD form of the same text.
    const nfd = value.normalize("NFD");
    writeFileSync(join(kb, "bio.md"), raw.replace(line, `summary: ${nfd}`));
    expect(diffLock(composed, hashFields(kb)).changed).toEqual([]);
  });
});

describe("voice-lock diffLock", () => {
  it.each([
    [
      "changed",
      { a: "1" },
      { a: "2" },
      { changed: ["a"], added: [], removed: [] },
    ],
    [
      "added",
      { a: "1" },
      { a: "1", b: "2" },
      { changed: [], added: ["b"], removed: [] },
    ],
    [
      "removed",
      { a: "1", b: "2" },
      { a: "1" },
      { changed: [], added: [], removed: ["b"] },
    ],
    ["same", { a: "1" }, { a: "1" }, { changed: [], added: [], removed: [] }],
  ])("%s", (_n, l, c, want) => {
    expect(diffLock(l, c)).toEqual(want);
  });
});

describe("voice-lock check / init", () => {
  it("check passes on an untouched KB right after init", async () => {
    expect((await run(["init"])).code).toBe(0);
    expect((await run(["check"])).code).toBe(0);
  });

  it("editing one bullet makes check exit 1 and name that field", async () => {
    await run(["init"]);
    edit("experience.md", BULLET, `${BULLET} (edited)`);
    const r = await run(["check"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("experience.md#roles[0].bullets[2]");
    expect(r.err.match(/^changed:/gm)).toHaveLength(1);
  });

  it("a whitespace-only YAML reflow of a bullet is not a diff", async () => {
    await run(["init"]);
    const p = join(kb, "experience.md");
    const lines = readFileSync(p, "utf8").split("\n");
    const i = lines.findIndex((l) => l.includes(BULLET));
    const value = JSON.parse(lines[i]!.replace(/^\s*- /, "")) as string;
    const words = value.split(" ");
    const folded: string[] = [];
    for (let w = 0; w < words.length; w += 6) {
      folded.push(`        ${words.slice(w, w + 6).join(" ")}`);
    }
    lines.splice(i, 1, "      - >-", ...folded);
    writeFileSync(p, lines.join("\n"));
    expect(readFileSync(p, "utf8")).not.toContain(`"${value}"`);
    expect((await run(["check"])).code).toBe(0);
  });

  it("any body whitespace edit is a diff", async () => {
    await run(["init"]);
    edit("faq.md", "### What does HIL", "###  What does HIL");
    expect((await run(["check"])).err).toContain("faq.md#body");
  });

  it.each([
    ["no TTY", {}, false],
    ["CI set", { CI: "true" }, true],
  ])(
    "init refuses with %s: exit 2 and no lock is written",
    async (_n, env, tty) => {
      const r = await run(["init"], env, tty);
      expect(r.code).toBe(2);
      expect(r.err).toContain("interactive terminal");
      expect(existsSync(lock)).toBe(false);
    },
  );

  it("init stamps the lock with metadata", async () => {
    await run(["init"]);
    const j = JSON.parse(readFileSync(lock, "utf8"));
    expect(j.meta.action).toBe("init");
    expect(Date.parse(j.meta.acceptedAt)).not.toBeNaN();
    expect(j.meta.changed).toEqual([]);
  });

  it("makeMeta for accept lists changed, added and removed fields", () => {
    const m = makeMeta(
      "accept",
      { a: "1", b: "1", c: "1" },
      { a: "2", b: "1", d: "1" },
      new Date(0),
    );
    expect(m).toEqual({
      action: "accept",
      acceptedAt: "1970-01-01T00:00:00.000Z",
      changed: ["a", "d", "c"],
    });
  });

  it("init refuses to overwrite an existing lock", async () => {
    await run(["init"]);
    const before = readFileSync(lock, "utf8");
    edit("experience.md", BULLET, `${BULLET} (edited)`);
    const r = await run(["init"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("already exists");
    expect(readFileSync(lock, "utf8")).toBe(before);
  });

  it("check without a lock tells the user to run voice:init", async () => {
    const r = await run(["check"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("voice:init");
  });

  it("--help prints usage naming all three commands", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    for (const c of ["voice:check", "voice:accept", "voice:init"]) {
      expect(r.out).toContain(c);
    }
  });
});

describe("voice-lock accept", () => {
  it.each([
    ["no TTY", {}, false],
    ["CI set", { CI: "true" }, true],
  ])("refuses with %s: exit 2, lock unchanged", async (_n, env, tty) => {
    await run(["init"]);
    edit("experience.md", BULLET, `${BULLET} (edited)`);
    const before = readFileSync(lock, "utf8");
    const r = await run(["accept"], env, tty);
    expect(r.code).toBe(2);
    expect(r.err).toContain("interactive terminal");
    expect(readFileSync(lock, "utf8")).toBe(before);
  });

  it("the real CLI with a piped stdin exits 2 even if 'accept' is typed", async () => {
    await run(["init"]);
    edit("experience.md", BULLET, `${BULLET} (edited)`);
    const before = readFileSync(lock, "utf8");
    const env = { ...process.env };
    delete env["CI"];
    const r = spawnSync(
      process.execPath,
      [resolve("scripts/voice-lock.ts"), "accept", "--lock", lock, "--kb", kb],
      { input: "accept\n", encoding: "utf8", env, timeout: 45_000 },
    );
    expect(r.status).toBe(2);
    expect(readFileSync(lock, "utf8")).toBe(before);
  });

  const sha = (v: string) =>
    createHash("sha256").update(v.normalize("NFC"), "utf8").digest("hex");
  const input = (
    values: Record<string, string>,
    old: Record<string, string>,
  ) => ({
    lock: Object.fromEntries(Object.entries(old).map(([k, v]) => [k, sha(v)])),
    currentValues: values,
    oldValues: old,
    siteCopy: "The  site says\n hello there.",
  });

  it("says there is nothing to accept when the lock is current", async () => {
    const out: string[] = [];
    const r = await acceptFlow(input({ "a.md#x": "v" }, { "a.md#x": "v" }), {
      ask: () => Promise.reject(new Error("must not prompt")),
      out: (s) => out.push(s),
    });
    expect(r.result).toBe("nothing");
    expect(out.join("\n")).toContain("Nothing to accept");
  });

  it("shows old -> new with a verbatim marker and only accepts the word 'accept'", async () => {
    const out: string[] = [];
    const data = input(
      { "a.md#x": "hello there.", "a.md#y": "other" },
      { "a.md#x": "old text", "a.md#y": "other" },
    );
    const declined = await acceptFlow(data, {
      ask: async () => "yes",
      out: (s) => out.push(s),
    });
    expect(declined.result).toBe("declined");
    const shown = out.join("\n");
    expect(shown).toContain("CHANGED a.md#x");
    expect(shown).toContain("old: old text");
    expect(shown).toContain("new: hello there.");
    expect(shown).toContain("verbatim: yes");
    expect(shown).not.toContain("a.md#y");

    const ok = await acceptFlow(data, {
      ask: async () => " accept ",
      out: () => {},
    });
    expect(ok.result).toBe("accepted");
    expect(Object.keys(ok.fields ?? {}).sort()).toEqual(["a.md#x", "a.md#y"]);
  });

  it("shows old text only when it hashes to the lock value", async () => {
    const out: string[] = [];
    const data = input({ "a.md#x": "new" }, { "a.md#x": "old" });
    // oldValues from a different commit than the lock was made at.
    await acceptFlow(
      { ...data, oldValues: { "a.md#x": "some other text" } },
      { ask: async () => "no", out: (s) => out.push(s) },
    );
    const shown = out.join("\n");
    expect(shown).toContain("old: unavailable (lock commit not in history)");
    expect(shown).not.toContain("some other text");
    const ok: string[] = [];
    await acceptFlow(data, { ask: async () => "no", out: (s) => ok.push(s) });
    expect(ok.join("\n")).toContain("old: old\n");
  });

  it("flags text that is not in site-copy.md", async () => {
    const out: string[] = [];
    await acceptFlow(input({ "a.md#x": "brand new" }, { "a.md#x": "old" }), {
      ask: async () => "no",
      out: (s) => out.push(s),
    });
    expect(out.join("\n")).toContain("verbatim: NO");
  });

  it("inSiteCopy ignores whitespace differences only", () => {
    expect(inSiteCopy("site says hello", "The  site\nsays  hello there")).toBe(
      true,
    );
    expect(inSiteCopy("site says goodbye", "The site says hello")).toBe(false);
    expect(inSiteCopy("", "anything")).toBe(false);
  });
});
