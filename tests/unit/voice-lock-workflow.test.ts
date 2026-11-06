import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const yml = readFileSync(".github/workflows/quality.yml", "utf8");
/** One job's block, from `  <id>:` to the next job. */
const jobBlock = (id: string): string => {
  const i = yml.indexOf(`\n  ${id}:\n`);
  expect(i, id).toBeGreaterThan(-1);
  const next = yml.slice(i + 1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? yml.slice(i) : yml.slice(i, i + 1 + next);
};
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
    // Voice lives in the checks job; E2E and Lighthouse are separate jobs that
    // depend only on the build, so a red voice check can't skip them.
    for (const n of [
      "Voice lock changes",
      "Voice lock check",
      "Facts check (report only)",
    ]) {
      expect(step(n)).toContain("if: always()");
    }
    for (const job of ["e2e", "lighthouse"]) {
      expect(jobBlock(job)).toMatch(/\n {4}needs: build\n/);
    }
  });

  it("facts:check stays non-blocking", () => {
    expect(step("Facts check (report only)")).toContain(
      "continue-on-error: true",
    );
  });
});

describe("quality.yml tiers", () => {
  it("pushes run the fast tier; pull requests and manual runs run the full tier", () => {
    expect(yml).toContain("workflow_dispatch:");
    expect(jobBlock("e2e")).toContain(
      `browser: \${{ fromJSON(github.event_name == 'push' && '["chromium"]' || '["chromium","firefox","webkit"]') }}`,
    );
    expect(jobBlock("lighthouse")).toContain("if: github.event_name != 'push'");
  });

  it("each E2E job runs only its own browser", () => {
    expect(step("E2E (includes axe)")).toContain(
      "--project=${{ matrix.browser }}",
    );
    expect(step("E2E (includes axe)")).toContain(
      "${{ matrix.browser == 'webkit' && '--workers=2' || '' }}",
    );
  });
});

describe("quality.yml parallel jobs", () => {
  it("builds once and shares the output with unit, E2E and Lighthouse", () => {
    expect(jobBlock("build")).toContain("name: build-output");
    for (const job of ["unit", "e2e", "lighthouse"]) {
      expect(jobBlock(job)).toMatch(/\n {4}needs: build\n/);
      expect(jobBlock(job)).toContain("actions/download-artifact@v4");
    }
  });

  it("checks start without waiting for the build", () => {
    expect(jobBlock("checks")).not.toContain("needs:");
  });

  it("every job has a short timeout so a stalled install fails fast", () => {
    for (const job of ["build", "checks", "unit", "e2e", "lighthouse"]) {
      expect(jobBlock(job)).toContain("timeout-minutes: 15");
    }
  });
});

describe("quality.yml Playwright container", () => {
  it("E2E and Lighthouse run in the Playwright image matching @playwright/test", () => {
    const version = JSON.parse(
      readFileSync("node_modules/@playwright/test/package.json", "utf8"),
    ).version as string;
    for (const job of ["e2e", "lighthouse"]) {
      expect(jobBlock(job)).toContain(
        `image: mcr.microsoft.com/playwright:v${version}-noble`,
      );
      expect(jobBlock(job)).toContain("HOME: /root");
    }
  });

  it("never installs browsers or apt packages in CI", () => {
    expect(yml).not.toContain("playwright install");
    expect(yml).not.toContain("actions/playwright");
  });
});
