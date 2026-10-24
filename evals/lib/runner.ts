// Eval runner (SCOPE §7, Agent evals). Each case goes through the same server
// pipeline as POST /api/chat: buildParams -> streamChat -> mood parser -> scrubber,
// with a refusal replaced by REFUSAL_REPLY. Every paid call is gated by the shared
// SpendMeter (CLAUDE.md rule 5). Nothing here logs; reply text stays in CaseRun.
import type Anthropic from "@anthropic-ai/sdk";
import { isModelMood, type ModelMood } from "../../src/lib/moods.ts";
import type { SystemBlock } from "../../src/lib/prompt.ts";
import {
  ChatUpstreamError,
  MAX_TOKENS,
  REFUSAL_REPLY,
  buildParams,
  causeCodeOf,
  errorClassOf,
  streamChat,
} from "../../src/lib/server/anthropic.ts";
import {
  MOOD_BUFFER_CHARS,
  createMoodParser,
} from "../../src/lib/server/mood-parser.ts";
import {
  costMicroUsd,
  worstCaseCostMicroUsd,
  type ChatModel,
  type Usage,
} from "../../src/lib/server/pricing.ts";
import { parseChatRequest } from "../../src/lib/server/input.ts";
import { createScrubber, scrub } from "../../src/lib/server/scrub.ts";
import type { CallPlan, SpendMeter } from "./budget.ts";
import type { EvalCase } from "./case-schema.ts";
import { grade, type GradeResult, type Reply } from "./grade.ts";
import {
  JUDGE_MAX_TOKENS,
  JUDGE_MODEL,
  judgeFaithfulness,
  judgePromptBound,
  judgeSystem,
  type JudgeVerdict,
} from "./judge.ts";

export type Effort = "low" | "medium" | "high";
export type EvalConfig = { model: ChatModel; effort: Effort };

const MODEL_ALIASES: Readonly<Record<string, ChatModel>> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
};
const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

/** "haiku-low,haiku-medium,sonnet-low" -> configs. Throws on anything else. */
export function parseConfigs(s: string): EvalConfig[] {
  const out: EvalConfig[] = [];
  const seen = new Set<string>();
  for (const part of s.split(",")) {
    const label = part.trim().toLowerCase();
    const m = /^([a-z]+)-([a-z]+)$/.exec(label);
    const model =
      m && Object.hasOwn(MODEL_ALIASES, m[1] as string)
        ? MODEL_ALIASES[m[1] as string]
        : undefined;
    const effort = EFFORTS.find((e) => e === m?.[2]);
    if (!model || !effort) throw new Error(`unknown config: ${part.trim()}`);
    if (seen.has(label)) throw new Error(`duplicate config: ${label}`);
    seen.add(label);
    out.push({ model, effort });
  }
  return out;
}

export function configLabel(cfg: EvalConfig): string {
  const alias = Object.keys(MODEL_ALIASES).find(
    (k) => MODEL_ALIASES[k] === cfg.model,
  );
  return `${alias ?? cfg.model}-${cfg.effort}`;
}

/** Config or auth problems no retry fixes: the whole run stops at the first one. */
export const FATAL_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "AuthenticationError",
  "PermissionDeniedError",
  "NotFoundError",
  "BadRequestError",
]);

export type CaseRun = {
  id: string;
  category: EvalCase["category"];
  reply: Reply;
  /** Billed usage: the real `usage`, or a worst-case stand-in when it is unknown. */
  usage: Usage;
  usageEstimated?: true;
  /** Case call plus its judge call, in micro-USD. */
  costMicroUsd: number;
  ttftMs: number | null;
  totalMs: number;
  grade: GradeResult;
  judge?: JudgeVerdict;
  skipped?: "budget";
  errorClass?: string;
  /**
   * Raw result only: a short code for why the call errored (`stream_timeout`, or the
   * transport cause's `code`/`name`). Never a message body or a key.
   */
  errorCause?: string;
};

const utf8 = new TextEncoder();
const byteLength = (s: string): number => utf8.encode(s).byteLength;

type Turn = { role: "user" | "assistant"; content: string };
const turnsOf = (c: EvalCase): Turn[] =>
  c.messages.map((m) => ({ role: m.role, content: m.content }));

// Same-origin stand-in for the route's URL; only parseChatRequest sees it.
const INPUT_URL = "https://evals.invalid/api/chat";

/**
 * The case's turns as the route would send them: run through the handler's own
 * input validation (parseChatRequest: NFC, CRLF -> LF, control/bidi rejection,
 * length and alternation rules). Throws when the route would reject the case.
 */
