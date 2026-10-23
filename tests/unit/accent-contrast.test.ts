// Guards Blob's accent (--blob, default v1's teal --sec) against v1's dark background by
// resolving the real tokens from blob.css and global.css. No colour values are hard-coded.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string): string =>
  readFileSync(new URL(`../../src/styles/${p}`, import.meta.url), "utf8");
const GLOBAL = read("global.css");
const BLOB = read("blob.css");

// Resolves `--name` to a hex colour, following `var(--other)` aliases across both files.
function token(name: string, depth = 0): string {
  if (depth > 5) throw new Error(`${name}: alias loop`);
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(`${BLOB}\n${GLOBAL}`);
  if (!m) throw new Error(`${name}: not found (update the parser)`);
  const value = m[1]!.trim();
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return token(alias[1]!, depth + 1);
  if (!/^#[0-9a-fA-F]{3,6}$/.test(value)) {
    throw new Error(`${name}: expected a #hex colour, got "${value}"`);
  }
  return value;
}

function channels(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

describe("ratio helper", () => {
  it("matches the WCAG extremes", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#777", "#777")).toBeCloseTo(1, 5);
  });
});

describe("Blob accent contrast (dark only)", () => {
  const blob = token("--blob");
  const onBlob = token("--blob-contrast");
  const bg = token("--background");

  it("defaults to v1's teal (--sec)", () => {
    expect(blob.toLowerCase()).toBe(token("--sec").toLowerCase());
  });

  it("--blob on the page background is at least 3:1 (UI) and 4.5:1 (text)", () => {
    expect(ratio(blob, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("--blob-contrast on --blob is at least 3:1 (eyes) and 4.5:1 (text)", () => {
    expect(ratio(onBlob, blob)).toBeGreaterThanOrEqual(4.5);
  });

  it("neutrals used on the panel meet 4.5:1 on the background", () => {
    expect(ratio(token("--white"), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("--white-icon"), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
