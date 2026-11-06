// robots.txt and the sitemap (P6-06). Served from the static build by `serve`.
import { expect, test } from "./fixtures/guard";

const locs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string);

test("/robots.txt disallows /api/ and /dev/ and points at the sitemap", async ({
  request,
}) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const body = await res.text();
  expect(body).toContain("User-agent: *");
  expect(body).toContain("Disallow: /api/");
  expect(body).toContain("Disallow: /dev/");
  expect(body).toContain("Sitemap: https://avanegas.com/sitemap-index.xml");
});

test("the sitemap lists public pages only and every URL serves 200", async ({
  request,
}) => {
  const index = await request.get("/sitemap-index.xml");
  expect(index.status()).toBe(200);
  expect(index.headers()["content-type"]).toMatch(/xml/);
  const sitemaps = locs(await index.text());
  expect(sitemaps.length).toBeGreaterThan(0);

  const urls: string[] = [];
  for (const sm of sitemaps) {
    const res = await request.get(new URL(sm).pathname);
    expect(res.status()).toBe(200);
    urls.push(...locs(await res.text()));
  }

  const paths = urls.map((u) => new URL(u).pathname);
  for (const p of [
    "/",
    "/blog/",
    "/orbithop/",
    "/privacy/",
    "/blob-privacy/",
  ]) {
    expect(paths).toContain(p);
  }
  expect(paths.some((p) => p.startsWith("/blog/") && p !== "/blog/")).toBe(
    true,
  );
  expect(paths.some((p) => p.startsWith("/projects/"))).toBe(true);
  expect(paths.filter((p) => /^\/(dev|api)(\/|$)/.test(p))).toEqual([]);

  for (const p of paths) {
    const res = await request.get(p, { maxRedirects: 0 });
    expect(res.status(), p).toBe(200);
  }
});

test("the home page head links the sitemap", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('head link[rel="sitemap"]')).toHaveAttribute(
    "href",
    "/sitemap-index.xml",
  );
});
