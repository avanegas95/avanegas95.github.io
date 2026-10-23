// Client link allowlist for Blob's replies (SCOPE §6.6). Defence in depth behind the server's
// output scrubber: a reply can only link to the KB contact links (Anderson's GitHub, LinkedIn and
// email, per the PLAN decision log) or a fixed same-site path. No imports: prompt.ts must never reach the client bundle, so SITE_PATHS
// is a copy of ALLOWED_SITE_PATHS and a unit test keeps the two in lockstep.

export const SITE_PATHS: readonly string[] = [
  "#home",
  "#about",
  "#experiences",
  "#projects",
  "#contact",
  "/",
  "/blog/",
  "/orbithop/",
  "/privacy/",
  "/blob-privacy/",
];

export const LINK_HOSTS: readonly string[] = [
  "github.com",
  "linkedin.com",
  "www.linkedin.com",
];

// Printable ASCII only, minus `\` and the quote/angle/backtick characters. This rejects control
// characters, all whitespace (including Unicode spaces and zero-width marks) and IDN look-alikes.
const SAFE_CHARS = /^[!#$%&()*+,\-./0-9:;=?@A-Z[\]^_a-z{|}~]+$/;
// Traversal, encoded separators/userinfo and double encoding (%25), rejected before `new URL` can normalise them away.
const UNSAFE_RAW = /\.\.|%(?:2e|2f|5c|40|25)/i;
// The only contact address (PLAN decision log, 2026-10-13).
const MAIL = "avanegas95@gmail.com";
// Allowed path per host: the prefix, optionally continuing with "/", "?" or "#" (the last two
// are not part of `pathname`). Compared case-insensitively, like the server scrubber.
const HOST_PATH: Readonly<Record<string, string>> = {
  "github.com": "/avanegas95",
  "linkedin.com": "/in/avanegas95",
  "www.linkedin.com": "/in/avanegas95",
};

/** The normalised href for an allowed link target, or null for anything else. */
export function safeHref(
  raw: string,
): { href: string; external: boolean } | null {
  const s = raw.trim();
  if (!SAFE_CHARS.test(s) || UNSAFE_RAW.test(s)) return null;

  if (SITE_PATHS.includes(s)) return { href: s, external: false };

  const lower = s.toLowerCase();
  if (lower.startsWith("mailto:")) {
    return lower === `mailto:${MAIL}`
      ? { href: `mailto:${MAIL}`, external: true }
      : null;
  }

  if (!lower.startsWith("https://")) return null;
  // Raw authority check: `new URL` drops a default port (":443") and would hide it.
  const rest = s.slice("https://".length);
  let authorityEnd = rest.length;
  for (const stop of ["/", "?", "#"]) {
    const i = rest.indexOf(stop);
    if (i !== -1 && i < authorityEnd) authorityEnd = i;
  }
  const authority = rest.slice(0, authorityEnd);
  if (authority.includes("@") || authority.includes(":")) return null;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !LINK_HOSTS.includes(url.hostname)
  ) {
    return null;
  }
  const prefix = HOST_PATH[url.hostname];
  const path = url.pathname.toLowerCase();
  if (
    prefix === undefined ||
    (path !== prefix && !path.startsWith(`${prefix}/`))
  ) {
    return null;
  }
  return { href: url.href, external: true };
}
