// Daily spend kill switch (SCOPE §6.4). Fails closed; nothing here can be disabled
// by env or option.
//
// Accounting is integer micro-USD in a per-UTC-day Redis counter
// (`pv3:blob:spend:YYYY-MM-DD`, shared-DB safe prefix) updated only with INCRBY.
//
// Concurrency overshoot (accepted, SCOPE §6.4 rule 4): checkBudget and recordSpend are
// separate round trips, so every request that passes the check before any of them
// records can still spend. If the counter is at `budget - 1` and N requests are in
// flight, the final total is at most
//     budget - 1 + N * worstCaseCostMicroUsd(model, prompt, max_tokens)
// i.e. overshoot < N x (one request's worst-case cost). With N = 1 (sequential traffic)
// it trips within one request's worth of spend. N is bounded by the per-IP and global
// rate limits (P2-03), which bounds the overshoot. tests/unit/budget.test.ts pins this.
export type BudgetStore = {
  get(key: string): Promise<unknown>;
  incrby(key: string, n: number): Promise<number>;
  expire(key: string, s: number): Promise<unknown>;
}; // @upstash/redis-compatible

export type UsageBucket = "ok" | "warm" | "hot";
export type BudgetCheck =
  | { ok: true; bucket: UsageBucket }
  | { ok: false; reason: "budget" | "unavailable" };

export const KEY_PREFIX = "pv3:blob:spend:";
/** 48 h: today's key outlives the UTC day so late records never resurrect a fresh key. */
export const BUDGET_TTL_SECONDS = 172_800;
export const STORE_TIMEOUT_MS = 1500;

const MICRO_PER_USD = 1_000_000;

export function budgetKey(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid date");
  return KEY_PREFIX + now.toISOString().slice(0, 10); // ISO strings are always UTC
}

/** <50% ok, <90% warm, else hot. Integer comparisons only. */
export function usageBucket(
  spentMicro: number,
  budgetMicro: number,
): UsageBucket {
  if (spentMicro * 2 < budgetMicro) return "ok";
  if (spentMicro * 10 < budgetMicro * 9) return "warm";
  return "hot";
}

function withTimeout<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("budget store timeout")),
      STORE_TIMEOUT_MS,
    );
  });
  // `run` is invoked inside a promise chain so a synchronous throw becomes a rejection.
  return Promise.race([Promise.resolve().then(run), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

/** Stored counter -> micro-USD, or null if it isn't a non-negative safe integer. */
function parseSpent(v: unknown): number | null {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number")
    return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d{1,15}$/.test(v)) return Number(v);
  return null;
}

function toBudgetMicro(dailyBudgetUsd: number): number | null {
  if (!Number.isFinite(dailyBudgetUsd) || dailyBudgetUsd < 0) return null;
  // env.ts caps the budget at $50, so this is far inside the safe-integer range.
  return Math.round(dailyBudgetUsd * MICRO_PER_USD);
}

export async function checkBudget(
  store: BudgetStore,
  dailyBudgetUsd: number,
  now: Date = new Date(),
): Promise<BudgetCheck> {
  const budgetMicro = toBudgetMicro(dailyBudgetUsd);
  if (budgetMicro === null || budgetMicro === 0)
    return { ok: false, reason: "budget" };
  let spent: number | null;
  try {
    const key = budgetKey(now);
    spent = parseSpent(await withTimeout(() => store.get(key)));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (spent === null) return { ok: false, reason: "unavailable" };
  if (spent >= budgetMicro) return { ok: false, reason: "budget" };
  return { ok: true, bucket: usageBucket(spent, budgetMicro) };
}

/** Adds `micro` to today's counter and returns the new total. Rethrows on failure. */
export async function recordSpend(
  store: BudgetStore,
  micro: number,
  now: Date = new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(micro) || micro < 0) {
    throw new RangeError(
      "spend must be a non-negative safe integer (micro-USD)",
    );
  }
  const key = budgetKey(now);
  const total = await withTimeout(() => store.incrby(key, micro));
  await withTimeout(() => store.expire(key, BUDGET_TTL_SECONDS));
  if (!Number.isSafeInteger(total))
    throw new TypeError("unexpected INCRBY result");
  return total;
}
