import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURES,
  blockRealApis,
  collectConsoleErrors,
  mockChat,
  mockChatStream,
  sse,
  stubBotId,
} from "./fixtures/chat";

const post = (page: Page) =>
  page.evaluate(async () => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    return {
      status: res.status,
      type: res.headers.get("content-type"),
      text: await res.text(),
    };
  });

test("SSE fixture arrives through BotID's patched fetch", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await blockRealApis(page);
  await stubBotId(page);
  const chat = await mockChat(page, { events: FIXTURES.happy });
  let humanHeader: string | undefined;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/chat")) humanHeader = r.headers()["x-is-human"];
  });
  await page.goto("/dev/blob/");
  const res = await post(page);
  expect(res.status).toBe(200);
  expect(res.type).toContain("text/event-stream");
  expect(res.text).toBe(sse(FIXTURES.happy));
  expect(chat.requests).toHaveLength(1);
  // The header proves the request went through BotID's wrapper and the stub challenge.
  expect(JSON.parse(humanHeader ?? "null")).toEqual({ b: 1, d: 0 });
  expect(errors()).toEqual([]);
});

test("error mock returns the status and JSON body", async ({ page }) => {
  await stubBotId(page);
  await mockChat(page, { status: 429, code: "rate_limited" });
  await page.goto("/dev/blob/");
  const res = await post(page);
  expect(res.status).toBe(429);
  expect(res.type).toContain("application/json");
  expect(JSON.parse(res.text)).toEqual({ error: { code: "rate_limited" } });
});

test("blockRealApis records no requests on a normal page load", async ({
  page,
}) => {
  const api = await blockRealApis(page);
  await stubBotId(page);
  await mockChat(page, { events: FIXTURES.happy });
  await page.goto("/dev/blob/");
  await post(page);
  expect(api.blocked).toEqual([]);
});

test("blockRealApis aborts and records a real API call", async ({ page }) => {
  const api = await blockRealApis(page);
  await page.goto("/dev/blob/");
  const failed = await page.evaluate(() =>
    fetch("https://api.anthropic.com/v1/messages").then(
      () => false,
      () => true,
    ),
  );
  expect(failed).toBe(true);
  expect(api.blocked).toEqual(["https://api.anthropic.com/v1/messages"]);
});

test("mockChatStream delivers the first chunk before the last", async ({
  page,
}) => {
  await stubBotId(page);
  await mockChatStream(
    page,
    [
      'event: delta\ndata: {"text":"a"}\n\n',
      'event: delta\ndata: {"text":"b"}\n\n',
      'event: done\ndata: {"usageBucket":"ok"}\n\n',
    ],
    300,
  );
  await page.goto("/dev/blob/");
  const times = await page.evaluate(async () => {
    const res = await fetch("/api/chat", { method: "POST", body: "{}" });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const t0 = performance.now();
    const seen: number[] = [];
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      seen.push(performance.now() - t0);
    }
    return seen;
  });
  expect(times).toHaveLength(3);
  expect((times.at(-1) ?? 0) - (times[0] ?? 0)).toBeGreaterThan(300);
});
