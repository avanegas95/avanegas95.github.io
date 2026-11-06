import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AdMob verifies this file by URL (CLAUDE.md rule 7): it must stay byte-exact.
const APP_ADS = "google.com, pub-2112756252403033, DIRECT, f08c47fec0942fa0\n";
const BUILT = ".vercel/output/static/app-ads.txt";

describe("app-ads.txt", () => {
  it("source file in public/ is the exact AdMob line", () => {
    expect(readFileSync("public/app-ads.txt", "utf8")).toBe(APP_ADS);
  });

  it("is a single well-formed ads.txt record (domain, publisher id, relationship, cert id)", () => {
    const lines = APP_ADS.trim().split("\n");
    expect(lines).toHaveLength(1);
    const fields = (lines[0] ?? "").split(",").map((f) => f.trim());
    expect(fields).toHaveLength(4);
    expect(fields[0]).toBe("google.com");
    expect(fields[1]).toMatch(/^pub-\d{16}$/);
    expect(fields[2]).toBe("DIRECT");
    expect(fields[3]).toMatch(/^[0-9a-f]{16}$/);
  });

  it.skipIf(!existsSync(BUILT))("the build ships it unchanged", () => {
    expect(readFileSync(BUILT, "utf8")).toBe(APP_ADS);
  });

  it("vercel.json does not redirect or rewrite it away", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      redirects?: { source: string }[];
      rewrites?: { source: string }[];
    };
    for (const r of [...(config.redirects ?? []), ...(config.rewrites ?? [])])
      expect(r.source).not.toContain("app-ads");
  });
});
