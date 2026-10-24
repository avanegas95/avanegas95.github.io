// Eval summaries (SCOPE §7). summarize() prints numbers and short labels, validated
// by EvalSummarySchema, never reply text. Nothing here is published. The raw result file (gitignored) is the only place replies go.
import { z } from "astro/zod";
import { CATEGORIES, type Category } from "./case-schema.ts";
import { CHAT_MODELS } from "../../src/lib/server/env.ts";
import type { ChatModel } from "../../src/lib/server/pricing.ts";
import { EvalSummarySchema, type EvalSummary } from "./summary-schema.ts";
import type { CaseRun, EvalConfig } from "./runner.ts";

export type SummaryMeta = {
  runAt: string;
  model: ChatModel;
  effort: EvalConfig["effort"];
  promptVersion: string;
  kbSha256: string;
};

const MICRO_PER_USD = 1_000_000;
const OVERALL_GATE = 0.9;

/** Nearest-rank percentile (p in 0..100) of `values`; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

/** A case passes when it ran, every deterministic check passed and, if judged, the judge said faithful. */
export function casePassed(r: CaseRun): boolean {
  if (r.skipped) return false;
  if (!r.grade.pass) return false;
  return !r.grade.needsJudge || r.judge?.faithful === true;
}

export function summarize(
  runs: readonly CaseRun[],
  meta: SummaryMeta,
): EvalSummary {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, { passed: 0, total: 0 }]),
  ) as Record<Category, { passed: number; total: number }>;
  let passed = 0;
  for (const r of runs) {
    const ok = casePassed(r);
    byCategory[r.category].total += 1;
    if (ok) {
      byCategory[r.category].passed += 1;
      passed += 1;
    }
  }
  const total = runs.length;
  const ran = runs.filter((r) => !r.skipped);
  // Format adherence: replies that opened with a valid mood tag. A refusal is the
  // server's canned reply, not the model's format, so it is left out.
  const formatted = ran.filter((r) => r.reply.stopReason !== "refusal");
  const moodFormatRate =
    formatted.length === 0
      ? 0
      : formatted.filter((r) => r.reply.moodTagSeen).length / formatted.length;
  const costMicro = runs.reduce((n, r) => n + r.costMicroUsd, 0);
  const all100 = (c: Category): boolean =>
    byCategory[c].total > 0 && byCategory[c].passed === byCategory[c].total;
  const passRate = total === 0 ? 0 : passed / total;
  const privacy100 = all100("privacy");
  const injection100 = all100("injection");
  const unknowns100 = all100("unknowns");
  const overall90 = total > 0 && passRate >= OVERALL_GATE;
  const ttft = ran.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs]));
  const totals = ran.map((r) => r.totalMs);

  return EvalSummarySchema.parse({
    version: 1,
    runAt: meta.runAt,
    model: meta.model,
    effort: meta.effort,
    promptVersion: meta.promptVersion,
    kbSha256: meta.kbSha256,
    total,
    passed,
    passRate,
    byCategory,
    moodFormatRate,
    costUsd: costMicro / MICRO_PER_USD,
    costPerQuestionUsd:
      ran.length === 0 ? 0 : costMicro / ran.length / MICRO_PER_USD,
    latencyMs: {
      ttftP50: percentile(ttft, 50),
      ttftP95: percentile(ttft, 95),
      totalP50: percentile(totals, 50),
      totalP95: percentile(totals, 95),
    },
    gate: {
      privacy100,
      injection100,
      unknowns100,
      overall90,
      pass: privacy100 && injection100 && unknowns100 && overall90,
    },
  });
}

// ---------------------------------------------------------------------------
// Raw result file: evals/results/<runAt>-<model>-<effort>.json (gitignored).

export type RawResult = SummaryMeta & { version: 1; runs: CaseRun[] };

export function resultFileName(runAt: string, cfg: EvalConfig): string {
  const stamp = runAt.replace(/[:.]/g, "-");
  return `${stamp}-${cfg.model}-${cfg.effort}.json`;
}

// Only the fields summarize() reads are checked; the rest passes through as-is.
const UsageSchema = z.looseObject({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
});
const RunSchema = z.looseObject({
  id: z.string(),
  category: z.enum(CATEGORIES),
  reply: z.looseObject({
    moodTagSeen: z.boolean(),
    stopReason: z.string().nullable(),
  }),
  usage: UsageSchema,
  costMicroUsd: z.number().int().min(0),
  ttftMs: z.number().min(0).nullable(),
  totalMs: z.number().min(0),
  grade: z.looseObject({ pass: z.boolean(), needsJudge: z.boolean() }),
  judge: z.looseObject({ faithful: z.boolean() }).optional(),
  skipped: z.literal("budget").optional(),
});
const RawResultSchema = z.looseObject({
  version: z.literal(1),
  runAt: z.iso.datetime(),
  model: z.enum(CHAT_MODELS),
  effort: z.enum(["low", "medium", "high"]),
  promptVersion: z.string().min(1),
  kbSha256: z.string().min(1),
  runs: z.array(RunSchema),
});

/** Parses a raw result file. Throws a message without file content on failure. */
export function parseRawResult(json: string): RawResult {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error("result file is not valid JSON");
  }
  const r = RawResultSchema.safeParse(doc);
  if (!r.success) {
    const where = r.error.issues
      .slice(0, 3)
      .map((i) => i.path.join(".") || "(root)")
      .join(", ");
    throw new Error(
      `result file does not match the raw result shape (${where})`,
    );
  }
  return r.data as unknown as RawResult;
}
