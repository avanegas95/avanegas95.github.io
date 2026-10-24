import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 7: the old PII-bearing resume PDF must never be served; the legacy URL 302s to
// LinkedIn until a clean PDF exists.
const RESUME = "/Anderson_Vanegas_Resume.pdf";
const LINKEDIN = "https://www.linkedin.com/in/avanegas95";
const STATIC = ".vercel/output/static";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("legacy resume URL", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    redirects: { source: string; destination: string; statusCode?: number }[];
  };

  it("vercel.json has exactly one rule for the resume path", () => {
    expect(config.redirects.filter((r) => r.source === RESUME)).toHaveLength(1);
  });

  it("is a temporary 302 to LinkedIn (not 301/308, so a clean PDF can replace it)", () => {
    const rule = config.redirects.find((r) => r.source === RESUME);
    expect(rule?.statusCode).toBe(302);
    expect(rule?.destination).toBe(LINKEDIN);
  });

  it("no PDF source exists under public/", () => {
    expect(existsSync(`public${RESUME}`)).toBe(false);
    expect(listFiles("public").filter((f) => /\.pdf$/i.test(f))).toEqual([]);
  });

  it.skipIf(!existsSync(STATIC))(
    "the build output contains no PDF at all",
    () => {
      expect(existsSync(`${STATIC}${RESUME}`)).toBe(false);
      expect(listFiles(STATIC).filter((f) => /\.pdf$/i.test(f))).toEqual([]);
    },
  );
});
