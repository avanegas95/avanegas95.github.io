// Site-only grouping of KB roles into Experience cards (P5.5-20). Blob's prompt
// never sees this: kb.ts renders every role separately. Pure and erasable TS so
// the site, facts:check and the unit tests share one implementation.
import type { Role } from "./kb-schema.ts";

export type SiteRole = {
  company: string;
  title: string;
  start: string;
  /** null means present. */
  end: string | null;
  bullets: string[];
};

const siteBulletsOf = (r: Role): string[] => r.siteBullets ?? r.bullets;

/**
 * One card per role, except that consecutive roles with the same `siteGroup`
 * merge into one: earliest start to latest end, the group's `siteTitle`, and
 * each role's site bullets (newest role first). Cards keep KB order.
 */
export function groupRoles(roles: readonly Role[]): SiteRole[] {
  const out: SiteRole[] = [];
  let i = 0;
  while (i < roles.length) {
    const first = roles[i] as Role;
    const run: Role[] = [first];
    if (first.siteGroup !== undefined) {
      while (roles[i + run.length]?.siteGroup === first.siteGroup) {
        run.push(roles[i + run.length] as Role);
      }
    }
    i += run.length;
    if (run.length === 1) {
      out.push({
        company: first.company,
        title: first.title,
        start: first.start,
        end: first.end,
        bullets: siteBulletsOf(first),
      });
      continue;
    }
    const newestFirst = [...run].sort((a, b) =>
      a.start < b.start ? 1 : a.start > b.start ? -1 : 0,
    );
    const ends = run.map((r) => r.end);
    out.push({
      company: first.company,
      title: run.find((r) => r.siteTitle)?.siteTitle ?? first.title,
      start: run.reduce((m, r) => (r.start < m ? r.start : m), first.start),
      end: ends.includes(null)
        ? null
        : (ends as string[]).reduce((m, e) => (e > m ? e : m)),
      bullets: newestFirst.flatMap(siteBulletsOf),
    });
  }
  return out;
}
