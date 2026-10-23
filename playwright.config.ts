import { defineConfig, devices } from "@playwright/test";

// PW_PORT overrides the web server port (default 4321) so parallel runs never collide.
// An already-running server is only reused when PW_REUSE=1 (never in CI); otherwise Playwright
// fails loudly if the port is busy instead of silently testing a stray server.
const PORT = Number(process.env["PW_PORT"] ?? 4321);

// The Vercel adapter does not support `astro preview`, so E2E serves the static half of the
// built site (`.vercel/output/static`) with `serve`. Run `npm run build` first. On-demand
// functions such as /api/health are not served here; tests intercept /api/* with fixtures.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx serve .vercel/output/static -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"] && process.env["PW_REUSE"] === "1",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
