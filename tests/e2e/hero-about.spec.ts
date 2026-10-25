import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { KB_ROOT, loadKbSources, parseKbSource } from "../../src/lib/kb.ts";
import { expect, test } from "./fixtures/guard";

// The KB is the expected value (CLAUDE.md rule 1): the hero and About must show exactly what
// bio.md says, and bio.md must still hold the text the site showed before P5.5-04.
function kb(file: string): Record<string, unknown> {
  const src = loadKbSources(KB_ROOT).find((s) => s.path === file);
  if (!src) throw new Error(`${file} not found`);
  return parseKbSource(src).data as unknown as Record<string, unknown>;
}
const bio = kb("bio.md") as unknown as {
  greeting: string;
  name: string;
  headline: string;
  lede: string;
  about: string[];
  tools: string[][];
};
const skills = kb("skills.md") as unknown as {
  groups: { items: string[] }[];
};
const skillItems = new Set(skills.groups.flatMap((g) => g.items));

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

test("hero shows the bio.md greeting, name, headline and lede", async ({
  page,
}) => {
  await page.goto("/");
  const intro = page.locator("#home .home-intro");
  await expect(intro.locator("p").first()).toHaveText(bio.greeting);
  await expect(page.locator("h1")).toHaveText(bio.name);
  await expect(intro.locator("h2")).toHaveText(bio.headline);
  expect(squash((await intro.locator("p").last().textContent()) ?? "")).toBe(
    bio.lede,
  );
});

test("About shows the bio.md paragraphs and tool list", async ({ page }) => {
  await page.goto("/");
  const about = page.locator("#about");
  const paras = about.locator("p");
  await expect(paras).toHaveCount(bio.about.length);
  for (const [i, text] of bio.about.entries()) {
    await expect(paras.nth(i)).toHaveText(text);
  }
  const items = (await about.locator("ul > li").allTextContents()).map((t) =>
    squash(t.replace("▹", "")),
  );
  expect(items).toEqual(bio.tools.map((row) => row.join(" / ")));
  for (const tool of bio.tools.flat()) expect(skillItems).toContain(tool);
});

test("built hero and About text is unchanged from before the move to the KB", async ({
  page,
}) => {
  await page.goto("/");
  const text = await page.evaluate(() =>
    ["#home .home-intro", "#about h2", "#about p", "#about ul"]
      .map((sel) =>
        [...document.querySelectorAll(sel)]
          .map((e) => e.textContent)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .join("\n"),
  );
  // Captured from the built site at origin/feat/blob before this task. Two tool-list changes were
  // decided by Anderson (docs/PLAN.md decision log, 2026-10-24): "Linux" is dropped, and the
  // tools now come from skills.md, which spells it "TestRail". Anderson also fixed his
  // "is makes" typo in bio.md (89dcf53). Nothing else may differ.
  const before = readFileSync(
    "tests/fixtures/site/hero-about-before.txt",
    "utf8",
  )
    .replace("Linux / Bash / Windows", "Bash / Windows")
    .replace("TestRails", "TestRail")
    .replace("software that is makes sense", "software that makes sense");
  expect(text + "\n").toBe(before);
});

for (const width of [390, 1280]) {
  test(`h1 is at least 1.5x the tagline at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const size = (sel: string) =>
      page
        .locator(sel)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const h1 = await size("#home h1");
    const h2 = await size("#home .home-intro h2");
    expect(h1 / h2).toBeGreaterThanOrEqual(1.5);
  });
}

test("at 390px the lede ends within the first viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const box = await page.locator("#home .home-intro p").last().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
});

test("hero and About have no axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .include("#home")
    .include("#about")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
