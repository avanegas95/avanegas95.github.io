import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { KnowledgeSchema, ProjectSchema } from "./lib/kb-schema.ts";

const blog = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.{md,mdx}",
    base: "./src/content/blog",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      tags: z.array(z.string().min(1)).min(1).max(4),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
      cover: z
        .object({
          src: image(),
          alt: z.string(),
        })
        .optional(),
    }),
});

const knowledge = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/knowledge" }),
  schema: KnowledgeSchema,
});

const projects = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/knowledge/projects" }),
  schema: ProjectSchema,
});

export const collections = { blog, knowledge, projects };
