import AxeBuilder from "@axe-core/playwright";
import { KB_ROOT, loadKbSources, parseKbSource } from "../../src/lib/kb.ts";
import { expect, test } from "./fixtures/guard";

// The KB is the expected value: the page must show exactly what `roles` says (CLAUDE.md rule 1).
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const monthYear = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

interface KbRole {
  company: string;
  title: string;
  start: string;
  end: string | null;
  showOnSite: boolean;
  bullets: string[];
}
const src = loadKbSources(KB_ROOT).find((s) =>
  s.path.endsWith("experience.md"),
);
if (!src) throw new Error("experience.md not found");
const data = parseKbSource(src).data as unknown as { roles: KbRole[] };
const roles = data.roles.filter((r) => r.showOnSite);

test("every KB role shows its title and date range, and the Staff card says March 2026", async ({
  page,
}) => {
  await page.goto("/");
  const section = page.locator("#experience");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(
    "Experience",
  );
  for (const r of roles) {
    const block = section.getByTestId("experience-card").filter({
      has: page.getByRole("heading", {
        level: 3,
        name: r.title,
        exact: true,
      }),
    });
    const dates = `${monthYear(r.start)} – ${r.end ? monthYear(r.end) : "Present"}`;
    await expect(block.locator(".experience-card__dates")).toHaveText(dates);
  }
  await expect(
    section.locator(".experience-card__dates", {
      hasText: "March 2026 – Present",
    }),
  ).toHaveCount(1);
});

test("one card per role, in KB order, bullets verbatim", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("experience-card")).toHaveCount(roles.length);
  const titles = await page
    .locator("#experience h3.experience-card__role")
    .allTextContents();
  expect(titles).toEqual(roles.map((r) => r.title));
  const rendered = await page
    .locator("#experience .experience-card__item span:not([aria-hidden])")
    .allTextContents();
  expect(rendered).toEqual(roles.flatMap((r) => r.bullets));
});

test("every bullet shows on its card: no Show more toggle, no hidden bullets", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#experience details")).toHaveCount(0);
  await expect(page.locator("#experience summary")).toHaveCount(0);
  for (const r of roles) {
    const card = page.getByTestId("experience-card").filter({
      has: page.getByRole("heading", { level: 3, name: r.title, exact: true }),
    });
    await expect(card.locator("li")).toHaveCount(r.bullets.length);
    for (const li of await card.locator("li").all()) {
      await expect(li).toBeVisible();
    }
    await expect(card.locator("h3")).toHaveCount(1);
    // Bullet-less roles are compact: title and dates only, no photo.
    await expect(card.locator("img")).toHaveCount(r.bullets.length ? 2 : 0);
  }
});

test("cards sit in a 1, 2 then 3 column grid by viewport width", async ({
  page,
}) => {
  const cols = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    return page
      .locator("#experience .grid")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
  };
  expect(await cols(390)).toBe(1);
  expect(await cols(800)).toBe(2);
  expect(await cols(1280)).toBe(3);
});

test("#experience and the old #experiences alias both reach the section", async ({
  page,
}) => {
  for (const hash of ["experience", "experiences"]) {
    await page.goto(`/#${hash}`);
    await page.waitForLoadState("networkidle");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document
            .getElementById("experience")!
            .getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0;
        }),
      )
      .toBe(true);
  }
  await expect(page.locator("#experience")).toHaveCount(1);
  await expect(page.locator("#experiences")).toHaveCount(1);
});

test("at 390 px no experience image is wider than 640 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  const imgs = page.locator("#experience img");
  const n = await imgs.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth),
      )
      .toBeGreaterThan(0);
    expect(
      await img.evaluate((el: HTMLImageElement) => el.naturalWidth),
    ).toBeLessThanOrEqual(640);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe is clean on the experience section (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: scheme });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .include("#experience")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
