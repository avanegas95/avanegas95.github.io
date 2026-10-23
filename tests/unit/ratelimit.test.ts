import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upstash = vi.hoisted(() => ({
  ratelimitCtor: vi.fn(),
  redisCtor: vi.fn(),
  slidingWindow: vi.fn((n: number, w: string) => ({ n, w })),
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = upstash.slidingWindow;
    limit = vi.fn();
    constructor(config: unknown) {
      upstash.ratelimitCtor(config);
    }
  }
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    constructor(config: unknown) {
      upstash.redisCtor(config);
    }
  }
  return { Redis };
});

import {
  RATE_LIMITS,
  checkRateLimits,
  createUpstashLimiters,
  hashIp,
  rateKey,
  type Limiter,
  type Limiters,
} from "../../src/lib/server/ratelimit.ts";

const SALT = "s".repeat(32);
const OTHER_SALT = "t".repeat(32);
const NOW = 1_000_000;
const now = () => NOW;

type Result = Awaited<ReturnType<Limiter["limit"]>>;

/** Sliding-window stand-in: per-key counter that denies once `max` is exceeded. */
function counting(max: number, resetIn = 30_000) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const limiter: Limiter = {
    limit: vi.fn(async (key: string): Promise<Result> => {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= max, reset: NOW + resetIn };
    }),
  };
  return { limiter, keys };
}

function fixed(result: Result | (() => Promise<Result>)): Limiter {
  return {
    limit: vi.fn(
      typeof result === "function" ? result : async () => result,
    ) as Limiter["limit"],
  };
}

const allow = () => fixed({ success: true, reset: NOW + 1000 });

function limiters(over: Partial<Limiters> = {}): Limiters {
  return {
    ipMinute: allow(),
    ipDay: allow(),
    globalDay: allow(),
    ...over,
  };
}

describe("RATE_LIMITS", () => {
  it("matches SCOPE §6.3", () => {
    expect(RATE_LIMITS).toEqual({
      ipPerMinute: 8,
      ipPerDay: 60,
      globalPerDay: 2000,
    });
  });
});

describe("checkRateLimits", () => {
  it("allows 8 calls in a minute and limits the 9th", async () => {
    const m = counting(RATE_LIMITS.ipPerMinute, 42_100);
    const l = limiters({ ipMinute: m.limiter });
    for (let i = 0; i < 8; i++) {
      expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
        ok: true,
      });
    }
    const ninth = await checkRateLimits(l, "192.0.2.1", SALT, now);
    expect(ninth).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 43,
    });
  });

  it("checks ipMinute -> ipDay -> globalDay with the right keys", async () => {
    const order: string[] = [];
    const rec = (name: string): Limiter => ({
      limit: vi.fn(async (key: string) => {
        order.push(`${name}:${key}`);
        return { success: true, reset: NOW };
      }),
    });
    const l = {
      ipMinute: rec("m"),
      ipDay: rec("d"),
      globalDay: rec("g"),
    };
    expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
      ok: true,
    });
    const h = hashIp("192.0.2.1", SALT);
    expect(order).toEqual([`m:${h}`, `d:${h}`, "g:all"]);
  });

  it("stops at ipMinute failure without touching the others", async () => {
    const l = limiters({ ipMinute: fixed({ success: false, reset: NOW }) });
    const r = await checkRateLimits(l, "192.0.2.1", SALT, now);
    expect(r).toEqual({ ok: false, reason: "rate_limited", retryAfterSec: 1 });
    expect(l.ipDay.limit).not.toHaveBeenCalled();
    expect(l.globalDay.limit).not.toHaveBeenCalled();
  });

  it("ipDay failure is rate_limited and globalDay is not called", async () => {
    const l = limiters({
      ipDay: fixed({ success: false, reset: NOW + 3_600_000 }),
    });
    const r = await checkRateLimits(l, "192.0.2.1", SALT, now);
    expect(r).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 3600,
    });
    expect(l.globalDay.limit).not.toHaveBeenCalled();
  });

  it("globalDay failure is rate_limited", async () => {
    const l = limiters({
      globalDay: fixed({ success: false, reset: NOW + 1500 }),
    });
    expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 2,
    });
  });

  it("retryAfterSec is at least 1 even when reset is in the past", async () => {
    const l = limiters({ ipMinute: fixed({ success: false, reset: NOW - 5 }) });
    const r = await checkRateLimits(l, "192.0.2.1", SALT, now);
    expect(r).toMatchObject({ reason: "rate_limited", retryAfterSec: 1 });
  });

  it("non-finite reset still yields a finite retryAfterSec >= 1", async () => {
    const l = limiters({
      ipMinute: fixed({ success: false, reset: Number.NaN }),
    });
    const r = await checkRateLimits(l, "192.0.2.1", SALT, now);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "rate_limited") {
      expect(Number.isFinite(r.retryAfterSec)).toBe(true);
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    } else throw new Error("expected rate_limited");
  });

  it("uses Date.now by default", async () => {
    const l = limiters({
      ipMinute: fixed({ success: false, reset: Date.now() + 10_000 }),
    });
    const r = await checkRateLimits(l, "192.0.2.1", SALT);
    expect(r).toMatchObject({ reason: "rate_limited" });
    if (!r.ok && r.reason === "rate_limited") {
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(9);
      expect(r.retryAfterSec).toBeLessThanOrEqual(10);
    }
  });

  it.each(["", "   ", "unknown"])(
    "rate limits empty/unknown IP %j under the hashed key 'unknown'",
    async (ip) => {
      const m = counting(1);
      const l = limiters({ ipMinute: m.limiter });
      expect(await checkRateLimits(l, ip, SALT, now)).toEqual({ ok: true });
      expect(await checkRateLimits(l, ip, SALT, now)).toMatchObject({
        reason: "rate_limited",
      });
      expect(m.keys[0]).toBe(hashIp("unknown", SALT));
    },
  );

  it("empty and 'unknown' IPs share one bucket", async () => {
    const m = counting(1);
    const l = limiters({ ipMinute: m.limiter });
    await checkRateLimits(l, "", SALT, now);
    expect(await checkRateLimits(l, "unknown", SALT, now)).toMatchObject({
      reason: "rate_limited",
    });
  });
});