export async function inputTurns(c: EvalCase): Promise<Turn[]> {
  const r = await parseChatRequest(
    new Request(INPUT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: turnsOf(c), sessionId: "evals_runner" }),
    }),
  );
  if (!r.ok)
    throw new Error(`case ${c.id} is rejected by the route (${r.error})`);
  return r.value.messages;
}

/** Cases with their turns normalised by inputTurns(); throws on the first rejected case. */
export async function normalizeCases(
  cases: readonly EvalCase[],
): Promise<EvalCase[]> {
  const out: EvalCase[] = [];
  for (const c of cases) out.push({ ...c, messages: await inputTurns(c) });
  return out;
}

/** UTF-8 bytes of the system blocks: a strict upper bound on their tokens. */
export function prefixTokenBound(system: readonly SystemBlock[]): number {
  return system.reduce((n, b) => n + byteLength(b.text), 0);
}

/** Upper bound on a case's turn tokens (bytes of the JSON turns, as the handler does). */
export function turnTokenBound(c: EvalCase): number {
  return byteLength(JSON.stringify(turnsOf(c)));
}

/** The worst a case call can cost, checked against the meter before it is sent. */
export function caseWorstMicroUsd(
  cfg: EvalConfig,
  system: readonly SystemBlock[],
  c: EvalCase,
): number {
  return worstCaseCostMicroUsd(
    cfg.model,
    prefixTokenBound(system) + turnTokenBound(c),
    MAX_TOKENS,
  );
}

/**
 * Usage to bill: the real usage when it prices; a stream that ended without a
 * stop_reason bills output at no less than max_tokens (as the handler does); an
 * unknown or unusable usage bills every prompt token at the 1h write rate plus the
 * full max_tokens, which is exactly worstCaseCostMicroUsd.
 */
export function billableUsage(
  model: ChatModel,
  usage: Usage | null,
  terminal: boolean,
  promptTokens: number,
  maxTokens: number,
): { usage: Usage; estimated: boolean } {
  if (usage) {
    const out = usage.output_tokens;
    const u =
      terminal || !Number.isSafeInteger(out) || out < 0
        ? usage
        : { ...usage, output_tokens: Math.max(out, maxTokens) };
    try {
      costMicroUsd(model, u);
      return { usage: u, estimated: false };
    } catch {
      // fall through to the worst case
    }
  }
  return {
    usage: {
      input_tokens: 0,
      output_tokens: maxTokens,
      cache_creation_input_tokens: promptTokens,
    },
    estimated: true,
  };
}

/**
 * The mood tag as the model wrote it. `null` when the reply did not open with a
 * closed, valid `<mood>X</mood>` within the parser's buffer: the parser then falls
 * back to DEFAULT_MOOD, which must not count as format adherence.
 */
export function moodTagOf(modelText: string): ModelMood | null {
  const s = modelText.trimStart();
  const m = /^<mood>([^<]*)<\/mood>/.exec(s);
  if (!m || m[0].length > MOOD_BUFFER_CHARS) return null;
  const mood = (m[1] as string).trim().toLowerCase();
  return isModelMood(mood) ? mood : null;
}

