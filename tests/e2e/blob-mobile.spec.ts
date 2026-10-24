// Mobile (touch, phone-sized) behaviour of the speech bubble.
import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  mockChat,
  stubBotId,
} from "./fixtures/chat";

test.use({ viewport: { width: 375, height: 800 }, hasTouch: true });

const bubble = (page: Page) => page.locator('[data-ba="bubble"]');
const input = (page: Page) => page.getByLabel("Your question for Blob");
const replyLinks = (page: Page) => page.locator('[data-ba="clip"] > .ba-msg a');

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

test("375px: the bubble is as wide as its container, below Blob", async ({
  page,
}) => {
  const { api, errors } = await setup(page);
  const host = (await page.locator("blob-agent").boundingBox())!;
  const b = (await bubble(page).boundingBox())!;
  const f = (await page.locator('[data-ba="figure"]').boundingBox())!;
  expect(Math.abs(b.width - host.width)).toBeLessThan(1);
  expect(b.y).toBeGreaterThanOrEqual(f.y + f.height);
  // Still true after a reply.
  await input(page).fill("Links?");
  await input(page).press("Enter");
  await expect(replyLinks(page)).toHaveCount(2);
  expect(
    Math.abs((await bubble(page).boundingBox())!.width - host.width),
  ).toBeLessThan(1);
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("the input is visible without opening anything, before and after a reply", async ({
  page,
}) => {
  await setup(page);
  await expect(input(page)).toBeInViewport({ ratio: 1 });
  await input(page).fill("Links?");
  await input(page).press("Enter");
  await expect(replyLinks(page)).toHaveCount(2);
  await expect(input(page)).toBeInViewport({ ratio: 1 });
});

test("a chip tap sends and the reply appears in the bubble", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Show me his projects" }).tap();
  await expect(replyLinks(page)).toHaveCount(2);
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
});

for (const width of [320, 375]) {
  test(`${width}px: no horizontal scroll idle or with a reply`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await setup(page);
    expect(await overflows(page)).toBe(false);
    await input(page).fill("Links?");
    await input(page).press("Enter");
    await expect(replyLinks(page)).toHaveCount(2);
    expect(await overflows(page)).toBe(false);
  });
}
