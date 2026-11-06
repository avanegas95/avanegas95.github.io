// P4-16: the eval runner fails fast on auth/config errors and writes only under
// evals/results/. SDK scripted; nothing reaches the network (CLAUDE.md rule 5).
import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Forbidden {
    constructor() {
      throw new Error("real Anthropic client constructed in a test");
    }
  }
  return { ...actual, default: Forbidden, Anthropic: Forbidden };
});

import {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { SpendMeter } from "../../evals/lib/budget.ts";
import type { EvalCase } from "../../evals/lib/case-schema.ts";
import { runEval, type EvalConfig } from "../../evals/lib/runner.ts";
import { EXIT, RESULTS_DIR, main, type CliDeps } from "../../evals/run.ts";
import { buildSystemPrompt, systemBlocks } from "../../src/lib/prompt.ts";
import {
  fakeClient,
  mkCase,
  reply,
  type Script,
} from "../fixtures/evals/fake-sdk.ts";

const KB = "## contact\nLinkedIn: https://www.linkedin.com/in/avanegas95";
const SYSTEM = systemBlocks(buildSystemPrompt(KB));
const URLS = ["https://www.linkedin.com/in/avanegas95"];
const HAIKU_LOW: EvalConfig = { model: "claude-haiku-5-5", effort: "low" };
const GOOD = "<mood>proud</mood> Anderson is a Staff SQA Engineer.";
const KEY = "sk-ant-SENTINEL-KEY-0000";
const SPEND_ENV = { EVAL_ALLOW_SPEND: "1", ANTHROPIC_API_KEY: KEY };

const clock = () => {
  let t = 1_000;
  return () => (t += 10);
};

type ErrCtor = abstract new (...a: never[]) => Error;
const failing = (Cls: ErrCtor, status: number): Script => ({
  steps: [
    {
      throw: new (Cls as unknown as new (...a: unknown[]) => Error)(
        status,
        {},
        "x",
        new Headers(),
      ),
    },
  ],
});

const FIVE: EvalCase[] = [1, 2, 3, 4, 5].map((n) =>
  mkCase(`factual-0${n}`, "factual", `Q${n} about Anderson?`, {
    mustInclude: ["staff sqa"],
  }),
);

function cli(cases: EvalCase[], script: (n: number) => Script) {
  const sdk = fakeClient((_p, n) => script(n));
  const files = new Map<string, string>();
  const out: string[] = [];
  const createClient = vi.fn(() => sdk.client);
  const deps: Partial<CliDeps> = {
    createClient,
    loadCases: () => cases,
    kb: () => KB,
    now: clock(),
    writeFile: (p, d) => void files.set(p, d),
    log: (l) => void out.push(l),
    error: (l) => void out.push(l),
  };
  return { sdk, files, out, createClient, deps };
}

describe("fatal errors abort the run", () => {
  it.each([
    ["AuthenticationError", AuthenticationError, 401],
    ["PermissionDeniedError", PermissionDeniedError, 403],
    ["NotFoundError", NotFoundError, 404],
    ["BadRequestError", BadRequestError, 400],
  ] as const)("%s on case 1 of 5 stops at once", async (name, Cls, status) => {
    const h = cli(FIVE, () => failing(Cls, status));
    const code = await main(["--spend"], SPEND_ENV, h.deps);
    expect(code).not.toBe(EXIT.pass);
    expect(code).not.toBe(EXIT.fail);
    expect(h.sdk.calls).toHaveLength(1);
    const logs = h.out.join("\n");
    expect(logs).toContain(
      `eval ABORT: ${name} on factual-01; check ANTHROPIC_API_KEY / CHAT_MODEL`,
    );
    expect(logs).not.toContain(KEY);
    expect(logs).not.toContain("sk-ant");
    // The raw file is still written for triage.
    expect([...h.files.keys()].some((k) => k.startsWith(RESULTS_DIR))).toBe(
      true,
    );
  });

  it("runEval reports the abort and makes no judge call", async () => {
    const judged = [
      mkCase("faith-01", "factual", "Q?", { judge: "faithfulness" }),
      mkCase("faith-02", "factual", "Q2?", { judge: "faithfulness" }),
    ];
    const sdk = fakeClient(() => failing(AuthenticationError, 401));
    const r = await runEval({
      client: sdk.client,
      configs: [HAIKU_LOW],
      cases: judged,
      system: SYSTEM,
      allowedUrls: URLS,
      kb: KB,
      meter: new SpendMeter(),
      now: clock(),
    });
    expect(r.aborted).toEqual({
      errorClass: "AuthenticationError",
      caseId: "faith-01",
    });
    expect(sdk.calls).toHaveLength(1);
    expect(r.results[0]!.runs).toHaveLength(2);
    expect(r.results[0]!.runs[1]!.skipped).toBe("budget");
  });

  it("a config cut short by another config's abort stays complete", async () => {
    const sdk = fakeClient(() => failing(AuthenticationError, 401));
    const r = await runEval({
      client: sdk.client,
      configs: [HAIKU_LOW, { model: "claude-haiku-5-5", effort: "medium" }],
      cases: FIVE,
      system: SYSTEM,
      allowedUrls: URLS,
      kb: KB,
      meter: new SpendMeter(),
      now: clock(),
    });
    for (const { runs } of r.results) {
      expect(runs).toHaveLength(5);
      expect(runs.every((x) => x.skipped || x.errorClass)).toBe(true);
    }
  });

  it("a rate limit that recovers (a later success) does not abort and the case passes", async () => {
    const sdk = fakeClient((_p, n) =>
      n === 0 ? failing(RateLimitError, 429) : reply(GOOD),
    );
    const r = await runEval({
      client: sdk.client,
      configs: [HAIKU_LOW],
      cases: FIVE.slice(0, 2),
      system: SYSTEM,
      allowedUrls: URLS,
      kb: KB,
      meter: new SpendMeter(),
      now: clock(),
    });
    expect(r.aborted).toBeNull();
    expect(r.results[0]!.runs[1]!.grade.pass).toBe(true);
    expect(r.results[0]!.runs[1]!.errorClass).toBeUndefined();
  });

  it("a RateLimitError is errored but does not abort, ", async () => {
    const h = cli(FIVE, (n) =>
      n === 0 ? failing(RateLimitError, 429) : reply(GOOD),
    );
    const code = await main(["--spend"], SPEND_ENV, h.deps);
    expect(h.sdk.calls).toHaveLength(5);
    const logs = h.out.join("\n");
    expect(logs).not.toContain("eval ABORT");
    expect(code).not.toBe(EXIT.pass);
    expect([...h.files.keys()].every((k) => k.startsWith(RESULTS_DIR))).toBe(
      true,
    );
  });

  it("an aborted run writes only under evals/results/", async () => {
    const h = cli(FIVE, () => failing(AuthenticationError, 401));
    await main(["--spend"], SPEND_ENV, h.deps);
    expect([...h.files.keys()].every((k) => k.startsWith(RESULTS_DIR))).toBe(
      true,
    );
  });
});

describe("key preflight", () => {
  it.each(["", "[SENSITIVE]", "sk-ant-x y", "abc", "sk-ant-a[b"])(
    "rejects %j with zero SDK calls and no key echo",
    async (key) => {
      const h = cli(FIVE, () => reply(GOOD));
      const code = await main(
        ["--spend"],
        { EVAL_ALLOW_SPEND: "1", ANTHROPIC_API_KEY: key },
        h.deps,
      );
      expect(code).not.toBe(EXIT.pass);
      expect(h.createClient).not.toHaveBeenCalled();
      expect(h.sdk.calls).toHaveLength(0);
      const logs = h.out.join("\n");
      expect(logs).toContain("vercel env pull");
      if (key.length > 3) expect(logs).not.toContain(key);
    },
  );

  it("accepts a well-formed key", async () => {
    const h = cli(FIVE, () => reply(GOOD));
    await main(
      ["--spend"],
      { EVAL_ALLOW_SPEND: "1", ANTHROPIC_API_KEY: "sk-ant-api03-test" },
      h.deps,
    );
    expect(h.createClient).toHaveBeenCalledTimes(1);
  });

  it("a dry run skips the preflight", async () => {
    const h = cli(FIVE, () => reply(GOOD));
    const code = await main(
      ["--dry-run"],
      { ANTHROPIC_API_KEY: "[SENSITIVE]" },
      h.deps,
    );
    expect(code).toBe(EXIT.pass);
    expect(h.createClient).not.toHaveBeenCalled();
  });
});

describe("failed calls meter nothing", () => {
  const c = mkCase("factual-01", "factual", "Q?", { mustInclude: ["x"] });
  const run = (
    client: ReturnType<typeof fakeClient>["client"],
    m: SpendMeter,
  ) =>
    runEval({
      client,
      configs: [HAIKU_LOW],
      cases: [c],
      system: SYSTEM,
      allowedUrls: URLS,
      kb: KB,
      meter: m,
      now: clock(),
    });

  it("an auth-failed case adds $0; a successful one meters real usage", async () => {
    const m1 = new SpendMeter();
    const r1 = await run(
      fakeClient(() => failing(AuthenticationError, 401)).client,
      m1,
    );
    expect(m1.spentMicroUsd).toBe(0);
    expect(r1.results[0]!.runs[0]!.costMicroUsd).toBe(0);

    const m2 = new SpendMeter();
    const r2 = await run(fakeClient(() => reply(GOOD)).client, m2);
    expect(m2.spentMicroUsd).toBe(r2.results[0]!.runs[0]!.costMicroUsd);
    expect(m2.spentMicroUsd).toBeGreaterThan(0);
  });
});
