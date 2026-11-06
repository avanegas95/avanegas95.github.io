// Inline screenshot markers for project pages. A paragraph of its own in a
// project's KB body places gallery images between the prose:
//
//   ::shot[dashboard.png]                 full width (default)
//   ::shot[wins.png]{left}                floated left, text wraps on the right
//   ::shot[wins.png]{right}               floated right
//   ::shot[revenue.png costs.png]{pair}   two side by side
//
// Files must be listed in the project's `gallery:`, which holds the alt text.
// Markers are layout, not prose: kb.ts strips them from Blob's prompt.

export const SHOT_LAYOUTS = ["full", "left", "right", "pair"] as const;
export type ShotLayout = (typeof SHOT_LAYOUTS)[number];
export interface Shot {
  files: string[];
  layout: ShotLayout;
}
export type ShotSegment =
  { kind: "html"; html: string } | ({ kind: "shot" } & Shot);

const PREFIX = /^\s*::shot\b/;
const MARKER = /^\s*::shot\[([^\]]*)\](?:\{([a-z]*)\})?\s*$/;
const FENCE = /^\s*(```|~~~)/;

function parse(line: string): { files: string[]; layout: string } | null {
  const m = MARKER.exec(line);
  if (!m) return null;
  const files = (m[1] ?? "").trim().split(/\s+/).filter(Boolean);
  return { files, layout: m[2] || "full" };
}

/** The marker on `line`, or null when the line is not a well-formed marker. */
export function parseShotMarker(line: string): Shot | null {
  const p = parse(line);
  if (!p || !(SHOT_LAYOUTS as readonly string[]).includes(p.layout)) {
    return null;
  }
  return { files: p.files, layout: p.layout as ShotLayout };
}

/** Line numbers (0-based) of lines outside code fences. */
function proseLines(lines: readonly string[]): number[] {
  const out: number[] = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (FENCE.test(l)) fenced = !fenced;
    else if (!fenced) out.push(i);
  });
  return out;
}

/** Problems with the body's markers, each as "line N: why"; empty when fine. */
export function checkShotMarkers(
  body: string,
  gallery: readonly string[],
): string[] {
  const lines = body.split("\n");
  const errors: string[] = [];
  for (const i of proseLines(lines)) {
    const line = lines[i] ?? "";
    if (!PREFIX.test(line)) continue;
    const err = (why: string) => errors.push(`line ${i + 1}: ${why}`);
    const p = parse(line);
    if (!p || p.files.length === 0) {
      err(
        `malformed screenshot marker "${line.trim()}" (use ::shot[file.png])`,
      );
      continue;
    }
    if (!(SHOT_LAYOUTS as readonly string[]).includes(p.layout)) {
      err(`unknown layout {${p.layout}} (use ${SHOT_LAYOUTS.join(", ")})`);
      continue;
    }
    const want = p.layout === "pair" ? 2 : 1;
    if (p.files.length !== want) {
      err(`{${p.layout}} takes exactly ${want} file${want > 1 ? "s" : ""}`);
    }
    for (const f of p.files) {
      if (!gallery.includes(f)) err(`not in gallery: ${f}`);
    }
    const blank = (j: number) =>
      j < 0 || j >= lines.length || !lines[j]?.trim();
    if (!blank(i - 1) || !blank(i + 1)) {
      err("a screenshot marker needs a blank line before and after it");
    }
  }
  return errors;
}

/** The body without marker paragraphs, so Blob's prompt only gets prose. */
export function stripShotMarkers(body: string): string {
  const lines = body.split("\n");
  const drop = new Set(
    proseLines(lines).filter((i) => PREFIX.test(lines[i] ?? "")),
  );
  return lines
    .filter((_, i) => !drop.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A marker renders as its own <p>. Code blocks escape nothing here and are
// never matched, because the marker would sit inside <pre><code>, not <p>.
const RENDERED = /<p>(::shot\[[^\]<]*\](?:\{[a-z]*\})?)<\/p>/g;

/** Splits a project's rendered HTML into prose and screenshot segments. */
export function splitHtmlAtShots(html: string): ShotSegment[] {
  const out: ShotSegment[] = [];
  let last = 0;
  for (const m of html.matchAll(RENDERED)) {
    const shot = parseShotMarker(m[1] ?? "");
    if (!shot) continue;
    if (m.index > last) {
      out.push({ kind: "html", html: html.slice(last, m.index) });
    }
    out.push({ kind: "shot", ...shot });
    last = m.index + m[0].length;
  }
  if (last < html.length || out.length === 0) {
    out.push({ kind: "html", html: html.slice(last) });
  }
  return out;
}
