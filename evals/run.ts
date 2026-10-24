// Eval CLI (SCOPE §7, Agent evals). MANUAL or scheduled only, never on PRs
// (CLAUDE.md rule 5). Spends money only with --spend AND EVAL_ALLOW_SPEND=1, under the
// $1 hard cap (evals/lib/budget.ts); otherwise it is a dry run that builds every
// request, prints the preflight estimate and creates no client.
//
// Usage:
//   node evals/run.ts [--dry-run] [--spend] [--configs haiku-low,sonnet-low]
//                     [--only id,id] [--max-usd 0.5] [--cases path]
// Exit: 0 gate pass (or dry run), 1 gate fail, 2 usage/config error, 3 budget stop.
//
// Results stay local (gitignored evals/results/); nothing is ever published.
// Logs carry counts, labels and dollar amounts only: never the API key, request
// bodies or reply text (reply text goes only into the gitignored raw result file).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { buildKb, kbSha256, loadKbSources } from "../src/lib/kb.ts";
import {
  PROMPT_VERSION,
  buildSystemPrompt,
  extractKbUrls,
  systemBlocks,
} from "../src/lib/prompt.ts";
import {
  HARD_CAP_USD,
  SpendMeter,
  preflightMicroUsd,
  spendAllowed,
} from "./lib/budget.ts";
import { parseCasesYaml, type EvalCase } from "./lib/case-schema.ts";
import { resultFileName, summarize, type RawResult } from "./lib/report.ts";
import type { EvalSummary } from "./lib/summary-schema.ts";

type Runner = typeof import("./lib/runner.ts");

export const CASES_PATH = "evals/cases.yaml";
export const RESULTS_DIR = "evals/results";
export const DEFAULT_CONFIGS = "haiku-low";

/** Key shape check before any client exists. `vercel env pull` writes Sensitive vars as a placeholder. */
export function keyLooksValid(key: string | undefined): boolean {
  return (
    typeof key === "string" &&
    key.startsWith("sk-ant-") &&
    !key.includes("[") &&
    !/\s/.test(key)
  );
}

/** True when running under CI (GitHub Actions and most runners set CI=true). */
export function isCi(env: Record<string, string | undefined>): boolean {
  const v = (env["CI"] ?? "").trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

export const EXIT = { pass: 0, fail: 1, usage: 2, budget: 3 } as const;

export type CliDeps = {
  createClient(apiKey: string): Anthropic | Promise<Anthropic>;
  loadRunner(): Promise<Runner>;
  loadCases(path: string): EvalCase[];
  kb(): string;
  now(): number;
  writeFile(path: string, data: string): void;
  log(line: string): void;
  error(line: string): void;
};

const defaultDeps: CliDeps = {
  async createClient(apiKey) {
    const { createClient } = await import("../src/lib/server/anthropic.ts");
    return createClient(apiKey);
  },
  loadRunner: () => import("./lib/runner.ts"),
  loadCases: (path) => parseCasesYaml(readFileSync(path, "utf8")),
  kb: () => buildKb(loadKbSources()),
  now: () => Date.now(),
  writeFile(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, "utf8");
  },
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

type Args = {
  dryRun: boolean;
  spend: boolean;
  configs: string;
  only: string[] | null;
  maxUsd: number | undefined;
  cases: string;
};

const VALUE_FLAGS = new Set(["--configs", "--only", "--max-usd", "--cases"]);

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    dryRun: false,
    spend: false,
    configs: DEFAULT_CONFIGS,
    only: null,
    maxUsd: undefined,
    cases: CASES_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    if (flag === "--dry-run") a.dryRun = true;
    else if (flag === "--spend") a.spend = true;
    else if (VALUE_FLAGS.has(flag)) {
      const v = argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      if (flag === "--configs") a.configs = v;
      else if (flag === "--only") {
        a.only = v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
      } else if (flag === "--max-usd") {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error("--max-usd must be a positive number");
        }
        a.maxUsd = n;
      } else a.cases = v;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return a;
}

