// P6-08: criterion-judge fallback for the redirects and offers-follow-up checks.
// The SDK is a scripted fake; the real API is never reached (CLAUDE.md rule 5).
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

import { SpendMeter, preflightMicroUsd } from "../../evals/lib/budget.ts";
import { EvalCaseSchema } from "../../evals/lib/case-schema.ts";
import { grade, type Reply } from "../../evals/lib/grade.ts";
import {
  criterionSystem,
  judgeCriterion,
  parseCriterion,
} from "../../evals/lib/judge.ts";
import {
  caseWorstMicroUsd,
  parseConfigs,
  planCalls,
  prefixTokenBound,
  runEval,
  turnTokenBound,
  type EvalConfig,
} from "../../evals/lib/runner.ts";
import { buildSystemPrompt, systemBlocks } from "../../src/lib/prompt.ts";
import { MAX_TOKENS } from "../../src/lib/server/anthropic.ts";
import {
  fakeClient,
  mkCase,
  reply,
  start,
  stop,
  text,
  type Script,
} from "../fixtures/evals/fake-sdk.ts";

const KB = "## contact\nLinkedIn: https://www.linkedin.com/in/avanegas95";
const SYSTEM = systemBlocks(buildSystemPrompt(KB));
const HAIKU_LOW: EvalConfig = { model: "claude-haiku-5-5", effort: "low" };
const clock = () => {
  let t = 1_000;
  return () => (t += 10);
};

const isCriterion = (p: Record<string, unknown>): boolean =>
  (p["system"] as { text: string }[])[0]!.text.includes("ANSWER: YES");

const MISS = "<mood>happy</mood> Pasta needs salted water and a good sauce.";
const HIT =
  "<mood>happy</mood> Happy to chat about Anderson's testing work instead.";
const CONTACT_ONLY =
  "<mood>happy</mood> You can reach Anderson through his work email.";

const REDIRECT_CASE = mkCase(
  "off_topic-01",
  "off_topic",
  "Best pasta recipe?",
  {
    redirects: true,
  },
);
const FOLLOW_CASE = mkCase("tone-04", "tone", "Tell me everything.", {
  offersFollowUp: true,
  mustIncludeAny: ["ask blob", "want me to"],
});

async function run(c = REDIRECT_CASE, chatText = MISS, judge: Script) {
  const sdk = fakeClient((p) => (isCriterion(p) ? judge : reply(chatText)));
  const res = await runEval({
    client: sdk.client,
    configs: [HAIKU_LOW],
    cases: [c],
    system: SYSTEM,
    allowedUrls: [],
    kb: KB,
    meter: new SpendMeter(),
    now: clock(),
  });
  const r = res.results[0]!.runs[0]!;
  const judged = sdk.calls.filter((x) => isCriterion(x.params));
  return { r, judged, sdk, res };
}

describe.each([
  ["redirects", REDIRECT_CASE, MISS, HIT],
  [
    "offers_follow_up",
    FOLLOW_CASE,
    "<mood>happy</mood> Here is the first part.",
    "<mood>happy</mood> Here is the first part. Want me to cover the rest?",
  ],
] as const)("%s check", (id, c, missText, hitText) => {
  it("phrase hit passes and the judge is not called", async () => {
    const { r, judged } = await run(c, hitText, reply("ANSWER: NO"));
    expect(judged).toHaveLength(0);
    expect(r.grade.checks.find((k) => k.id === id)).toEqual({ id, pass: true });
  });

  it("phrase miss and judge yes passes with a judge detail", async () => {
    const { r, judged } = await run(c, missText, reply("Fine.\nANSWER: YES"));
    expect(judged).toHaveLength(1);
    expect(r.grade.checks.find((k) => k.id === id)).toEqual({
      id,
      pass: true,
      detail: "judge: yes",
    });
    expect(r.grade.pass).toBe(true);
    expect(r.grade.criteria).toBeUndefined();
    expect(r.costMicroUsd).toBeGreaterThan(0);
  });

  it("phrase miss and judge no fails", async () => {
    const { r } = await run(c, missText, reply("ANSWER: NO"));
    expect(r.grade.checks.find((k) => k.id === id)).toMatchObject({
      pass: false,
      detail: "judge: no",
    });
    expect(r.grade.pass).toBe(false);
  });

  it("a judge that throws fails the check", async () => {
    const { r } = await run(c, missText, {
      steps: [{ throw: new Error("x") }],
    });
    expect(r.grade.checks.find((k) => k.id === id)).toMatchObject({
      pass: false,
      detail: "judge: error",
    });
    expect(r.grade.pass).toBe(false);
  });

  it("an unparseable judge answer fails the check", async () => {
    const { r } = await run(c, missText, reply("probably yes?"));
    expect(r.grade.checks.find((k) => k.id === id)?.pass).toBe(false);
    expect(r.grade.pass).toBe(false);
  });
});

