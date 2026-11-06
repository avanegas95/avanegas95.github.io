import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkBotId, initBotId } = vi.hoisted(() => ({
  checkBotId: vi.fn(),
  initBotId: vi.fn(),
}));
vi.mock("botid/server", () => ({ checkBotId }));
vi.mock("botid/client/core", () => ({ initBotId }));

import {
  checkBot,
  verifyHuman,
  type BotCheck,
} from "../../src/lib/server/botid.ts";

const req = () =>
  new Request("https://avanegas.com/api/chat", {
    method: "POST",
    headers: { "X-Is-Human": '{"b":0}', "user-agent": "test-agent" },
  });

describe("checkBot (injected verifier)", () => {
  it("isBot: true -> bot", async () => {
    const check: BotCheck = async () => ({ isBot: true });
    expect(await checkBot(check, req())).toEqual({ ok: false, reason: "bot" });
  });

  it("isBot: false -> ok", async () => {
    const check: BotCheck = async () => ({ isBot: false });
    expect(await checkBot(check, req())).toEqual({ ok: true });
  });

  it("passes the request through to the verifier", async () => {
    const check = vi.fn<BotCheck>(async () => ({ isBot: false }));
    const r = req();
    await checkBot(check, r);
    expect(check).toHaveBeenCalledWith(r);
  });

  it("verifier throws -> unavailable (fails closed)", async () => {
    const check: BotCheck = async () => {
      throw new Error("network down");
    };
    expect(await checkBot(check, req())).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("verifier throws synchronously -> unavailable", async () => {
    const check = (() => {
      throw new Error("sync");
    }) as unknown as BotCheck;
    expect(await checkBot(check, req())).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("missing or malformed verdict -> unavailable, never ok", async () => {
    for (const verdict of [
      undefined,
      null,
      {},
      { isBot: undefined },
      { isBot: "false" },
      { isBot: 0 },
    ]) {
      const check = (async () => verdict) as unknown as BotCheck;
      expect(await checkBot(check, req()), JSON.stringify(verdict)).toEqual({
        ok: false,
        reason: "unavailable",
      });
    }
  });
});

describe("verifyHuman (botid/server wrapper)", () => {
  beforeEach(() => {
    checkBotId.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls checkBotId in basic mode with the request headers", async () => {
    checkBotId.mockResolvedValue({ isBot: false, isHuman: true });
    expect(await verifyHuman(req())).toEqual({ isBot: false });
    expect(checkBotId).toHaveBeenCalledTimes(1);
    const arg = checkBotId.mock.calls[0]?.[0] as {
      advancedOptions: { checkLevel: string; headers: Record<string, string> };
    };
    expect(Object.keys(arg)).toEqual(["advancedOptions"]);
    expect(arg.advancedOptions.checkLevel).toBe("basic");
    expect(arg.advancedOptions.headers).toMatchObject({
      "x-is-human": '{"b":0}',
      "user-agent": "test-agent",
    });
  });

  it("passes isBot: true through", async () => {
    checkBotId.mockResolvedValue({ isBot: true, isHuman: false });
    expect(await verifyHuman(req())).toEqual({ isBot: true });
  });

  it("checkBotId error propagates, so checkBot fails closed", async () => {
    checkBotId.mockRejectedValue(new Error("VERCEL_OIDC_TOKEN is not set"));
    await expect(verifyHuman(req())).rejects.toThrow();
    expect(await checkBot(verifyHuman, req())).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("on a Vercel deployment with a non-production NODE_ENV, refuses (botid would silently pass)", async () => {
    checkBotId.mockResolvedValue({ isBot: false, isHuman: true });
    for (const vercelEnv of ["production", "preview"]) {
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("NODE_ENV", "development");
      expect(await checkBot(verifyHuman, req())).toEqual({
        ok: false,
        reason: "unavailable",
      });
    }
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("on a production deployment with NODE_ENV=production, runs the real check", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    checkBotId.mockResolvedValue({ isBot: true, isHuman: false });
    expect(await checkBot(verifyHuman, req())).toEqual({
      ok: false,
      reason: "bot",
    });
  });

  it("source has no developmentOptions and no skip/override knob", () => {
    const src = readFileSync("src/lib/server/botid.ts", "utf8");
    expect(src).not.toContain("developmentOptions");
    expect(src).not.toMatch(/deepAnalysis|isDevelopment|bypass:/);
  });
});

// The client script is owned by P5-04a; this block runs as soon as it lands.
describe.skipIf(!existsSync("src/scripts/botid-init.ts"))(
  "client init (src/scripts/botid-init.ts)",
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.resetModules();
      initBotId.mockReset();
    });

    it("BOTID_PROTECT is exactly POST /api/chat in basic mode", async () => {
      const { BOTID_PROTECT } = await import("../../src/scripts/botid-init.ts");
      expect(BOTID_PROTECT).toEqual([
        {
          path: "/api/chat",
          method: "POST",
          advancedOptions: { checkLevel: "basic" },
        },
      ]);
      expect(Object.isFrozen(BOTID_PROTECT)).toBe(true);
    });

    it("does nothing without a window (server import)", async () => {
      await import("../../src/scripts/botid-init.ts");
      expect(initBotId).not.toHaveBeenCalled();
    });

    it("calls initBotId with BOTID_PROTECT in a production browser build", async () => {
      vi.stubGlobal("window", {});
      vi.stubEnv("DEV", false);
      const { BOTID_PROTECT } = await import("../../src/scripts/botid-init.ts");
      expect(initBotId).toHaveBeenCalledTimes(1);
      expect(initBotId).toHaveBeenCalledWith({ protect: BOTID_PROTECT });
    });

    it("skips client init under astro dev, where the vercel.json rewrites do not exist", async () => {
      vi.stubGlobal("window", {});
      vi.stubEnv("DEV", true);
      await import("../../src/scripts/botid-init.ts");
      expect(initBotId).not.toHaveBeenCalled();
    });

    it("client and server agree on the check level", () => {
      const client = readFileSync("src/scripts/botid-init.ts", "utf8");
      const server = readFileSync("src/lib/server/botid.ts", "utf8");
      expect(client).toMatch(/checkLevel: "basic"/);
      expect(server).toMatch(/checkLevel: "basic"/);
      expect(client).not.toContain("deepAnalysis");
      // Rule 3: the client script never imports server modules.
      const imports = [
        ...client.matchAll(/^import[^;]*from\s+"([^"]+)"/gm),
      ].map((m) => m[1]);
      expect(imports).toEqual(["botid/client/core"]);
    });
  },
);
