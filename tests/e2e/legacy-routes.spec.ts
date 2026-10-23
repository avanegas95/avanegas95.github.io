// Legacy URLs are a contract (CLAUDE.md rule 7, SCOPE §2 G6): the App Store and AdMob depend on
// them. Served from the static build by `serve`.
import { expect, test } from "./fixtures/guard";

const APP_ADS = "google.com, pub-2112756252403033, DIRECT, f08c47fec0942fa0\n";
const PHONE = /\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/;

test("/app-ads.txt serves the AdMob file as text/plain", async ({
  request,
}) => {
  const res = await request.get("/app-ads.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  expect(await res.text()).toBe(APP_ADS);
});

for (const path of ["/orbithop", "/orbithop/"]) {
  test(`${path} renders the Orbit Hop support page`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.ok()).toBe(true);
    await expect(page.locator("h1")).toHaveText("Astro Andy: Orbit Hop");
    await expect(page.locator("body")).toContainText("Restore Purchases");
    await expect(
      page.locator(
        'a[href="mailto:avanegas95@gmail.com?subject=Astro%20Andy%20support"]',
      ),
    ).toHaveCount(1);
    await expect(page).toHaveTitle("Support: Astro Andy: Orbit Hop");
    expect(PHONE.test((await page.textContent("body")) ?? "")).toBe(false);
  });
}

for (const path of ["/privacy", "/privacy/"]) {
  test(`${path} renders the privacy policy`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Privacy Policy");
    await expect(page.locator("body")).toContainText("Google AdMob");
    await expect(page).toHaveTitle("Privacy Policy: Astro Andy: Orbit Hop");
    await expect(
      page.locator('a[href="https://policies.google.com/privacy"]'),
    ).toHaveCount(1);
    expect(PHONE.test((await page.textContent("body")) ?? "")).toBe(false);
  });
}
