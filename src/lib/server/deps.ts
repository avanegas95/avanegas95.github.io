// Production wiring for POST /api/chat. Every control is on; nothing here can turn one
// off. Nothing runs at import time: env is read per request and SDK/Redis clients are
// built lazily after `env()` is ok, then reused for the life of the instance (cold
// start), so the site builds and imports with no secrets present.
import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import { buildKb } from "../kb.ts";
import { extractKbUrls } from "../prompt.ts";
import { createClient } from "./anthropic.ts";
import { verifyHuman } from "./botid.ts";
import type { BudgetStore } from "./budget.ts";
import type { ChatDeps } from "./chat-handler.ts";
import { getEnv, type ChatEnv } from "./env.ts";
import { bundledKbSources, getSystemPrompt } from "./kb-bundle.ts";
import { logMetric } from "./log.ts";
import { createUpstashLimiters } from "./ratelimit.ts";

/** Caches one value per distinct key (env values never change within an instance). */
function lazy<V>(
  key: (env: ChatEnv) => string,
  make: (env: ChatEnv) => V,
): (env: ChatEnv) => V {
  let cached: { key: string; value: V } | undefined;
  return (env) => {
    const k = key(env);
    if (cached?.key !== k) cached = { key: k, value: make(env) };
    return cached.value;
  };
}

const upstashKey = (env: ChatEnv): string =>
  `${env.upstashUrl}\n${env.upstashToken}`;

let kbUrls: readonly string[] | undefined;

export const prodDeps: ChatDeps = {
  env: () => getEnv(process.env),
  botCheck: verifyHuman,
  waitUntil,
  limiters: lazy(upstashKey, createUpstashLimiters),
  budgetStore: lazy(
    upstashKey,
    (env): BudgetStore =>
      new Redis({ url: env.upstashUrl, token: env.upstashToken }),
  ),
  anthropic: lazy(
    (env) => env.anthropicApiKey,
    (env) => createClient(env.anthropicApiKey),
  ),
  systemPrompt: getSystemPrompt,
  kbUrls: () => (kbUrls ??= extractKbUrls(buildKb(bundledKbSources()))),
  log: (m) => logMetric(m),
  now: () => Date.now(),
};
