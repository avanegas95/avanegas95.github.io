// Preview-only pages (e.g. /dev/blob) are built locally and on Vercel previews, never on production.
export function devPreviewEnabled(vercelEnv: string | undefined): boolean {
  return vercelEnv !== "production";
}
