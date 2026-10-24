// Shared by the content collections (content.config.ts) and kb.ts, so the site
// and Blob's prompt validate the KB with one schema. Must run under plain
// `node` (type stripping): erasable TS only.
import { z } from "astro/zod";

const text = z.string().min(1);

// "YYYY-MM". kb.ts also requires these to be quoted in YAML.
export const YEAR_MONTH_KEYS = ["start", "end"] as const;
const yearMonth = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'expected "YYYY-MM"');

export const RoleSchema = z
  .object({
    company: text,
    title: text,
    employment: text.optional(),
    start: yearMonth,
    end: yearMonth.nullable(),
    showOnSite: z.boolean(),
    bullets: z.array(text),
    // Optional shorter bullets for the site card. Blob's prompt always uses the full `bullets`.
    siteBullets: z.array(text).optional(),
    note: text.optional(),
  })
  .strict();
export type Role = z.infer<typeof RoleSchema>;

export const SkillGroupSchema = z
  .object({ name: text, items: z.array(text).min(1) })
  .strict();
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

const https = z.url({ protocol: /^https$/ });

export const ContactLinksSchema = z
  .object({ email: z.email(), linkedin: https, github: https })
  .strict();
export type ContactLinks = z.infer<typeof ContactLinksSchema>;

export const ProjectCardSchema = z.object({
  status: text,
  role: text,
  tech: z.array(text).min(1),
  techLabel: text.default("Stack"),
  techNote: text.optional(),
  links: z
    .object({ repo: https.optional(), live: https.optional() })
    .strict()
    .default({}),
  cover: text.optional(),
  featured: z.boolean().default(false),
});
export type ProjectCard = z.infer<typeof ProjectCardSchema>;

const base = {
  title: text,
  summary: text.max(200),
  updated: z.date(),
  public: z.boolean(),
};

const plain = <T extends string>(topic: T) =>
  z.object({ topic: z.literal(topic), ...base }).strict();

export const KnowledgeSchema = z.discriminatedUnion("topic", [
  z
    .object({
      topic: z.literal("bio"),
      ...base,
      greeting: text,
      name: text,
      headline: text,
      lede: text,
      // About Me paragraphs, in order; the last one introduces the tool list.
      about: z.array(text).min(1),
      // Tool rows for About: each entry is a skills.md item name, joined with " / ".
      tools: z.array(z.array(text).min(1)).min(1),
    })
    .strict(),
  z
    .object({
      topic: z.literal("experience"),
      ...base,
      roles: z.array(RoleSchema).min(1).optional(),
    })
    .strict(),
  z
    .object({
      topic: z.literal("skills"),
      ...base,
      groups: z.array(SkillGroupSchema).min(1).optional(),
    })
    .strict(),
  z
    .object({
      topic: z.literal("contact"),
      ...base,
      links: ContactLinksSchema.optional(),
      location: text.optional(),
    })
    .strict(),
  plain("education"),
  plain("interests"),
  plain("faq"),
  plain("site"),
]);
export type Knowledge = z.infer<typeof KnowledgeSchema>;

export const ProjectSchema = z
  .object({
    topic: z.literal("project"),
    ...base,
    order: z.number().int().min(1),
    ...ProjectCardSchema.shape,
  })
  .strict();
export type Project = z.infer<typeof ProjectSchema>;

// Anderson-owned prose (voice lock, P5.5-13c). `[]` means every array item.
export const VOICE_FIELDS: readonly string[] = [
  "bio.headline",
  "bio.lede",
  "bio.greeting",
  "bio.name",
  "bio.about[]",
  "bio.tools[][]",
  "experience.roles[].bullets[]",
  "experience.roles[].siteBullets[]",
  "experience.roles[].note",
  "projects.role",
  "projects.techNote",
  "*.summary",
];
