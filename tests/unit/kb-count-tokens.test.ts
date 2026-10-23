import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const countTokens = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { countTokens };
  },
}));

import { parseArgs, run } from "../../scripts/kb-count-tokens.ts";

beforeEach(() => {
  countTokens.mockReset();
  vi.restoreAllMocks();
});

describe("kb-count-tokens", () => {
  it("parses --model and defaults", () => {
    expect(parseArgs([])).toEqual({ model: "claude-haiku-5-5" });
    expect(parseArgs(["--model", "m"])).toEqual({ model: "m" });
    expect(() => parseArgs(["--model"])).toThrow();
    expect(() => parseArgs(["--nope"])).toThrow();
  });

  it("without a key prints skipped and exits 0, no SDK call", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await run([], {})).toBe(0);
    expect(log).toHaveBeenCalledWith("skipped: no key");
    expect(countTokens).not.toHaveBeenCalled();
  });

  it("bad args exit 2 before anything else", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(["--x"], { ANTHROPIC_API_KEY: "k" })).toBe(2);
    expect(countTokens).not.toHaveBeenCalled();
  });

  it("subtracts the bare probe message from the system count", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    countTokens.mockImplementation(async (req: { system?: unknown }) => ({
      input_tokens: req.system ? 6000 : 8,
    }));
    expect(await run([], { ANTHROPIC_API_KEY: "k" })).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "systemTokens=5992 minCacheable=512 ok=true",
    );
    expect(countTokens).toHaveBeenCalledTimes(2);
  });

  it("300 tokens exits 1", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    countTokens.mockImplementation(async (r: { system?: unknown }) => ({
      input_tokens: r.system ? 300 : 0,
    }));
    expect(await run([], { ANTHROPIC_API_KEY: "k" })).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "systemTokens=300 minCacheable=512 ok=false",
    );
  });

  it("3600 tokens exits 0 with ok=true", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    countTokens.mockImplementation(async (r: { system?: unknown }) => ({
      input_tokens: r.system ? 3600 : 0,
    }));
    expect(await run(["--model", "m"], { ANTHROPIC_API_KEY: "k" })).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "systemTokens=3600 minCacheable=512 ok=true",
    );
    expect(countTokens.mock.calls[0]?.[0].model).toBe("m");
  });

  it("over 15000 exits 1", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    countTokens.mockImplementation(async (r: { system?: unknown }) => ({
      input_tokens: r.system ? 15001 : 0,
    }));
    expect(await run([], { ANTHROPIC_API_KEY: "k" })).toBe(1);
  });

  it("CLI without a key skips (no network)", () => {
    const env = { ...process.env };
    delete env["ANTHROPIC_API_KEY"];
    const r = spawnSync(
      process.execPath,
      [resolve("scripts/kb-count-tokens.ts")],
      { encoding: "utf8", env },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("skipped: no key");
  });
});