describe("checkRateLimits fails closed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("limiter throws synchronously -> unavailable", async () => {
    const l = limiters({
      ipMinute: {
        limit: () => {
          throw new Error("boom");
        },
      },
    });
    expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it.each(["ipMinute", "ipDay", "globalDay"] as const)(
    "%s rejecting -> unavailable",
    async (name) => {
      const l = limiters({
        [name]: fixed(() => Promise.reject(new Error("ECONNREFUSED"))),
      });
      expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
        ok: false,
        reason: "unavailable",
      });
    },
  );

  it.each(["ipMinute", "ipDay", "globalDay"] as const)(
    "%s hanging -> unavailable within ~1.5 s",
    async (name) => {
      const l = limiters({ [name]: fixed(() => new Promise<never>(() => {})) });
      let settled: unknown;
      void checkRateLimits(l, "192.0.2.1", SALT, now).then((r) => {
        settled = r;
      });
      await vi.advanceTimersByTimeAsync(1499);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toEqual({ ok: false, reason: "unavailable" });
    },
  );

  it("malformed limiter result -> unavailable", async () => {
    const l = limiters({
      ipMinute: fixed(async () => ({}) as unknown as Result),
    });
    expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    const l2 = limiters({
      ipDay: fixed(async () => null as unknown as Result),
    });
    expect(await checkRateLimits(l2, "192.0.2.1", SALT, now)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("rejected pending does not throw and does not change the result", async () => {
    const pending = Promise.reject(new Error("analytics down"));
    const l = limiters({
      ipMinute: fixed({ success: true, reset: NOW, pending }),
    });
    await expect(checkRateLimits(l, "192.0.2.1", SALT, now)).resolves.toEqual({
      ok: true,
    });
  });

  it("hanging pending is abandoned after ~1.5 s", async () => {
    const l = limiters({
      ipMinute: fixed({
        success: true,
        reset: NOW,
        pending: new Promise(() => {}),
      }),
    });
    let settled: unknown;
    void checkRateLimits(l, "192.0.2.1", SALT, now).then((r) => {
      settled = r;
    });
    await vi.advanceTimersByTimeAsync(1501);
    expect(settled).toEqual({ ok: true });
  });

  it("error results never contain the raw IP", async () => {
    const ip = "203.0.113.77";
    const l = limiters({
      ipMinute: fixed(() => Promise.reject(new Error(`bad key ${ip}`))),
    });
    const r = await checkRateLimits(l, ip, SALT, now);
    expect(JSON.stringify(r)).not.toContain(ip);
  });

  it("never logs the raw IP", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const ip = "203.0.113.78";
    await checkRateLimits(
      limiters({ ipMinute: fixed(() => Promise.reject(new Error(ip))) }),
      ip,
      SALT,
      now,
    );
    for (const s of spies) {
      for (const call of s.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(ip);
      }
      s.mockRestore();
    }
  });
});

