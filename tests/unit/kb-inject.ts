// Test-only helpers that add site-only marker fields to the FIRST role of an
// experience.md string. They work whether or not the real file already has
// siteBullets, siteTitle or siteGroup, so tests never anchor on exact bytes of
// the live content.
const FIRST_BULLETS = /^ {4}bullets:\n/m;
const FIRST_SITE_BULLETS = /^ {4}siteBullets:\n/m;

/** Put `marker` at siteBullets[0] of the first role. */
export function withSiteBullet(raw: string, marker: string): string {
  const line = `      - ${JSON.stringify(marker)}\n`;
  if (FIRST_SITE_BULLETS.test(raw)) {
    return raw.replace(FIRST_SITE_BULLETS, (m) => m + line);
  }
  if (!FIRST_BULLETS.test(raw)) throw new Error("no role bullets anchor");
  return raw.replace(FIRST_BULLETS, (m) => `    siteBullets:\n${line}${m}`);
}

/** Add site-only scalar fields to the first role (it must not set them yet). */
export function withRoleFields(
  raw: string,
  fields: Record<string, string>,
): string {
  const lines = Object.entries(fields)
    .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}\n`)
    .join("");
  const anchor = /^ {4}(siteBullets|bullets):\n/m;
  if (!anchor.test(raw)) throw new Error("no role bullets anchor");
  return raw.replace(anchor, (m) => lines + m);
}
