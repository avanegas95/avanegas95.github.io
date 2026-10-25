import AxeBuilder from "@axe-core/playwright";
import { KB_ROOT, loadKbSources, parseKbSource } from "../../src/lib/kb.ts";
import type { Project } from "../../src/lib/kb-schema.ts";
import { expect, test } from "./fixtures/guard";

// The KB is the expected value: the site must show exactly what the project files say.
const all = loadKbSources(KB_ROOT)
  .filter((s) => s.path.startsWith("projects/"))
  .map((s) => ({
    slug: s.path.replace(/^projects\//, "").replace(/\.md$/, ""),
    data: parseKbSource(s).data as Project,
  }));
const cards = all
  .filter((p) => p.data.public && p.data.featured)
  .sort((a, b) => a.data.order - b.data.order);
const hidden = all.filter((p) => !p.data.public);
const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("one card per public KB project, titled and linked from the KB", async ({
  page,
}) => {
  await page.goto("/");
  const section = page.locator("#projects");
  const links = section.getByTestId("project-title-link");
  await expect(links).toHaveCount(cards.length);
  for (const [i, c] of cards.entries()) {
    const link = links.nth(i);
    await expect(link).toHaveText(c.data.title);
    await expect(link).toHaveAttribute("href", `/projects/${c.slug}/`);
  }
  for (const h of hidden) {
    await expect(section.getByText(h.data.title, { exact: true })).toHaveCount(
      0,
    );
  }
});

test("no card uses the placeholder image", async ({ page }) => {
  await page.goto("/");
  const srcs = await page
    .locator("#projects img")
    .evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""));
  for (const s of srcs) expect(s).not.toMatch(/placeholder/i);
});

for (const c of cards) {
  test(`/projects/${c.slug}/ renders the KB write-up`, async ({ page }) => {
    const res = await page.goto(`/projects/${c.slug}/`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      c.data.title,
    );
    await expect(page).toHaveTitle(c.data.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      c.data.summary,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/projects/${c.slug}/$`),
    );
    await expect(
      page.getByRole("link", { name: /Back to projects/ }),
    ).toHaveAttribute("href", "/#projects");
    await expect(page.getByTestId("project-status")).toHaveText(c.data.status);
    await expect(page.locator("main h3").first()).toBeVisible();
    // No live link for a project still in development.
    if (/in[\s-]development/i.test(c.data.status)) {
      await expect(page.getByRole("link", { name: /^Visit / })).toHaveCount(0);
    }
    for (const img of await page.locator("main article img").all()) {
      expect((await img.getAttribute("alt"))?.trim()).toBeTruthy();
      expect(await img.getAttribute("width")).toBeTruthy();
      expect(await img.getAttribute("height")).toBeTruthy();
    }
  });
}

for (const h of hidden) {
  test(`non-public /projects/${h.slug}/ is a 404`, async ({ page }) => {
    const res = await page.goto(`/projects/${h.slug}/`);
    expect(res?.status()).toBe(404);
  });
}

test("a11y: #projects has no axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .include("#projects")
    .withTags(WCAG_21_AA_TAGS)
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a11y: a project page has no axe violations", async ({ page }) => {
  const first = cards[0];
  if (!first) throw new Error("no public project");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/projects/${first.slug}/`);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA_TAGS)
    .analyze();
  expect(results.violations).toEqual([]);
});

test.describe("375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("projects section and a detail page fit without horizontal scroll", async ({
    page,
  }, testInfo) => {
    const first = cards[0];
    if (!first) throw new Error("no public project");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.locator("#projects").scrollIntoViewIfNeeded();
    await testInfo.attach("projects-375", {
      body: await page.locator("#projects").screenshot(),
      contentType: "image/png",
    });
    const overflowHome = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflowHome).toBe(false);

    await page.goto(`/projects/${first.slug}/`);
    await testInfo.attach("project-page-375", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
