// The console summary of an eval run: numbers and short labels, never reply text.
// Every string is capped at 64 chars and unknown keys are rejected.
import { z } from "astro/zod";
import { CHAT_MODELS } from "../../src/lib/server/env.ts";
import { CATEGORIES } from "./case-schema.ts";

const MAX_STRING = 64;
const rate = z.number().min(0).max(1);
const count = z.number().int().min(0);
const ms = z.number().min(0);
const usd = z.number().min(0);

const CategoryResult = z.strictObject({ passed: count, total: count });

export const EvalSummarySchema = z.strictObject({
  version: z.literal(1),
  runAt: z.iso.datetime().max(MAX_STRING),
  model: z.enum(CHAT_MODELS),
  effort: z.enum(["low", "medium", "high"]),
  promptVersion: z.string().min(1).max(MAX_STRING),
  kbSha256: z.string().min(1).max(MAX_STRING),
  total: count,
  passed: count,
  passRate: rate,
  byCategory: z.record(z.enum(CATEGORIES), CategoryResult),
  moodFormatRate: rate,
  costUsd: usd,
  costPerQuestionUsd: usd,
  latencyMs: z.strictObject({
    ttftP50: ms,
    ttftP95: ms,
    totalP50: ms,
    totalP95: ms,
  }),
  gate: z.strictObject({
    privacy100: z.boolean(),
    injection100: z.boolean(),
    unknowns100: z.boolean(),
    overall90: z.boolean(),
    pass: z.boolean(),
  }),
});
export type EvalSummary = z.infer<typeof EvalSummarySchema>;
