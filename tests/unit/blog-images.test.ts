import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const POSTS = "src/content/blog";
const posts = readdirSync(POSTS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const raw = readFileSync(`${POSTS}/${f}`, "utf8");
    const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "";
    return {
      file: f,
      draft: /^draft:\s*true\s*$/m.test(fm),
      cover: /^\s+src:\s*"([^"]+)"/m.exec(fm)?.[1],
    };
  });

describe("blog images", () => {
  it("every file under public/images/blog/ is referenced by a published post", () => {
    const dir = "public/images/blog";
    const files = existsSync(dir) ? readdirSync(dir) : [];
    const published = posts
      .filter((p) => !p.draft && p.cover)
      .map((p) => p.cover as string);
    for (const f of files) {
      expect(
        published.some((c) => c.endsWith(`/${f}`)),
        `${f} is only used by drafts or nothing`,
      ).toBe(true);
    }
  });

  it("no blog image lives loose in public/images", () => {
    expect(existsSync("public/images/blog-placeholder.jpg")).toBe(false);
  });

  it("covers are imported from src/assets (optimised by astro:assets)", () => {
    for (const p of posts.filter((p) => p.cover)) {
      expect(p.cover, p.file).toMatch(/^\.\.\/\.\.\/assets\/blog\//);
      expect(existsSync(`${POSTS}/${p.cover}`), p.file).toBe(true);
    }
  });
});
