// Main chat E2E (SCOPE §7): /api/chat is always mocked; no real API is ever reached.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { COPY } from "../../src/scripts/blob/copy";
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
  type SseFixture,
} from "./fixtures/chat";

type Body = {
  messages: { role: string; content: string }[];
  sessionId: string;
};

const EMOJI = /\p{Extended_Pictographic}/u;

const input = (page: Page) => page.getByLabel("Your question for Blob");
const bubble = (page: Page) => page.locator('[data-ba="bubble"]');
const answer = (page: Page) => page.locator('[data-ba="answer"]');
const clip = (page: Page) => page.locator('[data-ba="clip"]');
const question = (page: Page) => page.locator('[data-ba="question"]');
// The reply shown in the bubble (earlier ones live in the Previous list).
const lastReply = (page: Page) => clip(page).locator(":scope > .ba-msg");
const hero = (page: Page) => page.locator('[data-ba="figure"] .blob-figure');
const more = (page: Page) => page.locator('[data-ba="more"]');
const previous = (page: Page) => page.locator('[data-ba="previous"]');
const history = (page: Page) => page.locator('[data-ba="history"] > li');
// Browsers log a non-2xx fetch as a "Failed to load resource ... 429|503" console error. The
// 429/503 tests expect exactly that one network line, filter nothing else, and assert at
// most one such line was dropped.
const realErrors = (errors: string[]) => {
  const isNet = (e: string) => /Failed to load resource.*\b(429|503)\b/.test(e);
  expect(errors.filter(isNet).length).toBeLessThanOrEqual(1);
  return errors.filter((e) => !isNet(e));
};

// About 300 words in five paragraphs, delivered as ordinary deltas.
const PARAGRAPH =
  "Anderson builds test automation that teams actually trust, from the first flaky " +
  "selector to the last green pipeline, and he writes down what he learns along the " +
  "way so the next person starts further ahead. He likes small, honest tests, fast " +
  "feedback and dashboards that tell the truth even when the news is not good.";
const LONG: SseFixture = [
  { event: "mood", data: { mood: "proud" } },
  ...Array.from({ length: 5 }, (_, i) => ({
    event: "delta" as const,
    data: { text: `${i > 0 ? "\n\n" : ""}${PARAGRAPH} (${i + 1})` },
  })),
  { event: "done", data: { usageBucket: "ok" } },
];

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
  await input(page).fill(text);
  await input(page).press("Enter");
}

test("a chip streams the fixture reply into the bubble", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  const chat = await mockChat(page, { events: FIXTURES.happy });
  await go();
  const chip = COPY.chips[1]!;
  await page.getByRole("button", { name: chip }).click();
  await expect(lastReply(page)).toContainText(
    "Hi! I'm Blob. Ask me about Anderson.",
  );
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  expect(chat.requests).toHaveLength(1);
  const body = chat.requests[0] as Body;
  expect(body.messages).toEqual([{ role: "user", content: chip }]);
  expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  await expect(question(page)).toHaveText(chip);
  await expect(answer(page)).toHaveAttribute("aria-busy", "false");
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
  await expect(bubble(page)).toHaveAttribute("data-phase", "streaming");
  await expect(answer(page)).toHaveAttribute("aria-busy", "true");
  await expect(hero(page)).toHaveAttribute("data-talking", "true");
  await expect(page.locator(".ba-send")).toBeDisabled();
  await expect(lastReply(page)).toContainText(
    "First part arrives. Second part lands.",
  );
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  await expect(answer(page)).toHaveAttribute("aria-busy", "false");
  await expect(hero(page)).toHaveAttribute("data-talking", "false");
  await expect(page.locator(".ba-send")).toBeEnabled();
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("the model's mood drives data-mood, and no emoji is rendered anywhere", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.excited });
  await go();
  await ask(page, "Tell me about a project");
  await expect(lastReply(page)).toContainText("Ooh, fun project!");
  await expect(hero(page)).toHaveAttribute("data-mood", "excited");
  await expect(page.locator(".ba-badge, .blob-emoji")).toHaveCount(0);
  const text = await page.locator("blob-agent").innerText();
  expect(text).not.toMatch(EMOJI);
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
  await expect(bubble(page)).toHaveAttribute("data-phase", "error");
  await expect(hero(page)).toHaveAttribute("data-mood", "error");
  await expect(hero(page)).toHaveAttribute("data-mood", "idle");
  expect(api.blocked).toEqual([]);
  expect(realErrors(errors())).toEqual([]);
});

