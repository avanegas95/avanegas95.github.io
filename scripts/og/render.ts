// Renders scripts/og/template.html to the 1200x630 social preview PNG.
// Run: npm run og:render (needs `npx playwright install chromium` once).
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const OUT = here("../../public/images/og.image.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(new URL("./template.html", import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: "png" });
} finally {
  await browser.close();
}
console.log(`wrote ${OUT}`);
