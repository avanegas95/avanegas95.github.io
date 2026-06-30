import type { CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export interface TagWithCount {
  tag: string;
  count: number;
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

export function tagUrl(tag: string): string {
  return `/blog/tags/${normalizeTag(tag)}`;
}

export function formatTagLabel(tag: string): string {
  return normalizeTag(tag)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getPostsByTag(posts: BlogPost[], tag: string): BlogPost[] {
  const normalized = normalizeTag(tag);
  return posts
    .filter((post) =>
      post.data.tags.some((t) => normalizeTag(t) === normalized),
    )
    .sort(
      (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
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

export function sortPostsByDate(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );
}

export function sortPostsFeaturedFirst(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) => {
    if (a.data.featured !== b.data.featured) {
      return a.data.featured ? -1 : 1;
    }
    return b.data.pubDate.getTime() - a.data.pubDate.getTime();
  });
}
