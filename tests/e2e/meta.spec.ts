import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/guard";

const bio = readFileSync("src/content/knowledge/bio.md", "utf8");
const summary = /^summary: "(.*)"$/m.exec(bio)?.[1] ?? "";

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}
const csp =
  (JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig).headers
    .find((h) => h.source === "/(.*)")
    ?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

function ldBlocks(page: Page): Promise<string[]> {
  return page.locator('script[type="application/ld+json"]').allTextContents();
}

test("home has one Person JSON-LD block, KB description and og:image", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const blocks = await ldBlocks(page);
  expect(blocks).toHaveLength(1);
  const ld = JSON.parse(blocks[0] ?? "{}") as Record<string, unknown>;
  expect(ld["@type"]).toBe("Person");
  expect(ld).not.toHaveProperty("address");
  expect(ld).not.toHaveProperty("telephone");

  expect(summary).not.toBe("");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    summary,
  );
  await expect(page).toHaveTitle(/^Anderson Vanegas \| .+/);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "Anderson Vanegas",
  );

  const img = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(img).toBe("https://avanegas.com/images/og.image.png");
  const res = await request.get(new URL(img ?? "").pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
});

for (const path of ["/blog/", "/orbithop/", "/privacy/"]) {
  test(`no JSON-LD on ${path}`, async ({ page }) => {
    await page.goto(path);
    expect(await ldBlocks(page)).toHaveLength(0);
  });
}

test("no CSP violation on / with the JSON-LD block", async ({
  page,
  baseURL,
}) => {
  await page.route("**/*", async (route) => {
    if (
      !route
        .request()
        .url()
        .startsWith(baseURL ?? "")
    )
      return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  const messages: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") messages.push(m.text());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // The footer Spotify embed violation is a known issue owned by csp.spec.ts.
  const own = messages.filter(
    (t) =>
      /content security policy|refused to|violat/i.test(t) &&
      !/open\.spotify\.com/.test(t),
  );
  expect(own).toEqual([]);
});
