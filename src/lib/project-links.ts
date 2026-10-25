// Pure helpers for project cards and pages (no astro:* imports, so unit-testable).
import type { Project } from "./kb-schema.ts";

export const TRACKING_PARAM = /^(?:wfuid|wfsid|utm_.*|fbclid|gclid)$/i;

/** Drops tracking query params; everything else about the URL stays as written. */
export function stripTracking(url: string): string {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  const clean = u.href;
  // new URL() adds a trailing slash to bare origins; keep the author's spelling.
  return url.endsWith("/") || u.pathname !== "/" || u.search || u.hash
    ? clean
    : clean.replace(/\/$/, "");
}

/** A project still in development has no live link, whatever the frontmatter says. */
export function isInDevelopment(status: string): boolean {
  return /in[\s-]development/i.test(status);
}

export function projectLinks(data: Pick<Project, "links" | "status">): {
  repo?: string;
  live?: string;
} {
  const out: { repo?: string; live?: string } = {};
  if (data.links.repo) out.repo = stripTracking(data.links.repo);
  if (data.links.live && !isInDevelopment(data.status)) {
    out.live = stripTracking(data.links.live);
  }
  return out;
}
