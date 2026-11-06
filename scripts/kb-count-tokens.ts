// MANUAL ONLY. Calls the real Anthropic countTokens endpoint (free, rate-limited),
// so it must never run in tests or CI (CLAUDE.md rule 5). Needs ANTHROPIC_API_KEY.
// Usage: node scripts/kb-count-tokens.ts [--model claude-haiku-5-5]
// Exit: 0 ok or skipped (no key), 1 outside 512..15000 tokens, 2 usage/API error.
import { pathToFileURL } from "node:url";
import { KB_TOKEN_BUDGET, buildKb, loadKbSources } from "../src/lib/kb.ts";
import { buildSystemPrompt, systemBlocks } from "../src/lib/prompt.ts";

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const MIN_CACHEABLE = 512;

export function parseArgs(argv: readonly string[]): { model: string } {
  let model = DEFAULT_MODEL;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") {
      const v = argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) {
        throw new Error("--model needs a value");
      }
      model = v;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { model };
}

export async function run(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  let model: string;
  try {
    model = parseArgs(argv).model;
  } catch (e) {
    console.error(`kb-count-tokens ERROR ${(e as Error).message}`);
    return 2;
  }
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.log("skipped: no key");
    return 0;
  }
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const prompt = buildSystemPrompt(buildKb(loadKbSources()));
    const messages = [{ role: "user" as const, content: "Hi" }];
    const [withSystem, probeOnly] = await Promise.all([
      client.messages.countTokens({
        model,
        system: systemBlocks(prompt),
        messages,
      }),
      client.messages.countTokens({ model, messages }),
    ]);
    // Subtract the bare probe message so only the system prompt is counted.
    const n = withSystem.input_tokens - probeOnly.input_tokens;
    const ok = n >= MIN_CACHEABLE && n <= KB_TOKEN_BUDGET;
    console.log(`systemTokens=${n} minCacheable=${MIN_CACHEABLE} ok=${ok}`);
    return ok ? 0 : 1;
  } catch (e) {
    // Never print the error object: it may echo request details.
    console.error(
      `kb-count-tokens ERROR ${e instanceof Error ? e.constructor.name : "unknown"}`,
    );
    return 2;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await run(process.argv.slice(2), process.env);
}
