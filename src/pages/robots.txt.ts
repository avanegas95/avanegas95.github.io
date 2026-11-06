import type { APIRoute } from "astro";

// Static route: emitted as /robots.txt at build time. The Sitemap line follows `site`.
export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL("https://avanegas.com");
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /dev/",
    "",
    `Sitemap: ${new URL("/sitemap-index.xml", origin).href}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
