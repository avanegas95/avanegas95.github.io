import { expect, test } from "./fixtures/guard";

const ICONS: [string, string][] = [
  ["/favicon.svg", "image/svg+xml"],
  ["/favicon-32.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
  ["/favicon.ico", "image/"],
];

test("head links the new icons and every one is served with a 200", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const hrefs = await page
    .locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  for (const [path] of ICONS) expect(hrefs).toContain(path);
  expect(hrefs.join()).not.toContain("_astro");

  for (const [path, type] of ICONS) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toContain(type);
  }
});