describe("hashIp", () => {
  it("is HMAC-SHA256 hex", () => {
    expect(hashIp("192.0.2.1", SALT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for same IP + salt", () => {
    expect(hashIp("192.0.2.1", SALT)).toBe(hashIp("192.0.2.1", SALT));
  });

  it("differs between IPs and between salts", () => {
    expect(hashIp("192.0.2.1", SALT)).not.toBe(hashIp("192.0.2.2", SALT));
    expect(hashIp("192.0.2.1", SALT)).not.toBe(hashIp("192.0.2.1", OTHER_SALT));
  });

  it.each([
    "192.0.2.1",
    "2001:db8::1",
    "2001:0db8:0000:0000:0000:ff00:0042:8329",
    "1.2.3.4, 5.6.7.8",
  ])("key for %j never contains the raw IP", (ip) => {
    const h = hashIp(ip, SALT);
    expect(h).not.toContain(ip);
    for (const part of ip.split(/[\s,]+/)) expect(h).not.toContain(part);
  });

  it("IPv6 addresses get distinct keys", () => {
    expect(hashIp("2001:db8::1", SALT)).not.toBe(hashIp("2001:db8::2", SALT));
  });
});

describe("client-controlled IP headers are not trusted", () => {
  it("an x-forwarded-for-looking string is hashed as given, not split", () => {
    const xff = "1.2.3.4, 5.6.7.8";
    const h = hashIp(xff, SALT);
    expect(h).not.toBe(hashIp("1.2.3.4", SALT));
    expect(h).not.toBe(hashIp("5.6.7.8", SALT));
  });

  it("checkRateLimits never splits an XFF-looking string: it is one shared 'unknown' bucket", async () => {
    const m = counting(8);
    await checkRateLimits(
      limiters({ ipMinute: m.limiter }),
      "1.2.3.4, 5.6.7.8",
      SALT,
      now,
    );
    expect(m.keys).toEqual([hashIp("unknown", SALT)]);
    expect(m.keys).not.toContain(hashIp("1.2.3.4", SALT));
    expect(m.keys).not.toContain(hashIp("5.6.7.8", SALT));
  });

  it("spoofing a victim IP as the first XFF hop does not consume the victim's bucket", async () => {
    const m = counting(1);
    const l = limiters({ ipMinute: m.limiter });
    await checkRateLimits(l, "198.51.100.9, 192.0.2.1", SALT, now);
    expect(await checkRateLimits(l, "192.0.2.1", SALT, now)).toEqual({
      ok: true,
    });
  });

  it("rotating spoofed IPs still hits the global daily cap", async () => {
    const g = counting(RATE_LIMITS.globalPerDay, 3_600_000);
    const l = limiters({ globalDay: g.limiter });
    for (let i = 0; i < RATE_LIMITS.globalPerDay; i++) {
      const r = await checkRateLimits(
        l,
        `10.0.${i >> 8}.${i & 255}`,
        SALT,
        now,
      );
      expect(r.ok).toBe(true);
    }
    expect(await checkRateLimits(l, "10.9.9.9", SALT, now)).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 3600,
    });
    expect(new Set(g.keys)).toEqual(new Set(["all"]));
  });

  it("the module reads no request headers or env itself", () => {
    const src = readFileSync(
      new URL("../../src/lib/server/ratelimit.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(
      /x-forwarded-for|x-real-ip|x-vercel-forwarded-for|headers|process\.env|import\.meta\.env|fromEnv/i,
    );
  });
});

describe("createUpstashLimiters", () => {
  beforeEach(() => {
    upstash.ratelimitCtor.mockClear();
    upstash.redisCtor.mockClear();
    upstash.slidingWindow.mockClear();
  });

  it("wires three sliding-window limiters with pv3-prefixed keys", () => {
    const env = {
      upstashUrl: "https://fake.example.com",
      upstashToken: "fake-token",
    };
    const l = createUpstashLimiters(env);

    expect(upstash.redisCtor).toHaveBeenCalledTimes(1);
    expect(upstash.redisCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://fake.example.com",
        token: "fake-token",
      }),
    );
    expect(upstash.slidingWindow.mock.calls).toEqual([
      [8, "1 m"],
      [60, "1 d"],
      [2000, "1 d"],
    ]);

    const configs = upstash.ratelimitCtor.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(configs).toHaveLength(3);
    expect(configs.map((c) => c.prefix)).toEqual([
      "pv3:blob:rl:ip:m",
      "pv3:blob:rl:ip:d",
      "pv3:blob:rl:global:d",
    ]);
    expect(configs.map((c) => c.limiter)).toEqual([
      { n: 8, w: "1 m" },
      { n: 60, w: "1 d" },
      { n: 2000, w: "1 d" },
    ]);
    for (const c of configs) {
      expect(c.analytics).toBe(false);
      // The SDK fails OPEN after its own timeout (default 5 s); disable it.
      expect(c.timeout).toBe(0);
      expect(String(c.prefix).startsWith("pv3:")).toBe(true);
    }
    const redis = (configs[0] as { redis: unknown }).redis;
    for (const c of configs) expect(c.redis).toBe(redis);

    expect(typeof l.ipMinute.limit).toBe("function");
    expect(typeof l.ipDay.limit).toBe("function");
    expect(typeof l.globalDay.limit).toBe("function");
  });
});