const usd = (micro: number): string => `$${(micro / 1_000_000).toFixed(4)}`;
const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

function printSummary(
  log: (l: string) => void,
  label: string,
  s: EvalSummary,
): void {
  log(
    `${label}: ${s.passed}/${s.total} (${pct(s.passRate)}), mood format ${pct(s.moodFormatRate)}, ` +
      `cost $${s.costUsd.toFixed(4)} ($${s.costPerQuestionUsd.toFixed(5)}/question), ` +
      `ttft p50/p95 ${Math.round(s.latencyMs.ttftP50)}/${Math.round(s.latencyMs.ttftP95)} ms, ` +
      `total p50/p95 ${Math.round(s.latencyMs.totalP50)}/${Math.round(s.latencyMs.totalP95)} ms`,
  );
  const cats = Object.entries(s.byCategory)
    .filter(([, v]) => v.total > 0)
    .map(([k, v]) => `${k} ${v.passed}/${v.total}`)
    .join(", ");
  log(`  categories: ${cats}`);
  const g = s.gate;
  log(
    `  gate: ${g.pass ? "PASS" : "FAIL"} (privacy100 ${g.privacy100}, injection100 ${g.injection100}, ` +
      `unknowns100 ${g.unknowns100}, overall90 ${g.overall90})`,
  );
}

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  over: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps, ...over };
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    deps.error(`eval ERROR ${(e as Error).message}`);
    return EXIT.usage;
  }
  const runner = await deps.loadRunner();

  // Configuration: configs, cases, prompt and every request, before any client.
  let configs: ReturnType<Runner["parseConfigs"]>;
  let cases: EvalCase[];
  let kb: string;
  try {
    configs = runner.parseConfigs(args.configs);
    cases = deps.loadCases(args.cases);
    if (args.only) {
      const want = new Set(args.only);
      const unknown = [...want].filter((id) => !cases.some((c) => c.id === id));
      if (unknown.length > 0)
        throw new Error(`unknown case id(s): ${unknown.join(", ")}`);
      cases = cases.filter((c) => want.has(c.id));
    }
    if (cases.length === 0) throw new Error("no cases to run");
    // The route's own input validation; a case it would reject is a config error.
    cases = await runner.normalizeCases(cases);
    kb = deps.kb();
  } catch (e) {
    deps.error(`eval ERROR ${(e as Error).message}`);
    return EXIT.usage;
  }
  const prompt = buildSystemPrompt(kb);
  const system = systemBlocks(prompt);
  const allowedUrls = extractKbUrls(kb);

  let preflight: number;
  let plan: ReturnType<Runner["planCalls"]>;
  try {
    const { buildParams } = await import("../src/lib/server/anthropic.ts");
    for (const cfg of configs) {
      for (const c of cases) {
        buildParams(
          cfg.model,
          cfg.effort,
          system,
          c.messages.map((m) => ({ role: m.role, content: m.content })),
        );
      }
    }
    plan = runner.planCalls(configs, cases, system, kb);
    preflight = preflightMicroUsd(plan.plans);
  } catch (e) {
    deps.error(`eval ERROR request build failed: ${(e as Error).message}`);
    return EXIT.usage;
  }

  const labels = configs.map(runner.configLabel).join(", ");
  const cap =
    args.maxUsd !== undefined && args.maxUsd < HARD_CAP_USD
      ? args.maxUsd
      : HARD_CAP_USD;
  deps.log(`configs: ${labels}`);
  deps.log(
    `cases: ${cases.length}; requests: ${plan.caseCalls} chat + up to ${plan.judgeCalls} judge`,
  );
  deps.log(`preflight: ${usd(preflight)} upper bound (cap $${cap.toFixed(2)})`);
  if (preflight > Math.floor(cap * 1_000_000)) {
    deps.log("preflight is over the cap: a paid run would be refused");
  }

  const optedIn = args.spend && env["EVAL_ALLOW_SPEND"] === "1";
  if (args.dryRun || !optedIn) {
    if (args.spend && !args.dryRun) {
      deps.log("dry run: --spend also needs EVAL_ALLOW_SPEND=1");
    } else {
      deps.log("dry run: no API calls made");
    }
    return EXIT.pass;
  }

  if (isCi(env)) {
    deps.error(
      "eval REFUSED: CI is set; paid evals run only on a developer machine. No API call was made.",
    );
    return EXIT.usage;
  }
  if (!keyLooksValid(env["ANTHROPIC_API_KEY"])) {
    deps.error(
      "eval ERROR ANTHROPIC_API_KEY is missing or malformed. Export the real key in your shell " +
        "(`vercel env pull` returns Sensitive vars redacted); no API call was made.",
    );
    return EXIT.usage;
  }
  const gate = spendAllowed(argv, env, preflight, args.maxUsd);
  if (!gate.ok) {
    deps.error(`eval REFUSED ${gate.reason}`);
    return gate.reason === "over_cap" ? EXIT.budget : EXIT.usage;
  }

  const client = await deps.createClient(env["ANTHROPIC_API_KEY"] as string);
  const meter = new SpendMeter(args.maxUsd);
  const runAt = new Date(deps.now()).toISOString();
  const { results, budgetStopped, aborted } = await runner.runEval({
    client,
    configs,
    cases,
    system,
    allowedUrls,
    kb,
    meter,
    now: deps.now,
  });

  const kbSha = kbSha256(kb);
  let allPass = true;
  for (const { config, runs } of results) {
    const meta = {
      runAt,
      model: config.model,
      effort: config.effort,
      promptVersion: PROMPT_VERSION,
      kbSha256: kbSha,
    };
    const raw: RawResult = { version: 1, ...meta, runs };
    deps.writeFile(
      `${RESULTS_DIR}/${resultFileName(runAt, config)}`,
      `${JSON.stringify(raw, null, 2)}\n`,
    );
    const summary = summarize(runs, meta);
    printSummary(deps.log, runner.configLabel(config), summary);
    allPass &&= summary.gate.pass;
  }
  deps.log(`spent: ${usd(meter.spentMicroUsd)}`);
  if (aborted) {
    deps.error(
      `eval ABORT: ${aborted.errorClass} on ${aborted.caseId}; check ANTHROPIC_API_KEY / CHAT_MODEL`,
    );
    return EXIT.usage;
  }
  if (budgetStopped) {
    deps.error("eval BUDGET STOP: remaining cases skipped");
    return EXIT.budget;
  }
  return allPass ? EXIT.pass : EXIT.fail;
}

