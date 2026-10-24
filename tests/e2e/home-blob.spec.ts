// Blob on the home page (P5-04c, placement A): hero side by side, About Me under #about.
// /api/chat is mocked; the real API is never reachable (CLAUDE.md rules 4 and 5).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  mockChat,
  stubBotId,
} from "./fixtures/chat";
import { COPY } from "../../src/scripts/blob/copy";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const bubble = (page: Page) => page.locator('[data-ba="bubble"]');

async function open(page: Page) {
  await stubBotId(page);
  const { blocked } = await blockRealApis(page);
  const errors = collectConsoleErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("blob-agent:defined")).toHaveCount(1);
  return { blocked, errors };
}

test("Blob is mounted once on / and visible in the first viewport at 1280x800", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.locator("blob-agent")).toHaveCount(1);
  const box = await page.locator('[data-ba="figure"]').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  await expect(page.getByLabel(COPY.inputLabel)).toBeInViewport();
});

test("desktop: intro on the left, Blob on the right, top-aligned", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const intro = await page.locator(".home-intro").boundingBox();
  const blob = await page.locator(".home-blob").boundingBox();
  expect(blob!.x).toBeGreaterThan(intro!.x + intro!.width - 1);
  expect(Math.abs(blob!.y - intro!.y)).toBeLessThanOrEqual(1);
});

test("a chip streams the fixture reply into the bubble, and the left column does not move", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockChat(page, { events: FIXTURES.happy });
  await open(page);
  const cta = page.getByRole("link", { name: "Check out my work" });
  const before = await cta.boundingBox();
  await page.getByRole("button", { name: COPY.chips[0]! }).click();
  await expect(bubble(page)).toContainText("Ask me about Anderson.");
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  const after = await cta.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.x).toBe(before!.x);
});

test("layout shift at load is at most 0.01", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const ls = e as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!ls.hadRecentInput) w.__cls += ls.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await open(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const cls = await page.evaluate(
    () => (window as unknown as { __cls: number }).__cls,
  );
  expect(cls).toBeLessThanOrEqual(0.01);
});

test("375px: no horizontal scroll, Blob and bubble clear of the bottom nav", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockChat(page, { events: FIXTURES.happy });
  await open(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: COPY.chips[0]! }).click();
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  // Scrolled into view, neither the stage nor the bubble may sit under the fixed bottom bar.
  for (const sel of ['[data-ba="figure"]', '[data-ba="bubble"]']) {
    const loc = page.locator(sel);
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const nav = await page.locator("nav.md\\:hidden").boundingBox();
    const overlaps = b!.y < nav!.y + nav!.height && b!.y + b!.height > nav!.y;
    expect(overlaps, sel).toBe(false);
  }
});

test("About Me lives under #about, in v1 order, with the other sections", async ({
  page,
}) => {
  await open(page);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("main > section")].map((s) => s.id),
  );
  expect(ids).toEqual(["home", "about", "experience", "projects", "contact"]);
  await expect(page.locator("#about")).toContainText("About Me");
  await expect(page.locator("#home")).not.toContainText("About Me");
  await expect(page.locator("#about")).toContainText(
    "B.S. in Computer Engineering",
  );
  await expect(
    page.getByRole("link", { name: "Check out my work" }),
  ).toHaveAttribute("href", "#projects");
});

test("axe: no violations idle and after a reply", async ({ page }) => {
  await mockChat(page, { events: FIXTURES.happy });
  await open(page);
  await page.waitForLoadState("networkidle");
  const idle = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(idle.violations).toEqual([]);
  await page.getByRole("button", { name: COPY.chips[0]! }).click();
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  const after = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(after.violations).toEqual([]);
});

test("a link in a long reply cannot take focus while clipped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const para = "Long filler sentence about quality engineering. ".repeat(12);
  const text = Array.from({ length: 12 }, () => para).join("\n\n");
  await mockChat(page, {
    events: [
      { event: "mood", data: { mood: "happy" } },
      {
        event: "delta",
        data: { text: `${text}\n\nSee the [contact](#contact) section.` },
      },
      { event: "done", data: { usageBucket: "ok" } },
    ],
  });
  await open(page);
  await page.getByRole("button", { name: COPY.chips[0]! }).click();
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  const clip = page.locator('[data-ba="clip"]');
  await expect(clip).toHaveAttribute("data-clamped", "true");
  const more = page.locator('[data-ba="more"]');
  await expect(more).toHaveAttribute("aria-controls", "blob-clip");
  await page.locator(".ba-text a").focus();
  await expect(clip).toHaveAttribute("data-expanded", "true");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // Nothing is clipped any more, so the focused link is rendered.
  expect(
    await clip.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
});

test("legacy sections still render and the page is quiet", async ({ page }) => {
  const { blocked, errors } = await open(page);
  for (const id of ["experiences", "projects", "contact", "about", "home"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  expect(blocked).toEqual([]);
  expect(errors()).toEqual([]);
});
