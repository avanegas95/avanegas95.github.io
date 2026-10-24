import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const MAX_BYTES = 300 * 1024;
const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".webm",
  ".zip",
]);

function pngSize(file: string): {
  width: number;
  height: number;
  bytes: number;
} {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
  };
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe("og image", () => {
  it("public/images/og.image.png is 1200x630 and under 300 KB", () => {
    const { width, height, bytes } = pngSize(
      join(root, "public/images/og.image.png"),
    );
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(bytes).toBeLessThan(MAX_BYTES);
  });

  it("the old src/assets copy is gone", () => {
    expect(() =>
      statSync(join(root, "src/assets/images/og.image.png")),
    ).toThrow();
  });

  it("src/ and public/ text files never mention the inspiration site's owner", () => {
    const hits: string[] = [];
    for (const dir of ["src", "public"]) {
      for (const file of walk(join(root, dir))) {
        if (BINARY.has(extname(file).toLowerCase())) continue;
        if (/oscar|hernandez/i.test(readFileSync(file, "utf8")))
          hits.push(file);
      }
    }
    for (const rel of ["LICENSE", "README.md", "package.json"]) {
      const file = join(root, rel);
      if (
        existsSync(file) &&
        /oscar|hernandez/i.test(readFileSync(file, "utf8"))
      )
        hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
