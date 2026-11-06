import { expect, test } from "./fixtures/guard";

test("/api/chat is intercepted with a fixture, never the real endpoint", async ({
  page,
  guard,
}) => {
  await page.goto("/");
  const status = await page.evaluate(
    async () =>
      (await fetch("/api/chat", { method: "POST", body: "{}" })).status,
  );
  expect(status).toBe(503);
  expect(guard.chat).toHaveLength(1);
});

// test.fail(): the guard MUST fail this test (its teardown finds the recorded request). If the
// guard stops recording, the test body passes and test.fail() turns that into a failure.
test.fail(
  "the guard fails any test that reaches api.anthropic.com",
  async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() =>
      fetch("https://api.anthropic.com/v1/messages", { method: "POST" }).catch(
        () => undefined,
      ),
    );
  },
);
