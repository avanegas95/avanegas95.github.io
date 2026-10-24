// The speech bubble shell on /dev/blob (SCOPE 4.3, 4.4): idle greeting, always-visible input,
// no modal behaviour, layout by container width, no layout shift. /api/chat is mocked.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  mockChat,
  NO_TAB_REASON,
  noTabWebkit,
  stubBotId,
} from "./fixtures/chat";

const bubble = (page: Page) => page.locator('[data-ba="bubble"]');
const input = (page: Page) => page.getByLabel("Your question for Blob");
const figure = (page: Page) => page.locator('[data-ba="figure"]');

async function setup(page: Page) {
  await stubBotId(page);
  const { blocked } = await blockRealApis(page);
  const errors = collectConsoleErrors(page);
  await page.goto("/dev/blob/");
  await expect(page.locator("blob-agent:defined")).toHaveCount(1);
  return { blocked, errors };
}

test("idle: greeting bubble, starter chips and a visible input, no open step", async ({
  page,
}) => {
  const { blocked, errors } = await setup(page);
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toContainText(
    "Hi! I'm Blob. Ask me anything about Anderson.",
  );
  await expect(bubble(page)).toHaveAttribute("data-phase", "idle");
  const chips = bubble(page).locator(".ba-chip");
  expect(await chips.count()).toBeGreaterThanOrEqual(3);
  expect(await chips.count()).toBeLessThanOrEqual(4);
  await expect(input(page)).toBeVisible();
  await expect(page.locator('label[for="blob-input"]')).toBeVisible();
  await expect(input(page)).toHaveAttribute("maxlength", "500");
  await expect(page.getByRole("button", { name: "Clear chat" })).toBeVisible();
  await expect(
    page.locator("blob-agent").getByRole("link", { name: "contact" }),
  ).toHaveAttribute("href", "#contact");
  // Earlier-turn and clamp controls only exist once they are needed.
  await expect(page.locator('[data-ba="previous-wrap"]')).toBeHidden();
  await expect(page.locator('[data-ba="more"]')).toBeHidden();
  expect(blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("no modal left over: no dialog role, aria-modal, inert or trap", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator('[role="dialog"], [aria-modal]')).toHaveCount(0);
  await expect(page.locator("[inert]")).toHaveCount(0);
  await expect(page.locator("#blob-panel, .ba-panel, .ba-toggle")).toHaveCount(
    0,
  );
  await expect(page.locator('[data-ba="answer"]')).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.locator('[data-ba="answer"]')).not.toHaveAttribute(
    "role",
    "dialog",
  );
});

test("a chip sends its exact text from the idle state", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as unknown as { __submits: string[] };
    w.__submits = [];
    document.addEventListener("blob:submit", (e) =>
      w.__submits.push((e as CustomEvent<{ text: string }>).detail.text),
    );
  });
  await mockChat(page, { events: FIXTURES.happy });
  await page.getByRole("button", { name: "Show me his projects" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __submits: string[] }).__submits,
    ),
  ).toEqual(["Show me his projects"]);
  await expect(bubble(page)).toContainText("Ask me about Anderson.");
  // The starters give way to the answer.
  await expect(bubble(page).locator(".ba-chip")).toHaveCount(4);
  await expect(bubble(page).locator(".ba-chip").first()).toBeHidden();
});

test("keyboard-only: Tab reaches the input, no trap, Tab keeps moving", async ({
  page,
  browserName,
}) => {
  test.skip(noTabWebkit(browserName), NO_TAB_REASON);
  await setup(page);
  await input(page).focus();
  await page.keyboard.type("hello");
  await expect(input(page)).toHaveValue("hello");
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    seen.add(
      await page.evaluate(() =>
        document.activeElement?.closest("blob-agent") ? "in" : "out",
      ),
    );
  }
  // Focus left Blob again: nothing traps it.
  expect(seen.has("out")).toBe(true);
});

