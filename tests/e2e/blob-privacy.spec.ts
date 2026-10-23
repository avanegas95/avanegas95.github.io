import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("/blob-privacy/", () => {
  test("renders the Blob privacy note", async ({ page }) => {
    const response = await page.goto("/blob-privacy/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text).toContain("not logged");
    expect(text).toContain("anthropic");
    await expect(
      page.locator('main a[href="/#contact"]').first(),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/blob-privacy\/$/,
    );
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/blob-privacy/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("keeps the Orbit Hop privacy page unchanged", async ({ page }) => {
    const response = await page.goto("/privacy/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Privacy Policy");
    await expect(page.locator("main")).toContainText("Astro Andy: Orbit Hop");
  });
});