export async function runCase(
  client: Anthropic,
  cfg: EvalConfig,
  system: SystemBlock[],
  allowedUrls: readonly string[],
  c: EvalCase,
  now: () => number,
): Promise<CaseRun> {
  const params = buildParams(
    cfg.model,
    cfg.effort,
    system,
    await inputTurns(c),
  );
  const promptTokens = prefixTokenBound(system) + turnTokenBound(c);
  const started = now();
  let ttftMs: number | null = null;

  const parser = createMoodParser();
  const scrubber = createScrubber({ allowedUrls });
  let modelText = ""; // what the model streamed, mood tag included
  let rawText = ""; // after the mood parser, before the scrubber
  let text = ""; // what a visitor sees
  let refused = false;
  let stopReason: string | null = null;
  let usage: Usage | null = null;
  let errorClass: string | undefined;
  let errorCause: string | undefined;

  const feed = (t: string): void => {
    if (t === "") return;
    rawText += t;
    text += scrubber.push(t);
  };
  const refuse = (): void => {
    // The handler resets the bubble and sends the canned reply.
    refused = true;
    rawText += (rawText === "" ? "" : "\n") + REFUSAL_REPLY;
    text = scrub(REFUSAL_REPLY, { allowedUrls });
  };

  const ac = new AbortController();
  try {
    for await (const ev of streamChat(client, params, ac.signal)) {
      if (ev.type === "text") {
        ttftMs ??= now() - started;
        if (refused) continue;
        modelText += ev.text;
        feed(parser.push(ev.text).text);
      } else if (ev.type === "reset") {
        if (!refused) refuse();
      } else {
        stopReason = ev.outcome.stopReason;
        usage = ev.outcome.usage;
        if (ev.outcome.errorClass) errorClass = ev.outcome.errorClass;
        if (stopReason === null) break;
        if (stopReason === "refusal" && !refused) refuse();
        if (!refused) {
          feed(parser.end().text);
          text += scrubber.flush();
        }
        break;
      }
    }
  } catch (e) {
    errorClass =
      e instanceof ChatUpstreamError ? e.errorClass : errorClassOf(e);
    // A stall timeout is an errored case, not a fatal one: the run goes on.
    errorCause = e instanceof ChatUpstreamError ? e.causeCode : causeCodeOf(e);
    stopReason = null;
  }
  const totalMs = now() - started;

  const tag = moodTagOf(modelText);
  const reply: Reply = {
    // What the visitor sees on a refusal is `confused`; otherwise only a tag the
    // model actually wrote counts, never the parser's default.
    mood: refused ? "confused" : tag,
    moodTagSeen: tag !== null,
    text,
    rawText,
    stopReason,
  };
  // Only a call the server rejected before streaming billed nothing (auth, config
  // and 429 errors). Any other failure may have billed input: keep the worst case.
  const failedClean =
    errorClass !== undefined &&
    usage === null &&
    ttftMs === null &&
    (FATAL_ERROR_CLASSES.has(errorClass) || errorClass === "RateLimitError");
  const billed = failedClean
    ? {
        usage: { input_tokens: 0, output_tokens: 0 } as Usage,
        estimated: false,
      }
    : billableUsage(
        cfg.model,
        usage,
        stopReason !== null,
        promptTokens,
        MAX_TOKENS,
      );
  return {
    id: c.id,
    category: c.category,
    reply,
    usage: billed.usage,
    ...(billed.estimated ? { usageEstimated: true as const } : {}),
    costMicroUsd: costMicroUsd(cfg.model, billed.usage),
    ttftMs,
    totalMs,
    grade: grade(c, reply, allowedUrls),
    ...(errorClass ? { errorClass } : {}),
    ...(errorCause ? { errorCause } : {}),
  };
}

export function skippedRun(c: EvalCase): CaseRun {
  return {
    id: c.id,
    category: c.category,
    reply: {
      mood: null,
      moodTagSeen: false,
      text: "",
      rawText: "",
      stopReason: null,
    },
    usage: { input_tokens: 0, output_tokens: 0 },
    costMicroUsd: 0,
    ttftMs: null,
    totalMs: 0,
    grade: { pass: false, checks: [], needsJudge: false },
    skipped: "budget",
  };
}

// ---------------------------------------------------------------------------
// Planning

export type EvalPlan = {
  plans: CallPlan[];
  caseCalls: number;
  judgeCalls: number;
  preflightMicroUsd: number;
};

/**
 * Call plans for the whole invocation. One plan per model (configs of the same model
 * share the cached prefix, written once by the warm-up call) plus one for the judge.
 * The judge plan assumes every judge-tagged case reaches the judge.
 */
export function planCalls(
  configs: readonly EvalConfig[],
  cases: readonly EvalCase[],
  system: readonly SystemBlock[],
  kb: string,
): Omit<EvalPlan, "preflightMicroUsd"> {
  const prefixTokens = prefixTokenBound(system);
  const turnTokens = Math.max(0, ...cases.map(turnTokenBound));
  const plans: CallPlan[] = [];
  const models = [...new Set(configs.map((c) => c.model))];
  for (const model of models) {
    const n = configs.filter((c) => c.model === model).length;
    plans.push({
      model,
      prefixTokens,
      turnTokens,
      maxTokens: MAX_TOKENS,
      calls: n * cases.length,
    });
  }
  const judged = cases.filter((c) => c.expect.judge === "faithfulness");
  const judgeCalls = judged.length * configs.length;
  if (judgeCalls > 0) {
    const jPrefix = prefixTokenBound(judgeSystem(kb));
    const jTurn = Math.max(...judged.map((c) => judgePromptBound(c)));
    plans.push({
      model: JUDGE_MODEL,
      prefixTokens: jPrefix,
      turnTokens: jTurn,
      maxTokens: JUDGE_MAX_TOKENS,
      calls: judgeCalls,
    });
  }
  return { plans, caseCalls: configs.length * cases.length, judgeCalls };
}

