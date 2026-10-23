// Reduced-motion and full-motion behaviour of Blob (SCOPE §7). /api/chat is always mocked.
import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  mockChat,
  stubBotId,
} from "./fixtures/chat";

const toggle = (page: Page) =>
  page.getByRole("button", { name: "Chat with Blob" });
const hero = (page: Page) => toggle(page).locator(".blob-figure");
const input = (page: Page) => page.getByLabel("Your question for Blob");

async function setup(page: Page) {
  await stubBotId(page);
  const api = await blockRealApis(page);
  const errors = collectConsoleErrors(page);
  await page.goto("/dev/blob/");
  await expect(page.locator("blob-agent:defined")).toHaveCount(1);
  return { api, errors };
}

async function ask(page: Page, text: string) {
  await toggle(page).click();
  await input(page).fill(text);
  await input(page).press("Enter");
}

// Names of animations and transitions that are running on elements inside blob-agent.
const runningInSlot = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target;
        return a.playState === "running" && !!t?.closest("blob-agent");
      })
      .map((a) =>
        a instanceof CSSAnimation
          ? a.animationName
          : a instanceof CSSTransition
            ? a.transitionProperty
            : "animation",
      ),
  );

const eyeX = (page: Page) =>
  hero(page).evaluate((el) => el.style.getPropertyValue("--eye-x"));

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no animation runs under blob-agent, idle or after an excited reply", async ({
    page,
  }) => {
    const { api, errors } = await setup(page);
    await mockChat(page, { events: FIXTURES.excited });
    expect(await runningInSlot(page)).toEqual([]);
    await ask(page, "Tell me about a project");
    await expect(
      page.locator('[data-ba="log"] [data-role="assistant"]').last(),
    ).toContainText("Ooh, fun project!");
    // excited normally bounces and the emoji normally floats; neither may run.
    expect(await runningInSlot(page)).toEqual([]);
    expect(api.blocked).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test("eyes do not follow the pointer", async ({ page }) => {
    await setup(page);
    const box = (await hero(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 200, box.y - 10, {
      steps: 5,
    });
    await page.waitForTimeout(200);
    expect(["", "0"]).toContain(await eyeX(page));
  });

  test("a mood fixture still sets data-mood", async ({ page }) => {
    await setup(page);
    await mockChat(page, { events: FIXTURES.excited });
    await ask(page, "Hello");
    await expect(hero(page)).toHaveAttribute("data-mood", "excited");
    expect(await runningInSlot(page)).toEqual([]);
  });
});

test.describe("full motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the breathing wobble animation runs on the hero Blob", async ({
    page,
  }) => {
    await setup(page);
    await expect.poll(() => runningInSlot(page)).toContain("blob-breathe");
  });

  test("blink: data-blink is set periodically", async ({ page }) => {
    await setup(page);
    // Blinks fire every 3 to 7 s and the flag lasts ~140 ms, so observe mutations.
    await page.evaluate(() => {
      const w = window as unknown as { __blinked: boolean };
      w.__blinked = false;
      const fig = document.querySelector(".ba-toggle .blob-figure")!;
      new MutationObserver(() => {
        if (fig.hasAttribute("data-blink")) w.__blinked = true;
      }).observe(fig, { attributes: true, attributeFilter: ["data-blink"] });
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { __blinked: boolean }).__blinked,
          ),
        { timeout: 12_000 },
      )
      .toBe(true);
  });

  test("eyes follow a fine pointer", async ({ page }) => {
    await setup(page);
    // Headless Firefox on some Windows hosts reports (pointer: fine) as false; tracking is
    // then correctly off, so there is nothing to assert. Linux CI reports fine.
    const fine = await page.evaluate(
      () => matchMedia("(pointer: fine)").matches,
    );
    test.skip(!fine, "(pointer: fine) is false in this browser/host");
    const box = (await hero(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, {
      steps: 5,
    });
    await expect.poll(() => eyeX(page)).not.toMatch(/^(|0)$/);
  });
});
