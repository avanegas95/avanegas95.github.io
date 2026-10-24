// Build-time readers for site sections. The KB is the single source (CLAUDE.md
// rule 1): sections render these values instead of hard-coding facts.
import { getCollection, getEntry } from "astro:content";
import type { CollectionEntry } from "astro:content";
import type { ContactLinks, Knowledge, Role, SkillGroup } from "./kb-schema.ts";

type Topic = Knowledge["topic"];

async function publicData<T extends Topic>(
  topic: T,
): Promise<{ data: Extract<Knowledge, { topic: T }>; body: string } | null> {
  const entry = await getEntry("knowledge", topic);
  if (!entry || !entry.data.public) return null;
  const data = entry.data;
  if (data.topic !== topic) {
    throw new Error(`site-content: ${topic}.md has topic ${data.topic}`);
  }
  return {
    data: data as Extract<Knowledge, { topic: T }>,
    body: entry.body ?? "",
  };
}

export async function getBio(): Promise<{
  title: string;
  summary: string;
  headline?: string;
  lede?: string;
  body: string;
} | null> {
  const e = await publicData("bio");
  if (!e) return null;
  const { title, summary, headline, lede } = e.data;
  return { title, summary, headline, lede, body: e.body };
}

/** Roles shown on the site, in KB order. */
export async function getRoles(): Promise<Role[]> {
  const e = await publicData("experience");
  return (e?.data.roles ?? []).filter((r) => r.showOnSite);
}

export async function getSkillGroups(): Promise<SkillGroup[]> {
  const e = await publicData("skills");
  return e?.data.groups ?? [];
}

export async function getContact(): Promise<{
  links: ContactLinks;
  location?: string;
} | null> {
  const e = await publicData("contact");
  if (!e?.data.links) return null;
  return { links: e.data.links, location: e.data.location };
}

/** Public projects, by `order` then id. */
export async function getPublicProjects(): Promise<
  CollectionEntry<"projects">[]
> {
  const all = await getCollection("projects");
  return all
    .filter((p) => p.data.public)
    .sort(
      (a, b) =>
        a.data.order - b.data.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
