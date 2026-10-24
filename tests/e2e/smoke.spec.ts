import { expect, test } from "./fixtures/guard";

for (const path of ["/", "/blog/"]) {
  test(`smoke: ${path} renders`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect((await page.title()).trim()).not.toBe("");
    await expect(page.locator("h1")).toHaveCount(1);
  });
}