test("budget (503) shows the napping copy, no emoji, with a contact link", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { status: 503, code: "budget" });
  await go();
  await ask(page, "Hello?");
  await expect(lastReply(page)).toContainText(COPY.errors.budget.text);
  expect(await lastReply(page).innerText()).not.toMatch(EMOJI);
  await expect(hero(page)).toHaveAttribute("data-mood", "error");
  const link = lastReply(page).getByRole("link");
  await expect(link).toHaveAttribute("href", "#contact");
  await link.click();
  await expect(page).toHaveURL(/#contact$/);
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
  await expect(hero(page)).toHaveAttribute("data-mood", "error");
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
  await expect(lastReply(page)).toHaveCount(1);
  await expect(lastReply(page)).toContainText(COPY.errors.upstream.text);
  await expect(hero(page)).toHaveAttribute("data-mood", "error");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("a reset shows only the post-reset text", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.reset });
  await go();
  await ask(page, "Say something");
  await expect(lastReply(page)).toContainText("Let's try that again.");
  await expect(bubble(page)).not.toContainText("Draft text");
  await expect(hero(page)).toHaveAttribute("data-mood", "curious");
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

test("a long reply is clamped with Show more, and nothing scrolls", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: LONG });
  await go();
  await ask(page, "Tell me everything");
  await expect(lastReply(page)).toContainText("(5)");
  await expect(more(page)).toBeVisible();
  await expect(more(page)).toHaveText(COPY.showMore);
  await expect(more(page)).toHaveAttribute("aria-expanded", "false");

  // No scroll container anywhere around the answer.
  const metrics = await bubble(page).evaluate((el) => {
    const scrollable: string[] = [];
    // The page's own body/html scrolling is fine; a container inside it is not.
    for (
      let n: Element | null = el;
      n && n !== document.body;
      n = n.parentElement
    ) {
      const o = getComputedStyle(n);
      if (/(auto|scroll)/.test(o.overflowY + o.overflowX)) {
        scrollable.push(n.tagName.toLowerCase());
      }
    }
    return {
      scrollable,
      same: el.scrollHeight === el.clientHeight,
    };
  });
  expect(metrics.same).toBe(true);
  expect(metrics.scrollable).toEqual([]);

  const clamped = (await clip(page).boundingBox())!.height;
  const cap = await page.evaluate(
    () => Math.min(window.innerHeight * 0.6, 28 * 16) + 1,
  );
  expect(clamped).toBeLessThanOrEqual(cap);

  await more(page).click();
  await expect(more(page)).toHaveAttribute("aria-expanded", "true");
  await expect(more(page)).toHaveText(COPY.showLess);
  expect((await clip(page).boundingBox())!.height).toBeGreaterThan(clamped);
  expect(
    await bubble(page).evaluate((el) => el.scrollHeight === el.clientHeight),
  ).toBe(true);
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("Previous reveals turn 1 after turn 2", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.happy });
  await go();
  await ask(page, "First question");
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  await expect(page.locator('[data-ba="previous-wrap"]')).toBeHidden();
  await mockChat(page, { events: FIXTURES.excited });
  await ask(page, "Second question");
  await expect(lastReply(page)).toContainText("Ooh, fun project!");

  await expect(previous(page)).toBeVisible();
  await expect(previous(page)).toHaveAttribute("aria-expanded", "false");
  await expect(history(page)).toHaveCount(1);
  await expect(history(page).first()).toBeHidden();
  await previous(page).click();
  await expect(previous(page)).toHaveAttribute("aria-expanded", "true");
  await expect(history(page).first()).toBeVisible();
  await expect(history(page).first()).toContainText("First question");
  await expect(history(page).first()).toContainText("Ask me about Anderson.");
  // The latest answer is still the bubble's.
  await expect(question(page)).toHaveText("Second question");
  await previous(page).click();
  await expect(history(page).first()).toBeHidden();
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("keyboard-only flow: Tab to the input, ask, read, Esc returns to the input", async ({
  page,
  browserName,
}) => {
  test.skip(noTabWebkit(browserName), NO_TAB_REASON);
  const { api, errors, go } = await setup(page);
  await mockChat(page, { events: FIXTURES.happy });
  await go();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await input(page).evaluate((el) => el === document.activeElement)) {
      break;
    }
  }
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("What does he do?");
  await page.keyboard.press("Enter");
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  await expect(input(page)).toBeFocused();
  // Move focus away, then Esc brings it back to the input; nothing else changes.
  await page.getByRole("button", { name: COPY.clear }).focus();
  await page.keyboard.press("Escape");
  await expect(input(page)).toBeFocused();
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("Esc does not stop a running stream", async ({ page }) => {
  const { api, errors, go } = await setup(page);
  await mockChatStream(
    page,
    [
      frame({ event: "mood", data: { mood: "happy" } }) +
        frame({ event: "delta", data: { text: "Part one. " } }),
      frame({ event: "delta", data: { text: "Part two." } }),
      frame({ event: "done", data: { usageBucket: "ok" } }),
    ],
    800,
  );
  await go();
  await ask(page, "Keep going");
  await expect(lastReply(page)).toContainText("Part one.");
  await page.keyboard.press("Escape");
  await expect(input(page)).toBeFocused();
  await expect(lastReply(page)).toContainText("Part one. Part two.");
  await expect(bubble(page)).toHaveAttribute("data-phase", "done");
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test("clear chat empties the bubble and starts a new session", async ({
  page,
}) => {
  const { api, errors, go } = await setup(page);
  const chat = await mockChat(page, { events: FIXTURES.happy });
  await go();
  await ask(page, "First question");
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  await ask(page, "Second question");
  await expect(history(page)).toHaveCount(1);
  await expect(answer(page)).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => chat.requests.length).toBe(2);
  const second = chat.requests[1] as Body;
  expect(second.messages.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "user",
  ]);

  await page.getByRole("button", { name: COPY.clear }).click();
  await expect(page.locator("blob-agent .ba-msg")).toHaveCount(0);
  await expect(bubble(page)).toHaveAttribute("data-phase", "idle");
  await expect(bubble(page)).toContainText(COPY.greeting);
  await expect(bubble(page).locator(".ba-chip").first()).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(hero(page)).toHaveAttribute("data-mood", "idle");

  await ask(page, "Fresh start");
  await expect(lastReply(page)).toContainText("Ask me about Anderson.");
  await expect(history(page)).toHaveCount(0);
  await expect.poll(() => chat.requests.length).toBe(3);
  const third = chat.requests[2] as Body;
  expect(third.messages).toEqual([{ role: "user", content: "Fresh start" }]);
  expect(third.sessionId).not.toBe(second.sessionId);
  expect(api.blocked).toEqual([]);
  expect(errors()).toEqual([]);
});

test.describe("axe", () => {
  // The bubble pop is a fade-in: emulate reduced motion so axe never samples a half-faded colour.
  test.use({ reducedMotion: "reduce" });

  test("clean after a reply, with Previous open and a long clamped answer", async ({
    page,
  }) => {
    const { api, go } = await setup(page);
    await mockChat(page, { events: FIXTURES.links });
    await go();
    await ask(page, "Links?");
    await expect(lastReply(page).locator("a")).toHaveCount(2);
    await mockChat(page, { events: LONG });
    await ask(page, "And more?");
    await expect(lastReply(page)).toContainText("(5)");
    await expect(more(page)).toBeVisible();
    await previous(page).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    expect(api.blocked).toEqual([]);
  });

  test("clean with an error in the bubble", async ({ page }) => {
    const { api, go } = await setup(page);
    await mockChat(page, { status: 503, code: "budget" });
    await go();
    await ask(page, "Hello?");
    await expect(lastReply(page)).toContainText(COPY.errors.budget.text);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    expect(api.blocked).toEqual([]);
  });
});
