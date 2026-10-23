// Main chat E2E (SCOPE §7): /api/chat is always mocked; no real API is ever reached.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { COPY } from "../../src/scripts/blob/copy";
import { MOOD_EMOJI } from "../../src/scripts/blob/motion";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  frame,
  mockChat,
  mockChatStream,
  NO_TAB_REASON,
  noTabWebkit,
  stubBotId,
} from "./fixtures/chat";

type Body = {
  messages: { role: string; content: string }[];
  sessionId: string;
};

const panel = (page: Page) => page.locator("#blob-panel");
const toggle = (page: Page) =>
  page.getByRole("button", { name: "Chat with Blob" });
const input = (page: Page) => page.getByLabel("Your question for Blob");
const log = (page: Page) => page.locator('[data-ba="log"]');
const replies = (page: Page) => log(page).locator('[data-role="assistant"]');
const lastReply = (page: Page) => replies(page).last();
const avatar = (page: Page) => panel(page).locator(".blob-figure");
const hero = (page: Page) => toggle(page).locator(".blob-figure");
// Browsers log a non-2xx fetch as a "Failed to load resource ... 429|503" console error. The
// 429/503 tests expect exactly that one network line, filter nothing else, and assert at
// most one such line was dropped.
const realErrors = (errors: string[]) => {
  const isNet = (e: string) => /Failed to load resource.*\b(429|503)\b/.test(e);
  expect(errors.filter(isNet).length).toBeLessThanOrEqual(1);
  return errors.filter((e) => !isNet(e));
};

async function setup(page: Page) {
  await stubBotId(page);
  const api = await blockRealApis(page);
  const errors = collectConsoleErrors(page);
  return {
    api,
    errors,
    go: async () => {
      await page.goto("/dev/blob/");
      await expect(page.locator("blob-agent:defined")).toHaveCount(1);
    },
  };
}

async function ask(page: Page, text: string) {
  if (!(await panel(page).isVisible())) await toggle(page).click();
  await input(page).fill(text);
  await input(page).press("Enter");
}

test("a chip sends its exact text and renders the reply", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  const chat = await mockChat(page, { events: FIXTURES.happy });
  await go();
  const chip = COPY.chips[1]!;
  await page.getByRole("button", { name: chip }).click();
  await expect(panel(page)).toBeVisible();
  await expect(lastReply(page)).toContainText(
    "Hi! I'm Blob. Ask me about Anderson.",
  );
  expect(chat.requests).toHaveLength(1);
  const body = chat.requests[0] as Body;
  expect(body.messages).toEqual([{ role: "user", content: chip }]);
  expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  await expect(log(page).locator('[data-role="user"]')).toHaveText(chip);
  await expect(log(page)).toHaveAttribute("aria-busy", "false");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("streams: partial text shows before the end", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  await mockChatStream(
    page,
    [
      frame({ event: "mood", data: { mood: "curious" } }) +
        frame({ event: "delta", data: { text: "First part arrives. " } }),
      frame({ event: "delta", data: { text: "Second part lands." } }),
      frame({ event: "done", data: { usageBucket: "ok" } }),
    ],
    1500,
  );
  await go();
  await ask(page, "Stream please");
  await expect(lastReply(page)).toContainText("First part arrives.");
  await expect(lastReply(page)).not.toContainText("Second part lands.");
  await expect(log(page)).toHaveAttribute("aria-busy", "true");
  await expect(avatar(page)).toHaveAttribute("data-talking", "true");
  await expect(page.locator(".ba-send")).toBeDisabled();
  await expect(lastReply(page)).toContainText(
    "First part arrives. Second part lands.",
  );
  await expect(log(page)).toHaveAttribute("aria-busy", "false");
  await expect(avatar(page)).toHaveAttribute("data-talking", "false");
  await expect(page.locator(".ba-send")).toBeEnabled();
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("the model's mood drives data-mood and the emoji badge", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.excited });
  await go();
  await ask(page, "Tell me about a project");
  await expect(lastReply(page)).toContainText("Ooh, fun project!");
  await expect(avatar(page)).toHaveAttribute("data-mood", "excited");
  await expect(hero(page)).toHaveAttribute("data-mood", "excited");
  const badge = lastReply(page).locator(".ba-badge");
  await expect(badge).toHaveText(MOOD_EMOJI.excited!);
  await expect(badge).toHaveAttribute("aria-hidden", "true");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("rate_limited (429) shows its copy and the error mood", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { status: 429, code: "rate_limited" });
  await go();
  await ask(page, "Hello?");
  await expect(lastReply(page)).toContainText(COPY.errors.rate_limited.text);
  await expect(avatar(page)).toHaveAttribute("data-mood", "error");
  await expect(avatar(page)).toHaveAttribute("data-mood", "idle");
  expect(api.blocked).toEqual([]);
  expect(realErrors(errors())).toEqual([]);
});

