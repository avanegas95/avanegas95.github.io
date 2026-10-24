import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/guard";

const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const scheme of ["light", "dark"] as const) {
  test(`a11y: / has no axe violations (${scheme})`, async ({ page }) => {
    // Section fade-ins are skipped under reduced motion, so axe measures colours at rest
    // instead of mid-transition (a half-faded heading reads as false low contrast).
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: scheme });
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
