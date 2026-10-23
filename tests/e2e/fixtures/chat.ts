// Shared Playwright helpers for chat E2E: stub BotID's challenge script, mock /api/chat,
// stream SSE incrementally, and guarantee no real third-party API is ever reached
// (CLAUDE.md rules 4 and 5). Product code is untouched: nothing here bypasses BotID in src/.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type {
  ChatEvent,
  ErrorBody,
  ErrorCode,
} from "../../../src/lib/chat-events";

export type SseFixture = ChatEvent[];

const BOTID_C_JS =
  /\/149e9513-01fa-4fb0-aad4-566afd725d1b\/2d206a39-8ed7-437e-a3be-862e0f06eea3\/a-4-a\/c\.js/;
const BOTID_C_BODY = readFileSync(
  new URL("./botid-c.js", import.meta.url),
  "utf8",
);

// Same framing as the server encoder (src/lib/server/sse.ts): `event: <name>\ndata: <JSON>\n\n`.
export function frame(e: ChatEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export function sse(events: SseFixture): string {
  return events.map(frame).join("");
}

// Serves the stand-in challenge script. The page's BotID client then resolves its challenge
// without a network round trip to api.vercel.com. Call before navigating.
export async function stubBotId(page: Page): Promise<void> {
  await page.route(BOTID_C_JS, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: BOTID_C_BODY,
    }),
  );
}

export async function mockChat(
  page: Page,
  r: { events: SseFixture } | { status: number; code: ErrorCode },
  opts: { delayMs?: number } = {},
): Promise<{ requests: unknown[] }> {
  const requests: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    try {
      requests.push(req.postDataJSON());
    } catch {
      requests.push(req.postData());
    }
    if (opts.delayMs) await new Promise((res) => setTimeout(res, opts.delayMs));
    if ("events" in r) {
      return route.fulfill({
        status: 200,
        headers: { "cache-control": "no-store" },
        contentType: "text/event-stream",
        body: sse(r.events),
      });
    }
    const body: ErrorBody = { error: { code: r.code } };
    return route.fulfill({
      status: r.status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { requests };
}

// Incremental delivery. `route.fulfill` buffers the whole body, so streaming tests instead
// install an init script that replaces window.fetch for POST /api/chat with one returning a
// Response over a real ReadableStream that enqueues one chunk every `gapMs`. It is installed
// before any page script, so BotID's patched fetch wraps it (BotID is still exercised, the
// network is not touched) and there is no extra server process or port to manage.
export async function mockChatStream(
  page: Page,
  chunks: string[],
  gapMs: number,
): Promise<void> {
  await page.addInitScript(
    ({ chunks, gapMs }) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        if (url.pathname !== "/api/chat" || method !== "POST")
          return realFetch(input, init);
        const enc = new TextEncoder();
        let i = 0;
        const body = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            if (i >= chunks.length) return controller.close();
            if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
            controller.enqueue(enc.encode(chunks[i++]));
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      };
    },
    { chunks, gapMs },
  );
}

const REAL_API = /(api\.anthropic\.com|api\.vercel\.com|upstash)/i;

// Aborts and records any request to a real third-party API. Returns the recorded URLs.
// (Spec'd as Promise<void>; returning the list is what lets tests assert "0 requests".)
export async function blockRealApis(
  page: Page,
): Promise<{ blocked: string[] }> {
  const blocked: string[] = [];
  await page.route(REAL_API, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  return { blocked };
}

// Returns a getter for console errors and uncaught page errors seen so far.
export function collectConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return () => [...errors];
}

const done = (usageBucket: "ok" | "warm" | "hot" = "ok"): ChatEvent => ({
  event: "done",
  data: { usageBucket },
});

export const FIXTURES: Record<
  "happy" | "excited" | "reset" | "midStreamError" | "links",
  SseFixture
> = {
  happy: [
    { event: "mood", data: { mood: "happy" } },
    { event: "delta", data: { text: "Hi! I'm Blob. " } },
    { event: "delta", data: { text: "Ask me about Anderson." } },
    done(),
  ],
  excited: [
    { event: "mood", data: { mood: "excited" } },
    { event: "delta", data: { text: "Ooh, fun project! " } },
    { event: "delta", data: { text: "Anderson built it for the thrill." } },
    done("warm"),
  ],
  reset: [
    { event: "mood", data: { mood: "happy" } },
    { event: "delta", data: { text: "Draft text that gets scrubbed." } },
    { event: "reset", data: {} },
    { event: "mood", data: { mood: "curious" } },
    { event: "delta", data: { text: "Let's try that again." } },
    done(),
  ],
  midStreamError: [
    { event: "mood", data: { mood: "happy" } },
    { event: "delta", data: { text: "Partial answer, then " } },
    { event: "error", data: { code: "upstream" } },
  ],
  links: [
    { event: "mood", data: { mood: "proud" } },
    {
      event: "delta",
      data: { text: "See the [projects](#projects) or [contact](#contact)." },
    },
    done("hot"),
  ],
};

// Playwright's WebKit on macOS follows Safari's default: Tab moves only between text fields,
// never to buttons or links, so keyboard-Tab specs cannot run there (they run on Linux CI).
export const NO_TAB_REASON =
  "WebKit on macOS does not Tab to buttons or links (Safari default); runs on Linux CI";
export const noTabWebkit = (browserName: string): boolean =>
  browserName === "webkit" && process.platform === "darwin";
