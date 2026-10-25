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
    // Site-only grouping: consecutive roles sharing a siteGroup render as one card,
    // titled by the siteTitle of whichever of them sets it. Blob's prompt ignores both.
    siteGroup: text.optional(),
    siteTitle: text.optional(),
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

// Image extensions astro:assets can process. Existence of the file is checked
// by kb.ts (it knows the slug) and by the project page's build.
const GALLERY_EXT = /\.(?:avif|gif|jpe?g|png|webp)$/i;
export const GalleryItemSchema = z
  .object({
    file: text
      .regex(/^[A-Za-z0-9._-]+$/, "expected a bare file name")
      .regex(GALLERY_EXT, "not an image file"),
    alt: text.refine((a) => a.trim() !== "", "alt must not be empty"),
  })
  .strict();
export type GalleryItem = z.infer<typeof GalleryItemSchema>;

const bareFile = (ext: RegExp, what: string) =>
  text
    .regex(/^[A-Za-z0-9._-]+$/, "expected a bare file name")
    .regex(ext, `not ${what}`);

// A short clip for the project page. `file` and `captions` live in
// public/media/<slug>/ (astro:assets doesn't process video); `poster` is an
// image in the gallery folder. kb.ts checks that all three exist.
export const ProjectVideoSchema = z
  .object({
    file: bareFile(/\.mp4$/i, "an .mp4 file"),
    captions: bareFile(/\.vtt$/i, "a .vtt file"),
    poster: bareFile(GALLERY_EXT, "an image file"),
    // Text alternative shown under the video.
    description: text.refine((a) => a.trim() !== "", "must not be empty"),
  })
  .strict();
export type ProjectVideo = z.infer<typeof ProjectVideoSchema>;

const appStore = https.refine(
  (u) => new URL(u).hostname === "apps.apple.com",
  "expected an apps.apple.com link",
);

export const ProjectCardSchema = z.object({
  status: text,
  // Required for public projects (see ProjectSchema); Anderson's own words.
  role: text.optional(),
  tech: z.array(text).min(1),
  techLabel: text.default("Stack"),
  techNote: text.optional(),
  links: z
    .object({
      repo: https.optional(),
      live: https.optional(),
      appStore: appStore.optional(),
    })
    .strict()
    .default({}),
  // Shorter tag list for the site card; the page and Blob use the full `tech`.
  cardTech: z.array(text).min(1).optional(),
  // Show the repo link only when Anderson has marked the repository public.
  repoPublic: z.boolean().default(false),
  cover: text.optional(),
  featured: z.boolean().default(false),
  // Screenshots for the project page, relative to src/assets/images/projects/<slug>/.
  gallery: z.array(GalleryItemSchema).default([]),
  video: ProjectVideoSchema.optional(),
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

// Project summaries are the card text, so they may run longer than other topics'.
export const PROJECT_SUMMARY_MAX = 240;

export const ProjectSchema = z
  .object({
    topic: z.literal("project"),
    ...base,
    summary: text.max(PROJECT_SUMMARY_MAX),
    order: z.number().int().min(1),
    ...ProjectCardSchema.shape,
  })
  .strict()
  .refine((p) => !p.public || p.role !== undefined, {
    path: ["role"],
    message: "role is required for a public project",
  });
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
  "experience.roles[].siteTitle",
  "experience.roles[].note",
  "projects.role",
  "projects.techNote",
  "*.summary",
];
