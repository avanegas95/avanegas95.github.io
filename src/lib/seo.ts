// Build-time SEO helpers for Layout.astro. Pure functions; facts come from the knowledge base.

export interface PersonInput {
  name: string;
  jobTitle: string;
  worksFor: string;
  url: string;
  email: string;
  sameAs: string[];
}

export function personJsonLd(input: PersonInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    jobTitle: input.jobTitle,
    worksFor: { "@type": "Organization", name: input.worksFor },
    url: input.url,
    email: input.email,
    sameAs: input.sameAs,
  };
}

/** JSON safe to inline in a <script>: `<`, `>` and `&` become unicode escapes. */
export function serializeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/** Pulls "<title> at <employer>" from the start of the KB bio summary. */
export function currentRoleFromSummary(
  summary: string,
): { title: string; employer: string } | null {
  const m = /^(.+?) at (.+?) who\b/.exec(summary);
  return m?.[1] && m[2] ? { title: m[1], employer: m[2] } : null;
}

/** Finds the URL of a "- Label: [text](url)" list item in KB markdown. */
export function kbLink(markdown: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^- ${escaped}: \\[[^\\]]*\\]\\(([^)]+)\\)`, "m").exec(
    markdown,
  );
  return m?.[1] ?? null;
}
