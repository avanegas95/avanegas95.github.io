import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const yml = readFileSync(".github/workflows/quality.yml", "utf8");
const step = (name: string): string => {
  const i = yml.indexOf(`- name: ${name}`);
  expect(i).toBeGreaterThan(-1);
  const next = yml.indexOf("\n      - ", i + 1);
  return yml.slice(i, next === -1 ? undefined : next);
};

describe("quality.yml voice-lock steps", () => {
  it("voice:check is a blocking step between build and E2E", () => {
    const check = step("Voice lock check");
    expect(check).toContain("npm run voice:check");
    expect(check).not.toContain("continue-on-error");
    expect(check).toContain("exit 1");
    const at = (n: string) => yml.indexOf(`- name: ${n}`);
    expect(at("Build")).toBeLessThan(at("Voice lock check"));
    expect(at("Voice lock check")).toBeLessThan(at("E2E"));
  });

  it("the failure summary tells Anderson exactly what to do", () => {
    expect(step("Voice lock check")).toContain(
      "Run `npm run voice:accept` in your own terminal, then commit voice.lock.json.",
    );
  });

  it("a red voice check does not skip E2E, Lighthouse or the annotations", () => {
    for (const n of [
      "Voice lock changes",
      "E2E (chromium, firefox, webkit; includes axe)",
      "Lighthouse",
    ]) {
      expect(step(n)).toContain("if: always()");
    }
  });

  it("facts:check stays non-blocking", () => {
    expect(step("Facts check (report only)")).toContain(
      "continue-on-error: true",
    );
  });
});