/**
 * Lets the runner load the server pipeline under plain `node`: kb-bundle.ts uses
 * Vite's import.meta.glob, so it is swapped for the loadKbSources() equivalent
 * (parity is unit-tested in kb-bundle tests), and extensionless relative imports
 * inside src/ resolve to their .ts file. Production code is untouched.
 */
export function registerNodeHooks(): void {
  const src = new URL("../src/", import.meta.url).href;
  const kbBundle = new URL("../src/lib/server/kb-bundle.ts", import.meta.url)
    .href;
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (e) {
        if (
          (e as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND" &&
          specifier.startsWith(".") &&
          !/\.[a-z]+$/i.test(specifier) &&
          context.parentURL?.startsWith(src)
        ) {
          return next(`${specifier}.ts`, context);
        }
        throw e;
      }
    },
    load(url, context, next) {
      if (url !== kbBundle) return next(url, context);
      return {
        format: "module",
        shortCircuit: true,
        source: [
          'import { buildKb, loadKbSources } from "../kb.ts";',
          'import { buildSystemPrompt } from "../prompt.ts";',
          'export function sourcesFromGlob() { throw new Error("not available under node"); }',
          "export function bundledKbSources() { return loadKbSources(); }",
          "let cached;",
          "export function getSystemPrompt() { return (cached ??= buildSystemPrompt(buildKb(loadKbSources()))); }",
        ].join("\n"),
      };
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  registerNodeHooks();
  process.exitCode = await main(process.argv.slice(2), process.env);
}
