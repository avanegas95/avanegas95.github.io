// Blog: only the post(s) Anderson named at H1 are published (decision log 2026-10-23); every
// other post in src/content/blog is `draft: true` and must produce no route, card or tag entry.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/guard";

const PUBLISHED = ["what-this-blog-is-about"];
const DRAFTS = [
  "trip-to-italy",
  "lessons-from-wiring-ci-for-mobile-tests",
  "three-things-that-improved-my-b-roll",
];
const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("/blog/ lists exactly the published posts", async ({ page }) => {
  const res = await page.goto("/blog/");
  expect(res?.status()).toBe(200);
  const hrefs = await page
    .locator(
      'section[aria-label="Blog posts"] a[href^="/blog/"]:not([href^="/blog/tags/"])',
    )
    .evaluateAll((els) =>
      [...new Set(els.map((e) => (e as HTMLAnchorElement).pathname))].sort(),
    );
  expect(hrefs).toEqual(PUBLISHED.map((s) => `/blog/${s}/`).sort());
});

for (const slug of PUBLISHED) {
  test(`/blog/${slug}/ returns 200 with one h1`, async ({ page }) => {
    const res = await page.goto(`/blog/${slug}/`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
  });
}

for (const slug of DRAFTS) {
  test(`draft /blog/${slug}/ has no page`, async ({ request }) => {
    const res = await request.get(`/blog/${slug}/`);
    expect(res.status()).toBe(404);
  });
}

test("tag pages list only published posts; draft-only tags have no page", async ({
  page,
  request,
}) => {
  await page.goto("/blog/tags/meta/");
  await expect(page.locator("article")).toHaveCount(PUBLISHED.length);
  for (const tag of ["life", "video", "ci-cd", "automation", "creative"]) {
    const res = await request.get(`/blog/tags/${tag}/`);
    expect(res.status(), tag).toBe(404);
  }
});

for (const path of ["/blog/", `/blog/${PUBLISHED[0]}/`]) {
  test(`a11y: ${path} has no axe violations`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

// The blog column is wide (max-w-7xl). A full-width 16:9 cover pushed the first post's title
// and summary below the fold on a laptop, so from md up the card puts the cover beside the text.
for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`/blog/ shows the first post's title and summary above the fold at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/blog/");
    const card = page
      .locator('section[aria-label="Blog posts"] article')
      .first();
    for (const el of [card.locator("h2"), card.locator("p").first()]) {
      const box = (await el.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }
  });
}

test("/blog/ cards stay stacked on a phone, cover first", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/blog/");
  const card = page.locator('section[aria-label="Blog posts"] article').first();
  const cover = (await card.locator("picture, img").first().boundingBox())!;
  const title = (await card.locator("h2").boundingBox())!;
  expect(title.y).toBeGreaterThan(cover.y + cover.height - 1);
});
