import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GALLERY_ROOT,
  KB_ROOT,
  MEDIA_ROOT,
  loadKbSources,
  parseKbSource,
} from "../../src/lib/kb.ts";
import { ProjectSchema } from "../../src/lib/kb-schema.ts";
import {
  isInDevelopment,
  projectLinks,
  stripTracking,
} from "../../src/lib/project-links.ts";
import type { Project } from "../../src/lib/kb-schema.ts";

const projects = loadKbSources(KB_ROOT)
  .filter((s) => s.path.startsWith("projects/"))
  .map((s) => ({
    slug: s.path.replace(/^projects\//, "").replace(/\.md$/, ""),
    data: parseKbSource(s).data as Project,
  }));
const publicProjects = projects.filter((p) => p.data.public);

const TRACKING = /wfuid|wfsid|utm_|fbclid|gclid/i;
const urlsOf = (p: Project) =>
  [p.links.repo, p.links.live, p.links.appStore].filter((u): u is string =>
    Boolean(u),
  );

describe("project KB files", () => {
  it("has public projects", () => {
    expect(publicProjects.length).toBeGreaterThan(0);
  });

  it("every public project has a status, a role, tech and a unique order", () => {
    for (const { slug, data } of publicProjects) {
      expect(data.status.trim(), slug).not.toBe("");
      expect(data.role?.trim(), slug).toBeTruthy();
      expect(data.tech.length, slug).toBeGreaterThanOrEqual(1);
      for (const t of data.tech) expect(t.trim(), slug).not.toBe("");
    }
    const orders = publicProjects.map((p) => p.data.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("slugs and titles are unique", () => {
    const titles = projects.map((p) => p.data.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(projects.map((p) => p.slug)).size).toBe(projects.length);
  });

  it("no URL has tracking params, and all are https", () => {
    for (const { slug, data } of projects) {
      for (const u of urlsOf(data)) {
        expect(u, slug).not.toMatch(TRACKING);
        expect(u.startsWith("https://"), slug).toBe(true);
      }
    }
  });

  it("an in-development project has no live link", () => {
    for (const { slug, data } of projects) {
      if (isInDevelopment(data.status)) {
        expect(data.links.live, slug).toBeUndefined();
        expect(data.links.appStore, slug).toBeUndefined();
      }
    }
  });

  it("no card uses the placeholder image", () => {
    for (const { slug, data } of projects) {
      expect(data.cover ?? "", slug).not.toMatch(/placeholder/i);
    }
  });

  it("a cover file exists in the project's folder", () => {
    for (const { slug, data } of projects) {
      if (data.cover) {
        expect(existsSync(`${GALLERY_ROOT}/${slug}/${data.cover}`), slug).toBe(
          true,
        );
      }
    }
  });

  it("every gallery entry has an existing image file and non-empty alt", () => {
    for (const { slug, data } of projects) {
      for (const g of data.gallery) {
        expect(g.alt.trim(), `${slug}/${g.file}`).not.toBe("");
        expect(existsSync(`${GALLERY_ROOT}/${slug}/${g.file}`), g.file).toBe(
          true,
        );
      }
    }
  });

  it("every video's file, captions and poster exist", () => {
    for (const { slug, data } of projects) {
      const v = data.video;
      if (!v) continue;
      expect(existsSync(`${MEDIA_ROOT}/${slug}/${v.file}`), v.file).toBe(true);
      expect(
        existsSync(`${MEDIA_ROOT}/${slug}/${v.captions}`),
        v.captions,
      ).toBe(true);
      expect(existsSync(`${GALLERY_ROOT}/${slug}/${v.poster}`), v.poster).toBe(
        true,
      );
    }
  });

  it("src/data/projects.ts is gone", () => {
    expect(existsSync("src/data/projects.ts")).toBe(false);
  });
});

describe("gallery schema", () => {
  const base = {
    topic: "project",
    title: "T",
    summary: "S",
    updated: new Date("2026-10-24"),
    public: true,
    order: 1,
    status: "Live",
    role: "r",
    tech: ["x"],
  };
  const parse = (gallery: unknown) =>
    ProjectSchema.safeParse({ ...base, gallery });

  it("accepts an image with alt text", () => {
    expect(parse([{ file: "a.png", alt: "Alt" }]).success).toBe(true);
  });
  it("rejects an empty or blank alt", () => {
    expect(parse([{ file: "a.png", alt: "" }]).success).toBe(false);
    expect(parse([{ file: "a.png", alt: "  " }]).success).toBe(false);
  });
  it("rejects a non-image extension", () => {
    expect(parse([{ file: "a.pdf", alt: "Alt" }]).success).toBe(false);
    expect(parse([{ file: "a.svg", alt: "Alt" }]).success).toBe(false);
  });
  it("rejects a path instead of a file name", () => {
    expect(parse([{ file: "../a.png", alt: "Alt" }]).success).toBe(false);
  });
  it("defaults to no gallery, and a missing file fails to load", () => {
    expect(ProjectSchema.parse(base).gallery).toEqual([]);
    expect(() =>
      parseKbSource({
        path: "projects/paychira.md",
        raw: [
          "---",
          "topic: project",
          "title: T",
          "summary: S",
          "updated: 2026-10-24",
          "public: true",
          "order: 1",
          "status: Live",
          "role: r",
          "tech: [x]",
          "gallery:",
          "  - file: nope.png",
          "    alt: Nope",
          "---",
          "Body",
        ].join("\n"),
      }),
    ).toThrow(/gallery file not found/);
  });
  it("requires a role only for public projects", () => {
    const noRole: Record<string, unknown> = { ...base };
    delete noRole["role"];
    expect(ProjectSchema.safeParse(noRole).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...noRole, public: false }).success).toBe(
      true,
    );
  });
});

describe("video and App Store schema", () => {
  const base = {
    topic: "project",
    title: "T",
    summary: "S",
    updated: new Date("2026-10-24"),
    public: true,
    order: 1,
    status: "Live",
    role: "r",
    tech: ["x"],
  };
  const video = {
    file: "v.mp4",
    captions: "v.vtt",
    poster: "p.jpg",
    description: "D",
  };
  const parse = (extra: Record<string, unknown>) =>
    ProjectSchema.safeParse({ ...base, ...extra });

  it("accepts a video with captions, poster and description", () => {
    expect(parse({ video }).success).toBe(true);
  });
  it("rejects a video without captions or with a blank description", () => {
    const noCaptions: Record<string, unknown> = { ...video };
    delete noCaptions["captions"];
    expect(parse({ video: noCaptions }).success).toBe(false);
    expect(parse({ video: { ...video, description: " " } }).success).toBe(
      false,
    );
  });
  it("rejects wrong extensions and paths", () => {
    expect(parse({ video: { ...video, file: "v.mov" } }).success).toBe(false);
    expect(parse({ video: { ...video, captions: "v.srt" } }).success).toBe(
      false,
    );
    expect(parse({ video: { ...video, file: "../v.mp4" } }).success).toBe(
      false,
    );
  });
  it("accepts only apps.apple.com App Store links", () => {
    const ok = "https://apps.apple.com/us/app/x/id1";
    expect(parse({ links: { appStore: ok } }).success).toBe(true);
    expect(
      parse({ links: { appStore: "https://example.com/app" } }).success,
    ).toBe(false);
  });
  it("a missing video file fails to load", () => {
    expect(() =>
      parseKbSource({
        path: "projects/paychira.md",
        raw: [
          "---",
          "topic: project",
          "title: T",
          "summary: S",
          "updated: 2026-10-24",
          "public: true",
          "order: 1",
          "status: Live",
          "role: r",
          "tech: [x]",
          "video:",
          "  file: nope.mp4",
          "  captions: nope.vtt",
          "  poster: nope.jpg",
          "  description: D",
          "---",
          "Body",
        ].join("\n"),
      }),
    ).toThrow(/video file not found/);
  });
});

describe("project links", () => {
  it("strips tracking params and keeps the rest", () => {
    expect(stripTracking("https://a.com/x?utm_source=z&k=1&wfuid=3")).toBe(
      "https://a.com/x?k=1",
    );
    expect(stripTracking("https://a.com")).toBe("https://a.com");
    expect(stripTracking("https://a.com/b/")).toBe("https://a.com/b/");
  });
  it("hides the live link while in development", () => {
    const links = { repo: "https://g.com/r", live: "https://l.com" };
    expect(
      projectLinks({ links, status: "In development", repoPublic: true }),
    ).toEqual({ repo: "https://g.com/r" });
    expect(
      projectLinks({ links, status: "Live", repoPublic: false }).live,
    ).toBe("https://l.com");
  });
  it("emits the App Store link unless in development", () => {
    const links = {
      appStore: "https://apps.apple.com/us/app/x/id1?utm_source=z",
    };
    expect(projectLinks({ links, status: "Live", repoPublic: false })).toEqual({
      appStore: "https://apps.apple.com/us/app/x/id1",
    });
    expect(
      projectLinks({ links, status: "In development", repoPublic: false }),
    ).toEqual({});
  });
  it("emits the repo link only when repoPublic is true", () => {
    const links = { repo: "https://github.com/x/y" };
    expect(
      projectLinks({ links, status: "Live", repoPublic: false }).repo,
    ).toBeUndefined();
    expect(projectLinks({ links, status: "Live", repoPublic: true }).repo).toBe(
      links.repo,
    );
  });
  it("no KB project is marked repoPublic yet", () => {
    for (const { slug, data } of projects) {
      expect(data.repoPublic, slug).toBe(false);
    }
  });
});
