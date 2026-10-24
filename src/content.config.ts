import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.{md,mdx}",
    base: "./src/content/blog",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string().min(1)).min(1).max(4),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    cover: z
      .object({
        src: z.string(),
        alt: z.string(),
      })
      .optional(),
  }),
});

const base = {
  title: z.string().min(1),
  summary: z.string().min(1).max(200),
  updated: z.date(),
  public: z.boolean(),
};

const knowledge = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/knowledge" }),
  schema: z
    .object({
      topic: z.enum([
        "bio",
        "experience",
        "skills",
        "education",
        "interests",
        "contact",
        "faq",
        "site",
      ]),
      ...base,
    })
    .strict(),
});

const projects = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/knowledge/projects" }),
  schema: z
    .object({
      topic: z.literal("project"),
      ...base,
      order: z.number().int().min(1),
    })
    .strict(),
});

export const collections = { blog, knowledge, projects };
