import { beforeEach, describe, expect, it, vi } from "vitest";

const getCollection = vi.fn();
vi.mock("astro:content", () => ({ getCollection }));

const { getPublishedPosts, isPublished } =
  await import("../../src/lib/blog-posts");

const post = (id: string, pubDate: string, draft: boolean) => ({
  id,
  data: { draft, pubDate: new Date(pubDate) },
});

describe("isPublished", () => {
  it("is false for drafts and true otherwise", () => {
    expect(isPublished({ data: { draft: true } })).toBe(false);
    expect(isPublished({ data: { draft: false } })).toBe(true);
  });
});

describe("getPublishedPosts", () => {
  beforeEach(() => getCollection.mockReset());

  it("excludes drafts and sorts newest first", async () => {
    getCollection.mockResolvedValue([
      post("old", "2026-01-01", false),
      post("draft", "2026-09-01", true),
      post("new", "2026-05-01", false),
    ]);
    const ids = (await getPublishedPosts()).map((p) => p.id);
    expect(ids).toEqual(["new", "old"]);
  });

  it("returns an empty list when everything is a draft", async () => {
    getCollection.mockResolvedValue([post("a", "2026-01-01", true)]);
    expect(await getPublishedPosts()).toEqual([]);
  });
});
