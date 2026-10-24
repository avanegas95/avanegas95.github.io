import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  blockRealApis,
  collectConsoleErrors,
  NO_TAB_REASON,
  noTabWebkit,
  stubBotId,
} from "./fixtures/chat";

const toggle = (page: Page) =>
  page.getByRole("button", { name: "Chat with Blob" });
const panel = (page: Page) => page.locator("#blob-panel");
const input = (page: Page) => page.getByLabel("Your question for Blob");

async function setup(page: Page) {
  await stubBotId(page);
  const { blocked } = await blockRealApis(page);
  const errors = collectConsoleErrors(page);
  await page.goto("/dev/blob/");
  await expect(page.locator("blob-agent:defined")).toHaveCount(1);
  return { blocked, errors };
}

test("opens via Blob, focuses the input, Esc restores focus", async ({
  page,
}) => {
  const { blocked, errors } = await setup(page);
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(input(page)).toBeFocused();
  await expect(panel(page)).toHaveAttribute("role", "dialog");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  expect(blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("opens via the hero field and the close button", async ({ page }) => {
  await setup(page);
  const ask = page.getByRole("button", { name: "Ask Blob about Anderson" });
  await ask.click();
  await expect(panel(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(ask).toBeFocused();
});

test("a chip opens the panel and fires blob:submit with its text", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as unknown as { __submits: string[] };
    w.__submits = [];
    document.addEventListener("blob:submit", (e) =>
      w.__submits.push((e as CustomEvent<{ text: string }>).detail.text),
    );
  });
  const chip = page.getByRole("button", { name: "Show me his projects" });
  await chip.click();
  await expect(panel(page)).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __submits: string[] }).__submits,
    ),
  ).toEqual(["Show me his projects"]);
  await page.keyboard.press("Escape");
  await expect(chip).toBeFocused();
});

test("keyboard-only: open, type, Tab stays inside the panel", async ({
  page,
  browserName,
}) => {
  test.skip(noTabWebkit(browserName), NO_TAB_REASON);
  await setup(page);
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("hello");
  await expect(input(page)).toHaveValue("hello");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("#blob-panel"),
      ),
    ).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("#blob-panel"),
      ),
    ).toBe(true);
  }
});

test("panel has a visible label, disclaimer, contact link and Clear chat", async ({
  page,
}) => {
  await setup(page);
  await toggle(page).click();
  await expect(page.locator('label[for="blob-input"]')).toBeVisible();
  await expect(input(page)).toHaveAttribute("maxlength", "500");
  await expect(
    panel(page).getByRole("link", { name: "contact" }),
  ).toHaveAttribute("href", "#contact");
  await expect(
    panel(page).getByRole("button", { name: "Clear chat" }),
  ).toBeVisible();
  await expect(panel(page).getByRole("log")).toHaveCount(1);
});

test("390x844: panel is a full-width bottom sheet", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await setup(page);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  // Poll: the entrance animation is still settling right after the panel appears.
  await expect
    .poll(async () => {
      const box = await panel(page).boundingBox();
      return box
        ? [
            Math.round(box.x),
            Math.round(box.width),
            Math.round(box.y + box.height),
          ]
        : null;
    })
    .toEqual([0, 390, 844]);
  await ctx.close();
});

test("320px: no horizontal scroll, open or closed", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 640 },
  });
  const page = await ctx.newPage();
  await setup(page);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
  expect(await overflow()).toBe(false);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await overflow()).toBe(false);
  await ctx.close();
});

test.describe("no JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("shows the fallback text, both links and a static Blob, no chips", async ({
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
    await expect(slot.locator(".ba-toggle:visible")).toHaveCount(0);
    await expect(slot.locator(".ba-ask:visible")).toHaveCount(0);
    await expect(panel(page)).toBeHidden();
  });
});

test("legacy pages are unchanged", async ({ page }) => {
  for (const path of ["/orbithop/", "/privacy/"]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("blob-agent")).toHaveCount(0);
  }
});

test("outside pointerdown closes the panel and restores focus", async ({
  page,
}) => {
  await setup(page);
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
});

test("the in-panel #contact link closes the panel and jumps to Contact", async ({
  page,
  browserName,
}) => {
  test.skip(noTabWebkit(browserName), NO_TAB_REASON);
  await setup(page);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("link", { name: "contact" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[inert]")).toHaveCount(0);
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.locator("#contact")).toBeInViewport();
  // Focus is not trapped: it left the panel, and Tab moves on from the Contact section.
  const focusState = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      const contact = document.querySelector("#contact");
      return {
        inPanel: !!a && !!document.querySelector("#blob-panel")?.contains(a),
        isBody: a === document.body,
        fromContact:
          !!a &&
          !!contact &&
          (contact.contains(a) ||
            !!(
              contact.compareDocumentPosition(a) &
              Node.DOCUMENT_POSITION_FOLLOWING
            )),
      };
    });
  expect((await focusState()).inPanel).toBe(false);
  await page.keyboard.press("Tab");
  const after = await focusState();
  expect(after.inPanel).toBe(false);
  expect(after.isBody).toBe(false);
  // WebKit does not move the sequential focus starting point on fragment navigation.
  if (browserName !== "webkit") expect(after.fromContact).toBe(true);
});

test("background is inert while open and restored on close", async ({
  page,
}) => {
  await setup(page);
  const inertOf = (sel: string) =>
    page.evaluate((s) => !!document.querySelector(s)?.closest("[inert]"), sel);
  expect(await inertOf("#talking-toggle")).toBe(false);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await inertOf("#talking-toggle")).toBe(true);
  expect(await inertOf(".ba-chip")).toBe(true);
  expect(await inertOf("#blob-input")).toBe(false);
  await page.keyboard.press("Escape");
  expect(await inertOf("#talking-toggle")).toBe(false);
  expect(await inertOf(".ba-chip")).toBe(false);
});

test("desktop panel stays inside the viewport", async ({ page }) => {
  await setup(page);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect
    .poll(async () => {
      const b = await panel(page).boundingBox();
      const vp = page.viewportSize();
      if (!b || !vp) return false;
      return (
        b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= vp.width &&
        b.y + b.height <= vp.height
      );
    })
    .toBe(true);
});

test("axe clean with the panel open", async ({ page }) => {
  await setup(page);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
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
});
