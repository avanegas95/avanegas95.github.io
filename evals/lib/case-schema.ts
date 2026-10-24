// Contract for evals/cases.yaml (SCOPE §7, Agent evals). Strict: unknown keys fail.
import { z } from "astro/zod";
import { parse } from "yaml";
import { MODEL_MOODS } from "../../src/lib/moods.ts";

export const CATEGORIES = [
  "factual",
  "unknowns",
  "privacy",
  "injection",
  "off_topic",
  "tone",
  "links",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories that must pass at 100% for the gate. */
export const GATE_100: readonly Category[] = [
  "privacy",
  "injection",
  "unknowns",
];

const JUDGE_CATEGORIES: readonly Category[] = ["factual", "unknowns"];

const MessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(500),
});

const RegexSource = z.string().refine(
  (src) => {
    try {
      new RegExp(src);
      return true;
    } catch {
      return false;
    }
  },
  { message: "regex does not compile" },
);

const ExpectSchema = z.strictObject({
  mustInclude: z.array(z.string().min(1)).default([]),
  mustIncludeAny: z.array(z.string().min(1)).default([]),
  mustNotInclude: z.array(z.string().min(1)).default([]),
  mustNotMatch: z.array(RegexSource).default([]),
  saysUnknown: z.boolean().default(false),
  redirects: z.boolean().default(false),
  maxWords: z.number().int().min(1).max(300).default(120),
  moods: z.array(z.enum(MODEL_MOODS)).min(1).optional(),
  judge: z.literal("faithfulness").optional(),
});

export const EvalCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z_]+-\d{2}$/),
    category: z.enum(CATEGORIES),
    messages: z
      .array(MessageSchema)
      .min(1)
      .max(10)
      .superRefine((msgs, ctx) => {
        msgs.forEach((m, i) => {
          const want = i % 2 === 0 ? "user" : "assistant";
          if (m.role !== want) {
            ctx.addIssue({
              code: "custom",
              path: [i, "role"],
              message: `turns must alternate starting with user (expected ${want})`,
            });
          }
        });
        if (msgs.at(-1)?.role !== "user") {
          ctx.addIssue({ code: "custom", message: "last turn must be user" });
        }
      }),
    expect: ExpectSchema,
    notes: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.expect.judge && !JUDGE_CATEGORIES.includes(c.category)) {
      ctx.addIssue({
        code: "custom",
        path: ["expect", "judge"],
        message: "judge is only allowed on factual or unknowns",
      });
    }
  });
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalFileSchema = z
  .strictObject({
    version: z.literal(1),
    cases: z.array(EvalCaseSchema).min(40).max(70),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.cases.forEach((c, i) => {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "id"],
          message: `duplicate id ${c.id}`,
        });
      }
      seen.add(c.id);
    });
  });

function caseLabel(raw: unknown, index: number): string {
  if (Array.isArray(raw)) {
    const id = (raw[index] as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") return id;
  }
  return `#${index}`;
}

/** Parses and validates cases.yaml. Throws with the failing case id and path. */
export function parseCasesYaml(text: string): EvalCase[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new Error(`cases.yaml: invalid YAML: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const r = EvalFileSchema.safeParse(doc);
  if (r.success) return r.data.cases;

  const rawCases = (doc as { cases?: unknown } | null)?.cases;
  const lines = r.error.issues.map((issue) => {
    const [head, idx, ...rest] = issue.path;
    if (head === "cases" && typeof idx === "number") {
      const where = rest.length ? ` at ${rest.join(".")}` : "";
      return `case ${caseLabel(rawCases, idx)}${where}: ${issue.message}`;
    }
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
  throw new Error(`cases.yaml invalid:\n${lines.join("\n")}`);
}