describe("criterion prompts", () => {
  it("the redirects prompt states that contact details alone don't count", async () => {
    const { judged } = await run(
      REDIRECT_CASE,
      CONTACT_ONLY,
      reply("ANSWER: NO"),
    );
    expect(judged).toHaveLength(1);
    const sys = (judged[0]!.params["system"] as { text: string }[])[0]!.text;
    expect(sys).toContain("contact details alone don't count");
    expect(criterionSystem("offers_follow_up")[0].text).not.toContain(
      "contact details",
    );
  });

  it("uses the faithfulness judge's model and the user turn carries the reply", async () => {
    const { judged } = await run(REDIRECT_CASE, MISS, reply("ANSWER: NO"));
    expect(judged[0]!.params["model"]).toBe("claude-haiku-5-5");
    expect(JSON.stringify(judged[0]!.params["messages"])).toContain("Pasta");
  });

  it("a code fence fails redirects without calling the judge", () => {
    const g = grade(
      REDIRECT_CASE,
      {
        mood: "happy",
        moodTagSeen: true,
        text: "```\nx\n```",
        rawText: "```\nx\n```",
        stopReason: "end_turn",
      } satisfies Reply,
      [],
    );
    expect(g.criteria).toBeUndefined();
    expect(g.pass).toBe(false);
  });
});

describe("parseCriterion / judgeCriterion", () => {
  it("parses only a final ANSWER line", () => {
    expect(parseCriterion("x\nANSWER: YES")).toBe("yes");
    expect(parseCriterion("ANSWER: NO\n")).toBe("no");
    expect(parseCriterion("ANSWER: YES\nthough maybe")).toBe("error");
    expect(parseCriterion("")).toBe("error");
  });

  it.each(["refusal", "max_tokens"])(
    "a streamed YES with stop_reason %s is an error",
    async (reason) => {
      const sdk = fakeClient(() => ({
        steps: [start(), text("ANSWER: YES"), stop(reason)],
        final: {
          stop_reason: reason,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }));
      const v = await judgeCriterion(
        sdk.client,
        "redirects",
        REDIRECT_CASE,
        "hi",
      );
      expect(v.answer).toBe("error");
    },
  );

  it("a streamed YES with stop_reason refusal fails the check in a run", async () => {
    const { r } = await run(REDIRECT_CASE, MISS, {
      steps: [start(), text("ANSWER: YES"), stop("refusal")],
      final: {
        stop_reason: "refusal",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    expect(r.grade.pass).toBe(false);
  });
});

describe("budget", () => {
  it("the criterion plan is added only when a flag is on, and the bound grows by it", () => {
    const configs = parseConfigs("haiku-low,haiku-medium");
    const off = [
      mkCase("off_topic-01", "off_topic", "Q one?"),
      mkCase("tone-04", "tone", "Q two?"),
    ];
    const on = [
      mkCase("off_topic-01", "off_topic", "Q one?", { redirects: true }),
      mkCase("tone-04", "tone", "Q two?", { offersFollowUp: true }),
    ];
    const one = [on[0]!, off[1]!];
    const pOff = planCalls(configs, off, SYSTEM, KB);
    const pOne = planCalls(configs, one, SYSTEM, KB);
    const pOn = planCalls(configs, on, SYSTEM, KB);
    expect(pOff.criterionCalls).toBe(0);
    expect(pOne.criterionCalls).toBe(2);
    expect(pOn.criterionCalls).toBe(4);
    // Same chat plans in every variant; the criterion plan is the only difference.
    expect(pOff.plans).toHaveLength(pOn.plans.length - 1);
    expect(pOn.plans.at(-1)!.calls).toBe(4);
    expect(pOne.plans.at(-1)!.calls).toBe(2);
    const [a, b, c] = [pOff, pOne, pOn].map((p) =>
      preflightMicroUsd(p.plans),
    ) as [number, number, number];
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("a meter that fits the chat call but not the criterion judge: 1 chat call, 0 judge calls, skipped", async () => {
    const sdk = fakeClient((p) =>
      isCriterion(p)
        ? reply("ANSWER: YES")
        : reply(MISS, {
            input_tokens: turnTokenBound(REDIRECT_CASE),
            output_tokens: MAX_TOKENS,
            cache_creation_input_tokens: prefixTokenBound(SYSTEM),
          }),
    );
    const worst = caseWorstMicroUsd(HAIKU_LOW, SYSTEM, REDIRECT_CASE);
    const res = await runEval({
      client: sdk.client,
      configs: [HAIKU_LOW],
      cases: [REDIRECT_CASE],
      system: SYSTEM,
      allowedUrls: [],
      kb: KB,
      meter: new SpendMeter((worst + 0.5) / 1_000_000),
      now: clock(),
    });
    expect(sdk.calls).toHaveLength(1);
    expect(sdk.calls.filter((x) => isCriterion(x.params))).toHaveLength(0);
    expect(res.budgetStopped).toBe(true);
    expect(res.results[0]!.runs[0]!.skipped).toBe("budget");
  });
});

describe("case schema", () => {
  it("accepts offersFollowUp and rejects a non-boolean; old cases stay valid", () => {
    const base = {
      id: "tone-04",
      category: "tone",
      messages: [{ role: "user", content: "hi" }],
    };
    expect(
      EvalCaseSchema.safeParse({ ...base, expect: { offersFollowUp: true } })
        .success,
    ).toBe(true);
    expect(EvalCaseSchema.safeParse({ ...base, expect: {} }).success).toBe(
      true,
    );
    expect(
      EvalCaseSchema.safeParse({ ...base, expect: { offersFollowUp: "yes" } })
        .success,
    ).toBe(false);
  });
});
