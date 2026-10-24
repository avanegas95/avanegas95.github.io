import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const year = String(new Date().getFullYear());

test.describe("footer", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("has no iframe and no Spotify requests", async ({ page }) => {
    const spotify: string[] = [];
    page.on("request", (r) => {
      if (/(^|\.)spotify\.com$/.test(new URL(r.url()).hostname))
        spotify.push(r.url());
    });
    await page.goto("/");
    await page.locator("footer").scrollIntoViewIfNeeded();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("footer iframe")).toHaveCount(0);
    expect(spotify).toEqual([]);
  });

  test("links resolve to 200 and copyright shows the current year", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const links = page.locator('footer nav[aria-label="Site links"] a');
    await expect(links).toHaveCount(3);
    for (const href of await links.evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    )) {
      const res = await request.get(href);
      expect(res.status(), href).toBe(200);
    }
    await expect(page.locator("footer")).toContainText(`© ${year}`);
  });

  test("footer region has no axe violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("footer")).toBeAttached();
    const results = await new AxeBuilder({ page }).include("footer").analyze();
    expect(results.violations).toEqual([]);
  });

  test("links sit above the fixed bottom nav at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const link = page.locator('footer nav[aria-label="Site links"] a').last();
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    const bottom = box!.y + box!.height;
    const fixedTops = await page.evaluate(() =>
      Array.from(document.querySelectorAll("nav, header, div"))
        .filter((e) => getComputedStyle(e).position === "fixed")
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.bottom >= window.innerHeight - 1 && r.height > 0)
        .map((r) => r.top),
    );
    for (const top of fixedTops) expect(bottom).toBeLessThanOrEqual(top + 1);
  });

  test("/orbithop/ keeps the email text with a space", async ({ page }) => {
    const res = await page.goto("/orbithop/");
    expect(res?.status()).toBe(200);
    expect(await page.locator("main").innerText()).toContain(
      "Email avanegas95@",
    );
  });
});