// ---------------------------------------------------------------------------
// Orchestration

/**
 * Spend reservations for calls in flight: a call is sent only when the meter can
 * afford everything already reserved plus its own worst case.
 */
class Ledger {
  readonly #meter: SpendMeter;
  #reserved = 0;
  constructor(meter: SpendMeter) {
    this.#meter = meter;
  }
  reserve(worst: number): boolean {
    if (!this.#meter.canAfford(this.#reserved + worst)) return false;
    this.#reserved += worst;
    return true;
  }
  settle(worst: number, model: ChatModel, usage: Usage): number {
    this.#reserved -= worst;
    return this.#meter.charge(model, usage);
  }
}

/**
 * The first call for each cache key runs on its own; the others wait for it to
 * finish so the prefix is written once (the preflight assumes this).
 */
class Warmup {
  readonly #first = new Map<string, Promise<void>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const pending = this.#first.get(key);
    if (pending) {
      await pending;
      return fn();
    }
    let done!: () => void;
    this.#first.set(
      key,
      new Promise<void>((r) => {
        done = r;
      }),
    );
    try {
      return await fn();
    } finally {
      done();
    }
  }
}

export type RunOptions = {
  client: Anthropic;
  configs: readonly EvalConfig[];
  cases: readonly EvalCase[];
  system: SystemBlock[];
  allowedUrls: readonly string[];
  kb: string;
  meter: SpendMeter;
  now: () => number;
  onCase?: (cfg: EvalConfig, run: CaseRun) => void;
};

export type ConfigRuns = { config: EvalConfig; runs: CaseRun[] };
export type EvalAbort = { errorClass: string; caseId: string };
export type EvalResult = {
  results: ConfigRuns[];
  budgetStopped: boolean;
  aborted: EvalAbort | null;
};

/**
 * Configs run in parallel; within a config, cases run in order. Once any call
 * cannot be afforded, every remaining case of every config is skipped.
 */
export async function runEval(o: RunOptions): Promise<EvalResult> {
  const ledger = new Ledger(o.meter);
  const warmup = new Warmup();
  let stopped = false;
  let aborted: EvalAbort | null = null;
  const judgeSys = judgeSystem(o.kb);

  const runConfig = async (cfg: EvalConfig): Promise<ConfigRuns> => {
    const runs: CaseRun[] = [];
    for (const c of o.cases) {
      if (aborted) {
        // Another call aborted the run: keep the file complete, but flagged as aborted.
        const s = skippedRun(c);
        o.onCase?.(cfg, s);
        runs.push(s);
        continue;
      }
      const run = await warmup.run(`chat:${cfg.model}`, async () => {
        const worst = caseWorstMicroUsd(cfg, o.system, c);
        if (aborted) return skippedRun(c);
        if (stopped || !ledger.reserve(worst)) {
          stopped = true;
          return skippedRun(c);
        }
        const r = await runCase(
          o.client,
          cfg,
          o.system,
          o.allowedUrls,
          c,
          o.now,
        );
        ledger.settle(worst, cfg.model, r.usage);
        if (r.errorClass && FATAL_ERROR_CLASSES.has(r.errorClass)) {
          aborted ??= { errorClass: r.errorClass, caseId: c.id };
        }
        return r;
      });
      if (!run.skipped && !aborted && c.expect.judge === "faithfulness") {
        await warmup.run("judge", async () => {
          const prompt =
            prefixTokenBound(judgeSys) + judgePromptBound(c, run.reply.text);
          const worst = worstCaseCostMicroUsd(
            JUDGE_MODEL,
            prompt,
            JUDGE_MAX_TOKENS,
          );
          if (stopped || !ledger.reserve(worst)) {
            stopped = true;
            run.skipped = "budget";
            return;
          }
          const v = await judgeFaithfulness(o.client, o.kb, c, run.reply.text);
          run.judge = v;
          const billed = billableUsage(
            JUDGE_MODEL,
            v.usage,
            v.stopReason !== null,
            prompt,
            JUDGE_MAX_TOKENS,
          );
          run.costMicroUsd += ledger.settle(worst, JUDGE_MODEL, billed.usage);
        });
      }
      o.onCase?.(cfg, run);
      runs.push(run);
    }
    return { config: cfg, runs };
  };

  const results = await Promise.all(o.configs.map(runConfig));
  return { results, budgetStopped: stopped, aborted };
}
