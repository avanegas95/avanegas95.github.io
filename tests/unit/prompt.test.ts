import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildKb, estimateTokens, loadKbSources } from "../../src/lib/kb.ts";
import { MODEL_MOODS } from "../../src/lib/moods.ts";
import { scanText } from "../../src/lib/pii.ts";
import {
  ALLOWED_SITE_PATHS,
  PROMPT_VERSION,
  buildSystemPrompt,
  extractKbUrls,
  systemBlocks,
} from "../../src/lib/prompt.ts";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const realKb = () => buildKb(loadKbSources());

describe("buildSystemPrompt", () => {
  it("is deterministic in-process and across processes", () => {
    const kb = realKb();
    const a = buildSystemPrompt(kb);
    expect(buildSystemPrompt(kb)).toBe(a);
    const code = `
      import { buildKb, loadKbSources } from "./src/lib/kb.ts";
      import { buildSystemPrompt } from "./src/lib/prompt.ts";
      import { createHash } from "node:crypto";
      const p = buildSystemPrompt(buildKb(loadKbSources()));
      process.stdout.write(createHash("sha256").update(p, "utf8").digest("hex"));
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      cwd: resolve("."),
    });
    expect(r.stdout).toBe(sha(a));
  });

  it("contains every model mood and the KB tags", () => {
    const p = buildSystemPrompt(realKb());
    for (const m of MODEL_MOODS) expect(p).toContain(m);
    expect(p).toContain("<mood>");
    expect(p).toContain("<knowledge_base>\n");
    expect(p).toContain("\n</knowledge_base>");
    expect(PROMPT_VERSION).toBe("p5-v1");
    expect(p).toContain("confused for off-topic or unknown questions");
    expect(p).toContain("curious for open-ended or clarifying questions");
    expect(p).not.toContain("when a question is unclear");
  });

  it("is clean text: LF only, no trailing spaces", () => {
    const p = buildSystemPrompt("## A\r\n\r\nx  \r\n");
    expect(p).not.toContain("\r");
    expect(p).not.toMatch(/[ \t]$/m);
  });

  it("has no ISO datetimes, dates or UUIDs", () => {
    const p = buildSystemPrompt(realKb());
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(p).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it("lists the allowed site paths and says to see LinkedIn", () => {
    const p = buildSystemPrompt(realKb());
    for (const path of ALLOWED_SITE_PATHS) expect(p).toContain(`\`${path}\``);
    expect(p).toContain("see LinkedIn");
    expect(p).toContain("third person");
  });

  it("passes scanText with all rules", () => {
    expect(scanText(buildSystemPrompt(realKb()), "<system-prompt>")).toEqual(
      [],
    );
  });

  it("is long enough to be cacheable (2x the 512 minimum, offline proxy)", () => {
    expect(estimateTokens(buildSystemPrompt(realKb()))).toBeGreaterThanOrEqual(
      1024,
    );
  });
});

describe("p5-v1 behaviour rules", () => {
  const behaviour = () =>
    buildSystemPrompt(realKb()).split("<knowledge_base>")[0]!;

  it("is version p5-v1", () => {
    expect(PROMPT_VERSION).toBe("p5-v1");
  });

  it("points to #contact and allows the contact form (D-13 resolved)", () => {
    const b = behaviour();
    expect(b).toContain("#contact");
    expect(b).toMatch(/or the contact form in this page's contact section/i);
    expect(b).not.toMatch(/never mention or offer a contact form/i);
  });

  it("has the no-echo rule", () => {
    expect(behaviour()).toContain("not even to refuse");
  });

  it("has the to-be-confirmed rule and no authorship example", () => {
    const b = behaviour();
    expect(b).toContain("to-be-confirmed");
    expect(b).toContain("built, made, created or developed");
    expect(b).not.toContain("Anderson built");
  });

  it("has the per-project stack rule (no carry-over between projects)", () => {
    const b = behaviour();
    expect(b).toMatch(
      /build tools and stack only where the knowledge base states them for that specific project/i,
    );
    expect(b).toMatch(/never carry them over from another project/i);
    expect(b).toMatch(/stack is not confirmed, say so/i);
    // The rule stays project-neutral: no project name and no AI-assisted example.
    const rule = b.split("\n").find((l) => /carry them over/i.test(l))!;
    expect(rule).not.toMatch(/orbit hop|ai[- ]assisted/i);
  });

  it("keeps the prefix byte-stable across builds", () => {
    const kb = realKb();
    expect(buildSystemPrompt(kb)).toBe(buildSystemPrompt(kb));
    expect(behaviour()).toBe(behaviour());
  });

  it("has a concrete length cap and multi-part rule", () => {
    const b = behaviour();
    expect(b).toContain("four short sentences");
    expect(b).toContain("five short bullets");
    expect(b).toContain("one short line per part");
  });
});

describe("systemBlocks", () => {
  it("returns exactly one 1h ephemeral block", () => {
    const b = systemBlocks("x");
    expect(b).toHaveLength(1);
    expect(b[0]).toEqual({
      type: "text",
      text: "x",
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  });
});

describe("extractKbUrls", () => {
  it("strips trailing punctuation", () => {
    expect(extractKbUrls("see https://github.com/avanegas95.")).toEqual([
      "https://github.com/avanegas95",
    ]);
  });

  it("sorts and dedupes, including markdown links", () => {
    const kb =
      "[a](https://www.linkedin.com/in/avanegas95) https://github.com/avanegas95, https://github.com/avanegas95 [m](mailto:avanegas95@gmail.com)";
    expect(extractKbUrls(kb)).toEqual([
      "https://github.com/avanegas95",
      "https://www.linkedin.com/in/avanegas95",
      "mailto:avanegas95@gmail.com",
    ]);
  });
});
