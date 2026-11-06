import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 7: the resume URL serves Anderson's current public-safe PDF. It is a static file,
// not a redirect, and guard:pii scans its text (see pii-guard-cli.test.ts).
const RESUME = "/Anderson_Vanegas_Resume.pdf";
const STATIC = ".vercel/output/static";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("legacy resume URL", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    redirects?: { source: string }[];
  };

  it("vercel.json has no rule redirecting the resume path", () => {
    expect(
      (config.redirects ?? []).filter((r) => r.source === RESUME),
    ).toHaveLength(0);
  });

  it("the PDF source is public/Anderson_Vanegas_Resume.pdf and is the only PDF", () => {
    expect(existsSync(`public${RESUME}`)).toBe(true);
    expect(listFiles("public").filter((f) => /\.pdf$/i.test(f))).toEqual([
      `public${RESUME}`,
    ]);
  });

  it.skipIf(!existsSync(STATIC))(
    "the build output contains exactly the resume PDF",
    () => {
      expect(existsSync(`${STATIC}${RESUME}`)).toBe(true);
      expect(listFiles(STATIC).filter((f) => /\.pdf$/i.test(f))).toEqual([
        `${STATIC}${RESUME}`,
      ]);
    },
  );
});
