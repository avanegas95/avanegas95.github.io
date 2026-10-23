// SCOPE §6.2 BotID (basic mode). Fails closed: a thrown, missing or malformed verdict denies.
// Docs: https://vercel.com/docs/botid/get-started ("other" frameworks) and
// https://vercel.com/docs/botid/advanced-configuration (checkLevel must match the client).
import { checkBotId } from "botid/server";

export type BotCheck = (request: Request) => Promise<{ isBot: boolean }>;
export type BotResult =
  | { ok: true }
  | { ok: false; reason: "bot" }
  | { ok: false; reason: "unavailable" };

function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Production verifier. Astro is not Next.js, so the request headers are passed explicitly via
 * `advancedOptions.headers` (botid 1.5.11 uses them in development; on Vercel it reads the
 * platform request context instead).
 */
export const verifyHuman: BotCheck = async (request) => {
  // botid treats any NODE_ENV other than "production" as development and returns "human"
  // without calling Vercel. On a Vercel deployment that would be a silent pass, so refuse.
  // These platform vars can only make the check stricter, never skip it.
  const vercelEnv = process.env["VERCEL_ENV"];
  const deployed = vercelEnv === "production" || vercelEnv === "preview";
  if (deployed && process.env["NODE_ENV"] !== "production") {
    throw new Error("BotID would run in development mode on a deployment");
  }
  const result = await checkBotId({
    // checkLevel must equal the client's in src/scripts/botid-init.ts.
    advancedOptions: { checkLevel: "basic", headers: headersOf(request) },
  });
  return { isBot: result.isBot };
};

/** `check` is injected so tests can pass a fake verifier; production passes `verifyHuman`. */
export async function checkBot(
  check: BotCheck,
  request: Request,
): Promise<BotResult> {
  let verdict: unknown;
  try {
    verdict = await check(request);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const isBot =
    typeof verdict === "object" && verdict !== null
      ? (verdict as { isBot?: unknown }).isBot
      : undefined;
  if (isBot === false) return { ok: true };
  if (isBot === true) return { ok: false, reason: "bot" };
  return { ok: false, reason: "unavailable" };
}