// P4-15 / S-01 (F-RL-1): the IP is normalised before it is hashed.
describe("rateKey", () => {
  it.each([
    ["192.0.2.1", "192.0.2.1"],
    [" 192.0.2.1 ", "192.0.2.1"],
    ["0.0.0.0", "0.0.0.0"],
    ["255.255.255.255", "255.255.255.255"],
    ["::ffff:203.0.113.5", "203.0.113.5"],
    ["::FFFF:203.0.113.5", "203.0.113.5"],
    ["::ffff:cb00:7105", "203.0.113.5"],
    ["0:0:0:0:0:ffff:203.0.113.5", "203.0.113.5"],
    ["0000:0000:0000:0000:0000:ffff:cb00:7105", "203.0.113.5"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:DB8::1", "2001:db8:0:0::/64"],
    ["2001:db8:0:0::1", "2001:db8:0:0::/64"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8:0:0::/64"],
    ["2001:db8::ffff:1", "2001:db8:0:0::/64"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:db8:1:2::", "2001:db8:1:2::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
  ])("%j -> %j", (ip, key) => {
    expect(rateKey(ip)).toBe(key);
  });

  it.each([
    "",
    "   ",
    "unknown",
    "1.2.3.4, 5.6.7.8",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "01.2.3.4",
    "1.2.3.4:80",
    "[2001:db8::1]",
    "2001:db8:::1",
    "2001::db8::1",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7:8::",
    "1:2:3:4:5:6:7",
    "12345::1",
    "g::1",
    "::ffff:1.2.3.256",
    "1.2.3.4::1",
    "::1.2.3.4:1",
    "localhost",
    "x".repeat(200),
  ])("%j is unparseable -> 'unknown'", (ip) => {
    expect(rateKey(ip)).toBe("unknown");
  });

  it("an IPv4-mapped IPv6 address and its IPv4 share one bucket", async () => {
    const m = counting(1);
    const l = limiters({ ipMinute: m.limiter });
    expect(await checkRateLimits(l, "203.0.113.5", SALT, now)).toEqual({
      ok: true,
    });
    expect(await checkRateLimits(l, "::ffff:203.0.113.5", SALT, now)).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 30,
    });
  });

  it("compressed, expanded and upper-case spellings share one bucket", async () => {
    const m = counting(8);
    const l = limiters({ ipMinute: m.limiter });
    for (const ip of [
      "2001:db8::1",
      "2001:DB8::1",
      "2001:db8:0:0::1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    ]) {
      await checkRateLimits(l, ip, SALT, now);
    }
    expect(new Set(m.keys)).toEqual(
      new Set([hashIp("2001:db8:0:0::/64", SALT)]),
    );
  });

  it("nine addresses in one IPv6 /64 share the minute bucket: the 9th is limited", async () => {
    const m = counting(RATE_LIMITS.ipPerMinute);
    const l = limiters({ ipMinute: m.limiter });
    const results = [];
    for (let i = 1; i <= 9; i++) {
      results.push(await checkRateLimits(l, `2001:db8::${i}`, SALT, now));
    }
    expect(results.slice(0, 8).every((r) => r.ok)).toBe(true);
    expect(results[8]).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("different /64s get different buckets", async () => {
    const m = counting(8);
    const l = limiters({ ipMinute: m.limiter });
    await checkRateLimits(l, "2001:db8:0:1::1", SALT, now);
    await checkRateLimits(l, "2001:db8:0:2::1", SALT, now);
    expect(new Set(m.keys).size).toBe(2);
  });

  it("unparseable input shares the 'unknown' bucket with an empty IP", async () => {
    const m = counting(1);
    const l = limiters({ ipMinute: m.limiter });
    await checkRateLimits(l, "not-an-ip", SALT, now);
    expect(await checkRateLimits(l, "", SALT, now)).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
    expect(new Set(m.keys)).toEqual(new Set([hashIp("unknown", SALT)]));
  });

  it("the hashed key never contains the address or its /64", async () => {
    const m = counting(8);
    await checkRateLimits(
      limiters({ ipMinute: m.limiter }),
      "2001:db8:1:2::9",
      SALT,
      now,
    );
    expect(m.keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(m.keys[0]).not.toContain("2001");
  });
});
