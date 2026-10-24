import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

export function isPublished(entry: { data: { draft: boolean } }): boolean {
  return !entry.data.draft;
}

/** Published blog posts, newest first. Every blog page reads posts through this. */
export async function getPublishedPosts(): Promise<CollectionEntry<"blog">[]> {
  const posts = await getCollection("blog");
  return posts
    .filter(isPublished)
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}
