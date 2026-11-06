// Shared Playwright `test` for the CI-gate specs (CLAUDE.md rule 5): the real Anthropic API is
// never reachable from E2E. Every context aborts requests to api.anthropic.com and records them;
// /api/chat is answered with a fixture; the test fails in teardown if anything tried to leave.
import { expect, test as base } from "@playwright/test";
import { stubBotId } from "./chat";

export interface Guard {
  /** Requests that tried to reach api.anthropic.com. Must stay empty. */
  anthropic: string[];
  /** Other third-party requests that were aborted (informational). */
  external: string[];
  /** Requests that hit the intercepted /api/chat. */
  chat: string[];
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context, baseURL }, use) => {
      const guard: Guard = { anthropic: [], chat: [], external: [] };
      // Context routes run last-registered-first; this one only sees non-chat traffic. Anything
      // outside the site origin is aborted (CI never depends on third parties) and recorded.
      await context.route(
        (url) =>
          /^https?:$/.test(url.protocol) &&
          url.origin !== new URL(baseURL ?? "http://localhost").origin,
        (route) => {
          const url = route.request().url();
          if (/^https?:\/\/([^/]+\.)?anthropic\.com\//.test(url))
            guard.anthropic.push(url);
          else guard.external.push(url);
          return route.abort();
        },
      );
      // Every page that mounts Blob loads the BotID client; `serve` has no challenge script.
      await stubBotId(context);
      await context.route("**/api/chat", (route) => {
        guard.chat.push(route.request().url());
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "intercepted by test" }),
        });
      });
      await use(guard);
      expect(guard.anthropic, "a request reached api.anthropic.com").toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

export { expect };
