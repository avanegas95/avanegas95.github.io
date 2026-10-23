import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("astro.config.mjs", "utf8");

describe("astro.config.mjs", () => {
  it("uses the vercel adapter", () => {
    expect(src).toMatch(/import vercel from "@astrojs\/vercel"/);
    expect(src).toMatch(/adapter:\s*vercel\(\)/);
  });

  it("is static output (on-demand routes opt out per page)", () => {
    expect(src).toMatch(/output:\s*"static"/);
  });

  it("keeps the react integration and aliases", () => {
    expect(src).toMatch(/integrations:\s*\[react\(\)\]/);
    expect(src).toContain('"@": "/src"');
  });

  it("never inlines assets into HTML (script-src 'self')", () => {
    expect(src).toMatch(/assetsInlineLimit:\s*0/);
  });
});

describe("toolchain", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    engines: { node: string };
    scripts: Record<string, string>;
  };

  it("pins Node 24", () => {
    expect(readFileSync(".nvmrc", "utf8").trim()).toBe("24");
    expect(pkg.engines.node).toBe(">=24");
    expect(readFileSync("scripts/check-node.mjs", "utf8")).toContain(
      'const minimum = "24.0.0"',
    );
  });

  it("has every script later tasks need", () => {
    for (const s of [
      "dev",
      "build",
      "lint",
      "typecheck",
      "test",
      "test:e2e",
      "lhci",
      "guard:pii",
      "check:bundle",
      "eval",
      "eval:dry",
    ]) {
      expect(pkg.scripts[s], s).toBeTruthy();
    }
    expect(pkg.scripts["build"]).toBe("astro check && astro build");
    expect(pkg.scripts["typecheck"]).toBe("astro check && tsc --noEmit");
    expect(pkg.scripts["test"]).toBe("vitest run");
  });
});
