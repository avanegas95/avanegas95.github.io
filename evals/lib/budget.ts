// Hard spend guard for evals (CLAUDE.md rule 5, SCOPE §6.4/§7). Every paid eval call
// must pass `spendAllowed` once before the run and `SpendMeter.canAfford` before each call.
// The cap is a constant: it is never read from env and can only be lowered by callers.
import {
  costMicroUsd,
  type ChatModel,
  type Usage,
} from "../../src/lib/server/pricing.ts";

export const HARD_CAP_USD = 1;

const MICRO_PER_USD = 1_000_000;

export type SpendGate =
  | { ok: true }
  | {
      ok: false;
      reason: "no_opt_in" | "no_key" | "pull_request" | "ci" | "over_cap";
    };

export type CallPlan = {
  model: ChatModel;
  prefixTokens: number;
  turnTokens: number;
  maxTokens: number;
  calls: number;
};

/** Cap in whole micro-USD. `capUsd` may only lower it; anything else clamps to HARD_CAP_USD. */
function capMicroUsd(capUsd?: number): number {
  const usd =
    capUsd !== undefined &&
    Number.isFinite(capUsd) &&
    capUsd > 0 &&
    capUsd <= HARD_CAP_USD
      ? capUsd
      : HARD_CAP_USD;
  return Math.floor(usd * MICRO_PER_USD);
}

const PR_EVENTS = new Set(["pull_request", "pull_request_target"]);

export function spendAllowed(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  preflightMicroUsd: number,
  capUsd?: number,
): SpendGate {
  if (!argv.includes("--spend") || env.EVAL_ALLOW_SPEND !== "1") {
    return { ok: false, reason: "no_opt_in" };
  }
  if (!env.ANTHROPIC_API_KEY?.trim()) return { ok: false, reason: "no_key" };
  const ci = (env.CI ?? "").trim().toLowerCase();
  if (ci !== "" && ci !== "0" && ci !== "false") {
    return { ok: false, reason: "ci" };
  }
  if (PR_EVENTS.has(env.GITHUB_EVENT_NAME ?? "")) {
    return { ok: false, reason: "pull_request" };
  }
  if (
    !Number.isFinite(preflightMicroUsd) ||
    preflightMicroUsd < 0 ||
    preflightMicroUsd > capMicroUsd(capUsd)
  ) {
    return { ok: false, reason: "over_cap" };
  }
  return { ok: true };
}

/**
 * Cached-prefix upper bound for a run: per plan, the first call writes the prefix
 * (1h rate) and every later call reads it; each call sends `turnTokens` fresh input
 * and is charged the full `maxTokens` of output. Priced per call so the long-context
 * threshold applies to one prompt, not the whole run.
 */
export function preflightMicroUsd(plans: readonly CallPlan[]): number {
  let total = 0;
  for (const p of plans) {
    if (!Number.isSafeInteger(p.calls) || p.calls < 0) {
      throw new RangeError("invalid call count");
    }
    if (p.calls === 0) continue;
    const first = costMicroUsd(p.model, {
      input_tokens: p.turnTokens,
      output_tokens: p.maxTokens,
      cache_creation_input_tokens: p.prefixTokens,
    });
    const rest = costMicroUsd(p.model, {
      input_tokens: p.turnTokens,
      output_tokens: p.maxTokens,
      cache_read_input_tokens: p.prefixTokens,
    });
    total += first + (p.calls - 1) * rest;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("cost overflow");
  return total;
}

/** Running spend in integer micro-USD; the hard stop checked before every call. */
export class SpendMeter {
  readonly #capMicroUsd: number;
  #spent = 0;

  constructor(capUsd?: number) {
    this.#capMicroUsd = capMicroUsd(capUsd);
  }

  /** Records a finished call's real usage; returns that call's cost in micro-USD. */
  charge(model: ChatModel, usage: Usage): number {
    const cost = costMicroUsd(model, usage);
    this.#spent += cost;
    return cost;
  }

  /** False when `spent + nextWorstMicroUsd` would exceed the cap. */
  canAfford(nextWorstMicroUsd: number): boolean {
    if (!Number.isFinite(nextWorstMicroUsd) || nextWorstMicroUsd < 0) {
      return false;
    }
    return this.#spent + nextWorstMicroUsd <= this.#capMicroUsd;
  }

  get spentMicroUsd(): number {
    return this.#spent;
  }
}