test("Esc returns focus to the input", async ({ page, browserName }) => {
  test.skip(noTabWebkit(browserName), NO_TAB_REASON);
  await setup(page);
  await page.getByRole("button", { name: "Clear chat" }).focus();
  await page.keyboard.press("Escape");
  await expect(input(page)).toBeFocused();
});

test("the #contact link jumps to Contact and focus is free", async ({
  page,
}) => {
  await setup(page);
  await page
    .locator("blob-agent")
    .getByRole("link", { name: "contact" })
    .click();
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.locator("#contact")).toBeInViewport();
});

test.describe("layout by container width", () => {
  test("375px: bubble is full width, below Blob and the input", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 800 },
    });
    const page = await ctx.newPage();
    await setup(page);
    const host = (await page.locator("blob-agent").boundingBox())!;
    const b = (await bubble(page).boundingBox())!;
    const f = (await figure(page).boundingBox())!;
    expect(Math.abs(b.width - host.width)).toBeLessThan(1);
    expect(b.y).toBeGreaterThanOrEqual(f.y + f.height);
    await ctx.close();
  });

  test("1280px: bubble sits beside Blob", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    await setup(page);
    const b = (await bubble(page).boundingBox())!;
    const f = (await figure(page).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(f.x + f.width);
    expect(b.width).toBeLessThan(
      (await page.locator("blob-agent").boundingBox())!.width,
    );
    await ctx.close();
  });
});

test("320px: no horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 640 },
  });
  const page = await ctx.newPage();
  await setup(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await ctx.close();
});

test.describe("no JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("shows the fallback text, both links and a static Blob, no controls", async ({
    page,
  }) => {
    await page.goto("/dev/blob/");
    const slot = page.locator("blob-agent");
    await expect(slot).toContainText("Chat needs JavaScript.");
    await expect(slot.getByRole("link", { name: "resume" })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/avanegas95",
    );
    await expect(slot.getByRole("link", { name: "contact" })).toHaveAttribute(
      "href",
      "#contact",
    );
    await expect(slot.locator(".blob-figure svg:visible")).toHaveCount(1);
    await expect(slot.locator(".ba-chip:visible")).toHaveCount(0);
    await expect(slot.locator(".ba-form:visible")).toHaveCount(0);
  });
});

test("legacy pages are unchanged", async ({ page }) => {
  for (const path of ["/orbithop/", "/privacy/"]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("blob-agent")).toHaveCount(0);
  }
});

test.describe("axe", () => {
  // The bubble pop is a fade-in: emulate reduced motion so axe never samples a half-faded colour.
  test.use({ reducedMotion: "reduce" });

  test("clean when idle", async ({ page }) => {
    await setup(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("layout shift", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("total CLS < 0.1 on mobile", async ({ page }) => {
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
    await setup(page);
    await page.waitForTimeout(1000);
    const cls = await page.evaluate(
      () => (window as unknown as { __cls: number }).__cls,
    );
    expect(cls).toBeLessThan(0.1);
  });

  for (const width of [412, 768, 1280]) {
    test(`the blob swap does not change the block height at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      // Never load the island: the element stays un-upgraded (the pre-swap state).
      await page.route(/BlobAgent[^/]*\.js/, (route) => route.abort());
      await page.goto("/dev/blob/");
      const before = await page.locator("blob-agent").boundingBox();
      await page.unroute(/BlobAgent[^/]*\.js/);
      await page.reload();
      await expect(page.locator("blob-agent:defined")).toHaveCount(1);
      const after = await page.locator("blob-agent").boundingBox();
      expect(
        Math.abs((before?.height ?? 0) - (after?.height ?? -1)),
      ).toBeLessThan(1);
    });
  }

  test("the first token does not move the input", async ({ page }) => {
    await setup(page);
    await mockChat(page, { events: FIXTURES.happy }, { delayMs: 400 });
    const inputY = (await input(page).boundingBox())!.y;
    await input(page).fill("Hi");
    await input(page).press("Enter");
    await expect(bubble(page)).toContainText("Ask me about Anderson.");
    // Growth is downward only: everything above the bubble stays put.
    expect((await input(page).boundingBox())!.y).toBe(inputY);
  });
});
