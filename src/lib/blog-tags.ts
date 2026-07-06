import { suggestedBlogTags } from "@/data/blog-tags";
import type { CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export interface TagWithCount {
  tag: string;
  count: number;
}

export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function tagUrl(tag: string): string {
  return `/blog/tags/${normalizeTag(tag)}`;
}

export function formatTagLabel(tag: string): string {
  const normalized = normalizeTag(tag);
  const known = suggestedBlogTags.find((t) => t.slug === normalized);
  if (known) return known.label;

  return normalized
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function sortPostsByDate(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );
}

export function getPostsByTag(posts: BlogPost[], tag: string): BlogPost[] {
  const normalized = normalizeTag(tag);
  return sortPostsByDate(
    posts.filter((post) =>
      post.data.tags.some((t) => normalizeTag(t) === normalized),
    ),
  );
}

export function getAllTags(posts: BlogPost[]): TagWithCount[] {
  const counts = new Map<string, number>();

  for (const post of posts) {
    for (const tag of post.data.tags) {
      const normalized = normalizeTag(tag);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function getPublishedPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter((post) => !post.data.draft);
}

export function sortPostsFeaturedFirst(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) => {
    if (a.data.featured !== b.data.featured) {
      return a.data.featured ? -1 : 1;
    }
    return b.data.pubDate.getTime() - a.data.pubDate.getTime();
  });
}
