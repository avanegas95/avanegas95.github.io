// Redis is fully faked in memory: no network, no @upstash/redis client.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_TTL_SECONDS,
  STORE_TIMEOUT_MS,
  budgetKey,
  checkBudget,
  recordSpend,
  usageBucket,
  type BudgetStore,
} from "../../src/lib/server/budget.ts";
import {
  costMicroUsd,
  worstCaseCostMicroUsd,
} from "../../src/lib/server/pricing.ts";

const NOW = new Date("2026-10-13T12:00:00Z");

class FakeStore implements BudgetStore {
  data = new Map<string, unknown>();
  ttl = new Map<string, number>();
  calls: string[] = [];
  latencyMs = 0;
  async get(key: string): Promise<unknown> {
    this.calls.push(`get ${key}`);
    await this.delay();
    return this.data.has(key) ? this.data.get(key) : null;
  }
  async incrby(key: string, n: number): Promise<number> {
    this.calls.push(`incrby ${key} ${n}`);
    await this.delay();
    if (!Number.isInteger(n)) throw new Error("ERR value is not an integer");
    const cur = Number(this.data.get(key) ?? 0);
    const next = cur + n;
    this.data.set(key, next);
    return next;
  }
  async expire(key: string, s: number): Promise<unknown> {
    this.calls.push(`expire ${key} ${s}`);
    await this.delay();
    this.ttl.set(key, s);
    return 1;
  }
  private delay(): Promise<void> {
    return this.latencyMs > 0
      ? new Promise((r) => setTimeout(r, this.latencyMs))
      : Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("budgetKey", () => {
  it("is namespaced and uses the UTC date", () => {
    expect(budgetKey(NOW)).toBe("pv3:blob:spend:2026-10-13");
  });
  it("rolls at UTC midnight, not local midnight", () => {
    expect(budgetKey(new Date("2026-10-13T23:59:59.999Z"))).toBe(
      "pv3:blob:spend:2026-10-13",
    );
    expect(budgetKey(new Date("2026-10-14T00:00:00.000Z"))).toBe(
      "pv3:blob:spend:2026-10-14",
    );
    // 20:00 in UTC-5 on the 13th is already the 14th in UTC.
    expect(budgetKey(new Date("2026-10-13T20:00:00-05:00"))).toBe(
      "pv3:blob:spend:2026-10-14",
    );
  });
  it("throws on an invalid date", () => {
    expect(() => budgetKey(new Date("nope"))).toThrow(RangeError);
  });
});

describe("usageBucket", () => {
  it.each([
    [0, "ok"],
    [4900, "ok"],
    [4999, "ok"],
    [5000, "warm"],
    [8900, "warm"],
    [8999, "warm"],
    [9000, "hot"],
    [10_000, "hot"],
  ] as const)("%i of 10,000 -> %s", (spent, bucket) => {
    expect(usageBucket(spent, 10_000)).toBe(bucket);
  });
  it("zero budget is hot", () => {
    expect(usageBucket(0, 0)).toBe("hot");
  });
});

describe("checkBudget", () => {
  it("missing key counts as 0", async () => {
    const s = new FakeStore();
    expect(await checkBudget(s, 1, NOW)).toEqual({ ok: true, bucket: "ok" });
    expect(s.calls).toEqual(["get pv3:blob:spend:2026-10-13"]);
  });
  it.each([
    [490_000, "ok"],
    [500_000, "warm"],
    [890_000, "warm"],
    [900_000, "hot"],
    [999_999, "hot"],
  ] as const)("$1 budget, %i spent -> ok/%s", async (spent, bucket) => {
    const s = new FakeStore();
    s.data.set(budgetKey(NOW), spent);
    expect(await checkBudget(s, 1, NOW)).toEqual({ ok: true, bucket });
  });
  it("blocks when spent equals the budget", async () => {
    const s = new FakeStore();
    s.data.set(budgetKey(NOW), 1_000_000);
    expect(await checkBudget(s, 1, NOW)).toEqual({
      ok: false,
      reason: "budget",
    });
  });
  it("blocks when spent exceeds the budget", async () => {
    const s = new FakeStore();
    s.data.set(budgetKey(NOW), 1_000_001);
    expect(await checkBudget(s, 1, NOW)).toEqual({
      ok: false,
      reason: "budget",
    });
  });
  it("DAILY_BUDGET_USD=0 always blocks", async () => {
    const s = new FakeStore();
    expect(await checkBudget(s, 0, NOW)).toEqual({
      ok: false,
      reason: "budget",
    });
  });
  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "invalid budget %s blocks",
    async (b) => {
      expect(await checkBudget(new FakeStore(), b, NOW)).toEqual({
        ok: false,
        reason: "budget",
      });
    },
  );
  it("accepts a numeric string (Upstash may return either)", async () => {
    const s = new FakeStore();
    s.data.set(budgetKey(NOW), "600000");
    expect(await checkBudget(s, 1, NOW)).toEqual({ ok: true, bucket: "warm" });
  });
  it.each([
    "garbage",
    "12.5",
    "-3",
    "",
    1.5,
    -1,
    Number.NaN,
    {},
    [],
    true,
    "1e9",
  ])("stored %o -> unavailable", async (v) => {
    const s = new FakeStore();
    s.data.set(budgetKey(NOW), v);
    expect(await checkBudget(s, 1, NOW)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
  it("mutation guard: get rejecting never yields ok", async () => {
    const s = new FakeStore();
    s.get = () => Promise.reject(new Error("ECONNRESET"));
    const r = await checkBudget(s, 1, NOW);
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });
  it("get throwing synchronously -> unavailable", async () => {
    const s = new FakeStore();
    s.get = () => {
      throw new Error("boom");
    };
    expect(await checkBudget(s, 1, NOW)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
  it(`a hanging store -> unavailable after ${STORE_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    const s = new FakeStore();
    s.get = () => new Promise(() => {});
    const p = checkBudget(s, 1, NOW);
    await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS - 1);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: false, reason: "unavailable" });
  });
  it("uses the current time when now is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-02T03:04:05Z"));
    const s = new FakeStore();
    await checkBudget(s, 1);
    expect(s.calls).toEqual(["get pv3:blob:spend:2027-01-02"]);
  });
});

describe("recordSpend", () => {
  it("INCRBYs an integer and sets a 48h TTL on every record", async () => {
    const s = new FakeStore();
    expect(await recordSpend(s, 360, NOW)).toBe(360);
    expect(await recordSpend(s, 1600, NOW)).toBe(1960);
    expect(BUDGET_TTL_SECONDS).toBe(172_800);
    expect(s.calls).toEqual([
      "incrby pv3:blob:spend:2026-10-13 360",
      "expire pv3:blob:spend:2026-10-13 172800",
      "incrby pv3:blob:spend:2026-10-13 1600",
      "expire pv3:blob:spend:2026-10-13 172800",
    ]);
    expect(s.ttl.get(budgetKey(NOW))).toBe(172_800);
  });
  it("writes to the new day's key after UTC midnight", async () => {
    const s = new FakeStore();
    await recordSpend(s, 10, new Date("2026-10-13T23:59:59Z"));
    await recordSpend(s, 20, new Date("2026-10-14T00:00:00Z"));
    expect(s.data.get("pv3:blob:spend:2026-10-13")).toBe(10);
    expect(s.data.get("pv3:blob:spend:2026-10-14")).toBe(20);
    expect(
      await checkBudget(s, 0.00002, new Date("2026-10-14T00:00:01Z")),
    ).toEqual({
      ok: false,
      reason: "budget",
    });
    expect(
      await checkBudget(s, 0.00002, new Date("2026-10-15T00:00:00Z")),
    ).toEqual({
      ok: true,
      bucket: "ok",
    });
  });
  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "rejects non-integer/unsafe amount %s without touching the store",
    async (n) => {
      const s = new FakeStore();
      await expect(recordSpend(s, n, NOW)).rejects.toThrow(RangeError);
      expect(s.calls).toEqual([]);
    },
  );
  it("rethrows when incrby fails", async () => {
    const s = new FakeStore();
    s.incrby = () => Promise.reject(new Error("ECONNRESET"));
    await expect(recordSpend(s, 10, NOW)).rejects.toThrow("ECONNRESET");
  });
  it("rethrows when expire fails", async () => {
    const s = new FakeStore();
    s.expire = () => Promise.reject(new Error("READONLY"));
    await expect(recordSpend(s, 10, NOW)).rejects.toThrow("READONLY");
  });
  it("rethrows when incrby returns a non-integer", async () => {
    const s = new FakeStore();
    s.incrby = () => Promise.resolve("OK" as unknown as number);
    await expect(recordSpend(s, 10, NOW)).rejects.toThrow();
  });
  it("times out a hanging store and rethrows", async () => {
    vi.useFakeTimers();
    const s = new FakeStore();
    s.incrby = () => new Promise(() => {});
    const p = recordSpend(s, 10, NOW);
    const assertion = expect(p).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS);
    await assertion;
  });
});

describe("kill switch end to end (fake store)", () => {
  it("0.01 USD = 10,000 micro: blocks after recording 10,000", async () => {
    const s = new FakeStore();
    expect((await checkBudget(s, 0.01, NOW)).ok).toBe(true);
    await recordSpend(s, 9_999, NOW);
    expect(await checkBudget(s, 0.01, NOW)).toEqual({
      ok: true,
      bucket: "hot",
    });
    await recordSpend(s, 1, NOW);
    expect(await checkBudget(s, 0.01, NOW)).toEqual({
      ok: false,
      reason: "budget",
    });
  });

  it("sequential Haiku traffic at 0.01 trips within one request's cost", async () => {
    const s = new FakeStore();
    const cost = costMicroUsd("claude-haiku-5-5", {
      input_tokens: 300,
      output_tokens: 500,
      cache_read_input_tokens: 8000,
    }); // 360
    let served = 0;
    while ((await checkBudget(s, 0.01, NOW)).ok) {
      await recordSpend(s, cost, NOW);
      served++;
      if (served > 1000) throw new Error("kill switch never tripped");
    }
    const total = Number(s.data.get(budgetKey(NOW)));
    expect(served).toBe(Math.ceil(10_000 / cost)); // 28
    expect(total).toBeGreaterThanOrEqual(10_000);
    expect(total - 10_000).toBeLessThan(cost); // overshoot < one request
  });

  it("concurrent requests racing past the budget overshoot by at most N x worst case", async () => {
    const s = new FakeStore();
    s.latencyMs = 1; // force interleaving between check and record
    const BUDGET_MICRO = 10_000;
    const N = 20;
    const maxTokens = 1024;
    const prompt = 8300;
    const worst = worstCaseCostMicroUsd("claude-haiku-5-5", prompt, maxTokens);
    // Pre-load to just under the budget: every one of the N racers passes the check.
    s.data.set(budgetKey(NOW), BUDGET_MICRO - 1);

    const results = await Promise.all(
      Array.from({ length: N }, async () => {
        const c = await checkBudget(s, 0.01, NOW);
        if (!c.ok) return false;
        await new Promise((r) => setTimeout(r, 5)); // model call in flight
        await recordSpend(s, worst, NOW);
        return true;
      }),
    );
    const passed = results.filter(Boolean).length;
    const total = Number(s.data.get(budgetKey(NOW)));

    expect(passed).toBe(N); // the race really happened
    // Documented bound: overshoot < (in-flight requests) x worst-case per request.
    expect(total - BUDGET_MICRO).toBeLessThan(N * worst);
    expect(total - BUDGET_MICRO).toBe(N * worst - 1);
    // ...and the very next request is blocked.
    expect(await checkBudget(s, 0.01, NOW)).toEqual({
      ok: false,
      reason: "budget",
    });
  });
});
