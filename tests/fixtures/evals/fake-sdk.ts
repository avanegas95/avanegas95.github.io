// Scripted stand-in for the Anthropic SDK client used by the eval tests. Only the
// two stream entry points streamChat() uses exist; nothing reaches the network.
import type Anthropic from "@anthropic-ai/sdk";
import type { EvalCase } from "../../../evals/lib/case-schema.ts";

export type Ev = Record<string, unknown>;
export type Step = Ev | { throw: unknown };
export type Script = {
  steps: Step[];
  final?: { stop_reason: string | null; usage: Record<string, number> };
};

export const USAGE = {
  input_tokens: 20,
  output_tokens: 40,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 100,
};

export const start = (): Ev => ({
  type: "message_start",
  message: { usage: { ...USAGE, output_tokens: 1 } },
});
export const text = (t: string): Ev => ({
  type: "content_block_delta",
  delta: { type: "text_delta", text: t },
});
export const stop = (reason: string, out = 40): Ev => ({
  type: "message_delta",
  delta: { stop_reason: reason },
  usage: { output_tokens: out },
});

/** A full, successful reply script. */
export const reply = (
  body: string,
  usage: Record<string, number> = USAGE,
): Script => ({
  steps: [start(), text(body), stop("end_turn", usage.output_tokens)],
  final: { stop_reason: "end_turn", usage },
});

export type Call = { params: Record<string, unknown>; startedAt: number };

/**
 * `next(params)` picks the script for each call (in call order). Each call records
 * its params; `active` tracks streams in flight for ordering assertions.
 */
export function fakeClient(
  next: (params: Record<string, unknown>, n: number) => Script,
) {
  const calls: Call[] = [];
  const log: string[] = [];
  let active = 0;
  let maxActive = 0;
  const make = (p: Record<string, unknown>) => {
    const n = calls.length;
    calls.push({ params: p, startedAt: n });
    const script = next(p, n);
    return {
      abort() {},
      finalMessage: () =>
        Promise.resolve(
          script.final ?? { stop_reason: "end_turn", usage: USAGE },
        ),
      async *[Symbol.asyncIterator]() {
        active++;
        maxActive = Math.max(maxActive, active);
        log.push(`start ${n}`);
        try {
          for (const s of script.steps) {
            await new Promise((r) => setTimeout(r, 0));
            if ("throw" in s) throw s.throw;
            yield s;
          }
        } finally {
          active--;
          log.push(`end ${n}`);
        }
      },
    };
  };
  const client = {
    messages: { stream: make },
    beta: { messages: { stream: make } },
  } as unknown as Anthropic;
  return {
    client,
    calls,
    log,
    get maxActive() {
      return maxActive;
    },
  };
}

export function mkCase(
  id: string,
  category: EvalCase["category"],
  question: string,
  exp: Partial<EvalCase["expect"]> = {},
): EvalCase {
  return {
    id,
    category,
    messages: [{ role: "user", content: question }],
    expect: {
      mustInclude: [],
      mustIncludeAny: [],
      mustNotInclude: [],
      mustNotMatch: [],
      saysUnknown: false,
      redirects: false,
      maxWords: 120,
      ...exp,
    },
  };
}
