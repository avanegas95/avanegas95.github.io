import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/guard";

const kb = readFileSync("src/content/knowledge/contact.md", "utf8");
const field = (key: string): string =>
  new RegExp(`^\\s*${key}:\\s*"([^"]+)"`, "m").exec(kb)?.[1] ?? "";
const email = field("email");
const location = field("location");

// Every Formspree request is routed here; the real endpoint is never contacted.
const FORMSPREE = "https://formspree.io/**";

async function fill(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .locator("#contact-form")
    .getByLabel("Name", { exact: true })
    .fill("Test Person");
  await page
    .locator("#contact-form")
    .getByLabel("Email", { exact: true })
    .fill("test@example.com");
  await page
    .locator("#contact-form")
    .getByLabel("Message", { exact: true })
    .fill("Hello there");
}

test.describe("contact", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("success: shows the thank-you message and resets the form", async ({
    page,
  }) => {
    const hits: string[] = [];
    await page.route(FORMSPREE, (route) => {
      hits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await fill(page);
    await page
      .locator("#contact-form")
      .getByRole("button", { name: "Send" })
      .click();
    await expect(page.locator("#form-message")).toBeVisible();
    await expect(page.locator("#form-message")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(page.locator("#form-error")).toBeHidden();
    expect(hits).toHaveLength(1);
    const allEmpty = await page
      .locator("#contact-form")
      .evaluate((f: HTMLFormElement) =>
        [...new FormData(f).values()].every((v) => v === ""),
      );
    expect(allEmpty).toBe(true);
  });

  test("error: shows the error message and keeps the input", async ({
    page,
  }) => {
    await page.route(FORMSPREE, (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await fill(page);
    await page
      .locator("#contact-form")
      .getByRole("button", { name: "Send" })
      .click();
    await expect(page.locator("#form-error")).toBeVisible();
    await expect(page.locator("#form-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#form-message")).toBeHidden();
    await expect(
      page.locator("#contact-form").getByLabel("Message", { exact: true }),
    ).toHaveValue("Hello there");
    await expect(
      page.locator("#contact-form").getByLabel("Email", { exact: true }),
    ).toHaveValue("test@example.com");
  });

  test("an unrouted submit is aborted by the guard, never sent", async ({
    page,
    guard,
  }) => {
    await fill(page);
    await page
      .locator("#contact-form")
      .getByRole("button", { name: "Send" })
      .click();
    await expect(page.locator("#form-error")).toBeVisible();
    expect(guard.external.some((u) => u.includes("formspree.io"))).toBe(true);
  });

  test("direct links and location come from the KB", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#contact");
    expect(email).not.toBe("");
    expect(location).not.toBe("");
    await expect(section.locator('a[href^="mailto:"]')).toHaveAttribute(
      "href",
      `mailto:${email}`,
    );
    await expect(section.locator('a[href*="linkedin.com"]')).toHaveAttribute(
      "href",
      field("linkedin"),
    );
    await expect(section.locator("#contact-location")).toHaveText(
      `Location: ${location}`,
    );
    await expect(section).not.toContainText("Boston, MA");
  });

  test("submit button is opaque with a visible focus ring; axe is clean", async ({
    page,
  }) => {
    await page.goto("/");
    const btn = page
      .locator("#contact-form")
      .getByRole("button", { name: "Send" });
    await btn.scrollIntoViewIfNeeded();
    await expect(btn).toHaveCSS("opacity", "1");
    await btn.focus();
    await expect(btn).toHaveCSS("outline-style", "solid");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .include("#contact")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
