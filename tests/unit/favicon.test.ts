import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pub = (name: string): string =>
  fileURLToPath(new URL(`../../public/${name}`, import.meta.url));

function pngSize(name: string): { width: number; height: number } {
  const buf = readFileSync(pub(name));
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("favicon assets", () => {
  it("favicon-32.png is 32x32", () => {
    expect(pngSize("favicon-32.png")).toEqual({ width: 32, height: 32 });
  });

  it("apple-touch-icon.png is 180x180", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual({
      width: 180,
      height: 180,
    });
  });

  it("favicon.ico holds 16x16 and 32x32 images", () => {
    const buf = readFileSync(pub("favicon.ico"));
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    const count = buf.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => {
      const entry = 6 + 16 * i;
      return `${buf.readUInt8(entry)}x${buf.readUInt8(entry + 1)}`;
    });
    expect(sizes).toEqual(["16x16", "32x32"]);
  });

  it("favicon.svg is self-contained with no external references", () => {
    const svg = readFileSync(pub("favicon.svg"), "utf8");
    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toMatch(/viewBox="0 0 64 64"/);
    expect(svg).not.toMatch(/<(script|image|use|foreignObject|style)\b/i);
    expect(svg).not.toMatch(/href\s*=/i);
    expect(svg).not.toMatch(/url\(/i);
    expect(svg).not.toMatch(/@import/i);
    const urls = [...svg.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0]);
    expect(urls.every((u) => u === "http://www.w3.org/2000/svg")).toBe(true);
  });
});
