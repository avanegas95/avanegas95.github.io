// Mobile (touch, iPhone-sized) behaviour of the chat bottom sheet on all three engines.
import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  mockChat,
  stubBotId,
} from "./fixtures/chat";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const toggle = (page: Page) =>
  page.getByRole("button", { name: "Chat with Blob" });
const panel = (page: Page) => page.locator("#blob-panel");
const input = (page: Page) => page.getByLabel("Your question for Blob");
const replyLinks = (page: Page) =>
  page.locator('[data-ba="log"] [data-role="assistant"] a');

async function setup(page: Page) {
  await stubBotId(page);
  const api = await blockRealApis(page);
  const errors = collectConsoleErrors(page);
  await mockChat(page, { events: FIXTURES.links });
  await page.goto("/dev/blob/");
  await expect(page.locator("blob-agent:defined")).toHaveCount(1);
  return { api, errors };
}

const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test("tap opens the bottom sheet; the close button and Esc close it", async ({
  page,
}) => {
  const { api, errors } = await setup(page);
  await toggle(page).tap();
  await expect(panel(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.getByRole("button", { name: "Close chat" }).tap();
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  await toggle(page).tap();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("the input stays above the fold, before and after a reply", async ({
  page,
}) => {
  await setup(page);
  await toggle(page).tap();
  await expect(panel(page)).toBeVisible();
  await expect(input(page)).toBeInViewport({ ratio: 1 });
  await input(page).fill("Links?");
  await input(page).press("Enter");
  await expect(replyLinks(page)).toHaveCount(2);
  await expect(input(page)).toBeInViewport({ ratio: 1 });
  const box = (await input(page).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
});

test("a chip tap opens the sheet and sends", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Show me his projects" }).tap();
  await expect(panel(page)).toBeVisible();
  await expect(replyLinks(page)).toHaveCount(2);
});

for (const width of [320, 390]) {
  test(`${width}px: no horizontal scroll closed, open, or with a reply`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await setup(page);
    expect(await overflows(page)).toBe(false);
    await toggle(page).tap();
    await expect(panel(page)).toBeVisible();
    expect(await overflows(page)).toBe(false);
    await input(page).fill("Links?");
    await input(page).press("Enter");
    await expect(replyLinks(page)).toHaveCount(2);
    expect(await overflows(page)).toBe(false);
  });
}
