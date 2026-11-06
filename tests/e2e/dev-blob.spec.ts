import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { MOODS } from "../../src/lib/moods.ts";

const PATH = "/dev/blob/";

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}
const config = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;
const csp =
  config.headers
    .find((h) => h.source === "/(.*)")
    ?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

test("/dev/blob renders every mood at both sizes", async ({ page }) => {
  const res = await page.goto(PATH);
  expect(res?.status()).toBe(200);
  for (const mood of MOODS) {
    const grid = page.locator(`#grid .blob-figure[data-mood="${mood}"]`);
    await expect(grid).toHaveCount(2);
    await expect(grid.first()).toHaveAttribute("data-size", "hero");
    await expect(grid.last()).toHaveAttribute("data-size", "avatar");
  }
});

test("/dev/blob buttons fire moods and toggle talking", async ({ page }) => {
  await page.goto(PATH);
  const stage = page.locator("#stage .blob-figure");
  await page.getByRole("button", { name: "excited", exact: true }).click();
  await expect(stage).toHaveAttribute("data-mood", "excited");
  await page.getByRole("button", { name: "Talking" }).click();
  await expect(stage).toHaveAttribute("data-talking", "true");
});

test("/dev/blob is axe clean", async ({ page }) => {
  await page.goto(PATH);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("/dev/blob has no CSP violations", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  const messages: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      messages.push(msg.text());
    }
  });
  await page.goto(PATH);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "happy", exact: true }).click();
  await page.getByRole("button", { name: "Talking" }).click();
  await page.waitForTimeout(500);
  expect(
    messages.filter((m) =>
      /content security policy|refused to|violat/i.test(m),
    ),
  ).toEqual([]);
});

test("animations run normally", async ({ page }) => {
  await page.goto(PATH);
  const n = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) =>
          (a.effect as KeyframeEffect).target?.closest(".blob-figure"),
        ).length,
  );
  expect(n).toBeGreaterThan(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no running animations inside .blob-figure", async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole("button", { name: "excited", exact: true }).click();
    await page.getByRole("button", { name: "Talking" }).click();
    await page.getByRole("button", { name: "sleepy", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) =>
              (a.effect as KeyframeEffect).target?.closest(".blob-figure"),
            )
            .map((a) => a.constructor.name),
        ),
      )
      .toEqual([]);
  });
});
