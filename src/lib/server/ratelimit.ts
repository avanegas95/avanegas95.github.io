// SCOPE §6.3 rate limits: 8/min + 60/day per IP, 2,000/day global.
// Fails closed: any Redis error, malformed result or slow call denies the request.
// The raw IP never leaves this module: Redis only sees an HMAC of it.
import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ChatEnv } from "./env.ts";

export type Limiter = {
  limit(key: string): Promise<{
    success: boolean;
    reset: number;
    pending?: Promise<unknown>;
  }>;
};
export type Limiters = {
  ipMinute: Limiter;
  ipDay: Limiter;
  globalDay: Limiter;
};

export const RATE_LIMITS = {
  ipPerMinute: 8,
  ipPerDay: 60,
  globalPerDay: 2000,
} as const;

export type RateResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited"; retryAfterSec: number }
  | { ok: false; reason: "unavailable" };

// The Redis database is shared, so every key lives under `pv3:`.
const KEY_ROOT = "pv3:";
export const RATE_PREFIXES = {
  ipMinute: `${KEY_ROOT}blob:rl:ip:m`,
  ipDay: `${KEY_ROOT}blob:rl:ip:d`,
  globalDay: `${KEY_ROOT}blob:rl:global:d`,
} as const;

const GLOBAL_KEY = "all";
const UNKNOWN_IP = "unknown";
const TIMEOUT_MS = 1500;
const FALLBACK_RETRY_SEC = 60;

/** Production wiring only. Pass values from `getEnv()`; never read env here. */
export function createUpstashLimiters(
  env: Pick<ChatEnv, "upstashUrl" | "upstashToken">,
): Limiters {
  const redis = new Redis({ url: env.upstashUrl, token: env.upstashToken });
  const make = (
    limiter: ReturnType<typeof Ratelimit.slidingWindow>,
    prefix: string,
  ) =>
    new Ratelimit({
      redis,
      limiter,
      prefix,
      analytics: false,
      // The SDK's own timeout lets requests PASS when Redis is slow (fail open).
      // Disable it; `withTimeout` below fails closed instead.
      timeout: 0,
    });
  return {
    ipMinute: make(
      Ratelimit.slidingWindow(RATE_LIMITS.ipPerMinute, "1 m"),
      RATE_PREFIXES.ipMinute,
    ),
    ipDay: make(
      Ratelimit.slidingWindow(RATE_LIMITS.ipPerDay, "1 d"),
      RATE_PREFIXES.ipDay,
    ),
    globalDay: make(
      Ratelimit.slidingWindow(RATE_LIMITS.globalPerDay, "1 d"),
      RATE_PREFIXES.globalDay,
    ),
  };
}

/** HMAC-SHA256 hex of the string exactly as given. Callers pass `rateKey(ip)`. */
export function hashIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex");
}

const IPV4 = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

function parseIpv4(s: string): number[] | null {
  if (!IPV4.test(s)) return null;
  const parts = s.split(".").map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// Eight 16-bit groups, or null. Accepts the compressed ("::") and expanded
// spellings, any case, and a dotted IPv4 tail; a zone ("%eth0") is dropped.
function parseIpv6(raw: string): number[] | null {
  const s = raw.toLowerCase().replace(/%[0-9a-z._~-]+$/, "");
  if (!s.includes(":")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const items = part.split(":");
    for (const [i, item] of items.entries()) {
      if (i === items.length - 1 && item.includes(".")) {
        const v4 = parseIpv4(item);
        if (!v4) return null;
        out.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      } else if (HEXTET.test(item)) out.push(parseInt(item, 16));
      else return null;
    }
    return out;
  };
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (!head || !tail) return null;
  // A dotted IPv4 tail is only valid at the very end.
  if (halves.length === 2 && halves[0]!.includes(".")) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

/**
 * The string a client is rate limited under (SCOPE §6.3, P4-15). IPv4 is
 * canonical dotted decimal; an IPv4-mapped IPv6 address (::ffff:a.b.c.d)
 * counts as its IPv4 address; any other IPv6 address is keyed by its /64,
 * since one client usually controls a whole /64. Anything else, including a
 * list of addresses, falls into one shared "unknown" bucket (fails closed).
 */
export function rateKey(ip: string): string {
  const s = ip.trim();
  const v4 = parseIpv4(s);
  if (v4) return v4.join(".");
  const g = parseIpv6(s);
  if (!g) return UNKNOWN_IP;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join(".");
  }
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(":")}::/64`;
}

const TIMED_OUT = Symbol("timeout");

async function withTimeout<T>(
  run: () => Promise<T>,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), TIMEOUT_MS);
  });
  try {
    // `run` is invoked inside the try so a synchronous throw is also caught by the caller.
    return await Promise.race([Promise.resolve().then(run), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Outcome = "pass" | "unavailable" | { reset: number };

async function consult(limiter: Limiter, key: string): Promise<Outcome> {
  let res: unknown;
  try {
    res = await withTimeout(() => limiter.limit(key));
  } catch {
    // Swallow the error: its message may echo the key or connection details.
    return "unavailable";
  }
  if (res === TIMED_OUT || typeof res !== "object" || res === null) {
    return "unavailable";
  }
  const { success, reset, pending } = res as {
    success?: unknown;
    reset?: unknown;
    pending?: unknown;
  };
  if (typeof success !== "boolean") return "unavailable";
  if (pending instanceof Promise) {
    await withTimeout(() => pending).catch(() => undefined);
  }
  return success ? "pass" : { reset: typeof reset === "number" ? reset : NaN };
}

export async function checkRateLimits(
  limiters: Limiters,
  ip: string,
  salt: string,
  now: () => number = Date.now,
): Promise<RateResult> {
  const ipKey = hashIp(rateKey(ip), salt);
  const steps: Array<[Limiter, string]> = [
    [limiters.ipMinute, ipKey],
    [limiters.ipDay, ipKey],
    [limiters.globalDay, GLOBAL_KEY],
  ];
  for (const [limiter, key] of steps) {
    const outcome = await consult(limiter, key);
    if (outcome === "pass") continue;
    if (outcome === "unavailable") return { ok: false, reason: "unavailable" };
    const secs = Math.ceil((outcome.reset - now()) / 1000);
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSec: Number.isFinite(secs)
        ? Math.max(1, secs)
        : FALLBACK_RETRY_SEC,
    };
  }
  return { ok: true };
}