test("budget (503) shows the napping copy with a contact link", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { status: 503, code: "budget" });
  await go();
  await ask(page, "Hello?");
  await expect(lastReply(page)).toContainText(COPY.errors.budget.text);
  await expect(avatar(page)).toHaveAttribute("data-mood", "error");
  const link = lastReply(page).getByRole("link");
  await expect(link).toHaveAttribute("href", "#contact");
  // Same-page links inside the panel close it.
  await link.click();
  await expect(panel(page)).toBeHidden();
  expect(api.blocked).toEqual([]);
  expect(realErrors(errors())).toEqual([]);
});

test("budget as an SSE error mid-stream replaces the partial text", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, {
    events: [
      { event: "mood", data: { mood: "happy" } },
      { event: "delta", data: { text: "Partial answer" } },
      { event: "error", data: { code: "budget" } },
    ],
  });
  await go();
  await ask(page, "Hello?");
  await expect(lastReply(page)).toContainText(COPY.errors.budget.text);
  await expect(lastReply(page)).not.toContainText("Partial answer");
  await expect(avatar(page)).toHaveAttribute("data-mood", "error");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("a done with no text shows the generic error, not an empty bubble", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, {
    events: [
      { event: "mood", data: { mood: "happy" } },
      { event: "delta", data: { text: "   " } },
      { event: "done", data: { usageBucket: "ok" } },
    ],
  });
  await go();
  await ask(page, "Hello?");
  await expect(replies(page)).toHaveCount(1);
  await expect(lastReply(page)).toContainText(COPY.errors.upstream.text);
  await expect(avatar(page)).toHaveAttribute("data-mood", "error");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("a reset shows only the post-reset text", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.reset });
  await go();
  await ask(page, "Say something");
  await expect(lastReply(page)).toContainText("Let's try that again.");
  await expect(log(page)).not.toContainText("Draft text");
  await expect(avatar(page)).toHaveAttribute("data-mood", "curious");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("replies render only allowlisted links", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, {
    events: [
      ...FIXTURES.links.slice(0, -1),
      {
        event: "delta",
        data: {
          text:
            " [evil](https://evil.example/x) [js](javascript:alert(1))" +
            " <a href=https://evil.example>raw</a>" +
            " [gh](https://github.com/avanegas95)",
        },
      },
      ...FIXTURES.links.slice(-1),
    ],
  });
  await go();
  await ask(page, "Links?");
  await expect(lastReply(page)).toContainText("gh");
  const hrefs = await lastReply(page)
    .locator("a")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual([
    "#projects",
    "#contact",
    "https://github.com/avanegas95",
  ]);
  await expect(lastReply(page)).not.toContainText("evil.example/x");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("keyboard-only flow: Tab to Blob, open, ask, read, Esc", async ({
  page,
  browserName,
}) => {
  test.skip(noTabWebkit(browserName), NO_TAB_REASON);
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.happy });
  await go();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await toggle(page).evaluate((el) => el === document.activeElement)) {
      break;
    }
  }
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("What does he do?");
  await page.keyboard.press("Enter");
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("clear chat empties the log and starts a new session", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  const chat = await mockChat(page, { events: FIXTURES.happy });
  await go();
  await ask(page, "First question");
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  await ask(page, "Second question");
  await expect(replies(page)).toHaveCount(2);
  await expect(log(page)).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => chat.requests.length).toBe(2);
  const second = chat.requests[1] as Body;
  expect(second.messages.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "user",
  ]);

  await page.getByRole("button", { name: COPY.clear }).click();
  await expect(log(page).locator(".ba-msg")).toHaveCount(0);
  await expect(input(page)).toBeFocused();
  await expect(avatar(page)).toHaveAttribute("data-mood", "idle");

  await ask(page, "Fresh start");
  await expect(replies(page)).toHaveCount(1);
  await expect.poll(() => chat.requests.length).toBe(3);
  const third = chat.requests[2] as Body;
  expect(third.messages).toEqual([{ role: "user", content: "Fresh start" }]);
  expect(third.sessionId).not.toBe(second.sessionId);
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("axe clean with a reply and an error in the log", async ({ page }) => {
  const { api, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.links });
  await go();
  await ask(page, "Links?");
  await expect(lastReply(page).locator("a")).toHaveCount(2);
  // The newest route wins, so the next request gets the budget error.
  await mockChat(page, { status: 503, code: "budget" });
  await input(page).fill("Again?");
  await input(page).press("Enter");
  await expect(lastReply(page)).toContainText(COPY.errors.budget.text);
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(api.blocked).toEqual([]);
});
