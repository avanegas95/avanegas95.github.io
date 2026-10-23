// Single zod-validated config read. Never throws; results carry names only, never values.
import { z } from "astro/zod";

export const CHAT_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;

export type ChatEnv = {
  anthropicApiKey: string;
  upstashUrl: string;
  upstashToken: string;
  ipHashSalt: string;
  chatModel: (typeof CHAT_MODELS)[number];
  chatEffort: "low" | "medium" | "high";
  dailyBudgetUsd: number;
};

export type EnvResult =
  | { ok: true; env: ChatEnv }
  | { ok: false; missing: string[]; invalid: string[] };

const REQUIRED = [
  "ANTHROPIC_API_KEY",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "IP_HASH_SALT",
] as const;

const budget = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().min(0).max(50));

const fields = {
  ANTHROPIC_API_KEY: z.string().min(1),
  KV_REST_API_URL: z
    .string()
    .startsWith("https://")
    .refine((v) => URL.canParse(v)),
  KV_REST_API_TOKEN: z.string().min(1),
  IP_HASH_SALT: z.string().min(32),
  CHAT_MODEL: z.enum(CHAT_MODELS),
  CHAT_EFFORT: z.enum(["low", "medium", "high"]),
  DAILY_BUDGET_USD: budget,
};

const DEFAULTS: Record<string, string> = {
  CHAT_MODEL: "claude-haiku-5-5",
  CHAT_EFFORT: "low",
  DAILY_BUDGET_USD: "1",
};

export function getEnv(
  source: Record<string, string | undefined> = process.env,
): EnvResult {
  const get = (k: string): string | undefined => {
    const v = source[k];
    const t = v?.trim();
    return t === undefined || t === "" ? undefined : t;
  };
  const missing: string[] = REQUIRED.filter((k) => get(k) === undefined);
  const invalid: string[] = [];
  const parsed: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(fields)) {
    const raw = get(name) ?? DEFAULTS[name];
    if (raw === undefined) continue; // reported in `missing`
    const r = schema.safeParse(raw);
    if (r.success) parsed[name] = r.data;
    else invalid.push(name);
  }
  if (missing.length || invalid.length) return { ok: false, missing, invalid };

  return {
    ok: true,
    env: {
      anthropicApiKey: parsed.ANTHROPIC_API_KEY as string,
      upstashUrl: parsed.KV_REST_API_URL as string,
      upstashToken: parsed.KV_REST_API_TOKEN as string,
      ipHashSalt: parsed.IP_HASH_SALT as string,
      chatModel: parsed.CHAT_MODEL as ChatEnv["chatModel"],
      chatEffort: parsed.CHAT_EFFORT as ChatEnv["chatEffort"],
      dailyBudgetUsd: parsed.DAILY_BUDGET_USD as number,
    },
  };
}
