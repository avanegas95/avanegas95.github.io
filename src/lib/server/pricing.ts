// Token pricing in integer micro-USD (SCOPE §6.4). No float accumulation anywhere.
//
// Source (verified 2026-10-13): https://platform.claude.com/docs/en/about-claude/pricing
//   Claude Haiku 5.5, prompt <= 100,000 tokens: input $0.10, 1h cache write $0.20,
//     cache hit $0.01, output $0.50 per MTok.
//   Claude Haiku 5.5, prompt > 100,000 tokens: input $0.50, 1h cache write $1,
//     cache hit $0.05, output $2.50 per MTok. "Prompt length counts all of its input
//     tokens, including cache reads and cache writes" (Long context pricing section).
//   Claude Sonnet 5.5: input $2, 1h cache write $4, cache hit $0.10, output $10 per MTok
//     (flat across the context window).
// Usage fields: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
//
// Units: a price of $X / MTok is X * 1e6 micro-USD per 1e6 tokens, so the stored integer
// is "micro-USD per MTok" and cost = ceil(sum(tokens * price) / 1e6). The sum is done in
// BigInt so it stays exact for any token count.
import type { ChatEnv } from "./env.ts";

export type ChatModel = ChatEnv["chatModel"];

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

type Rates = {
  input: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
};
export type ModelPrice = Rates & { longInput?: Rates };

/** Prompts strictly above this many tokens pay `longInput` rates (Haiku 5.5 only). */
export const LONG_CONTEXT_THRESHOLD = 100_000;

export const PRICES_PER_MTOK: Readonly<
  Record<ChatModel, Readonly<ModelPrice>>
> = {
  "claude-haiku-5-5": {
    input: 100_000,
    cacheWrite1h: 200_000,
    cacheRead: 10_000,
    output: 500_000,
    longInput: {
      input: 500_000,
      cacheWrite1h: 1_000_000,
      cacheRead: 50_000,
      output: 2_500_000,
    },
  },
  "claude-sonnet-5-5": {
    input: 2_000_000,
    cacheWrite1h: 4_000_000,
    cacheRead: 100_000,
    output: 10_000_000,
  },
};

const PER_MTOK = 1_000_000n;

function tokens(name: string, v: number | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new RangeError(`invalid token count: ${name}`);
  }
  return BigInt(v);
}

function ratesFor(model: ChatModel, promptTokens: bigint): Rates {
  const p = Object.hasOwn(PRICES_PER_MTOK, model)
    ? PRICES_PER_MTOK[model]
    : undefined;
  if (!p) throw new RangeError("unknown model");
  return p.longInput && promptTokens > BigInt(LONG_CONTEXT_THRESHOLD)
    ? p.longInput
    : p;
}

function ceilMicro(sum: bigint): number {
  const micro = (sum + PER_MTOK - 1n) / PER_MTOK;
  if (micro > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("cost overflow");
  return Number(micro);
}

/**
 * Cost of one response from its real `usage`, rounded up to whole micro-USD.
 * All `cache_creation_input_tokens` are billed at the 1h write rate (SCOPE uses
 * `ttl: "1h"`; any 5m or uncategorized writes are over-counted, never under-counted).
 */
export function costMicroUsd(model: ChatModel, usage: Usage): number {
  const input = tokens("input_tokens", usage.input_tokens);
  const output = tokens("output_tokens", usage.output_tokens);
  const read = tokens("cache_read_input_tokens", usage.cache_read_input_tokens);
  const write = tokens(
    "cache_creation_input_tokens",
    usage.cache_creation_input_tokens,
  );
  const r = ratesFor(model, input + read + write);
  return ceilMicro(
    input * BigInt(r.input) +
      read * BigInt(r.cacheRead) +
      write * BigInt(r.cacheWrite1h) +
      output * BigInt(r.output),
  );
}

/**
 * Upper bound for a request whose `usage` is unknown (stream aborted, SDK error after
 * the request was accepted): every prompt token at the most expensive input rate
 * (1h cache write) plus the full `max_tokens` of output.
 */
export function worstCaseCostMicroUsd(
  model: ChatModel,
  promptTokensEstimate: number,
  maxTokens: number,
): number {
  const prompt = tokens("promptTokensEstimate", promptTokensEstimate);
  const output = tokens("maxTokens", maxTokens);
  const r = ratesFor(model, prompt);
  const maxInputRate = Math.max(r.input, r.cacheWrite1h, r.cacheRead);
  return ceilMicro(prompt * BigInt(maxInputRate) + output * BigInt(r.output));
}
