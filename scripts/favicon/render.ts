// Renders public/favicon.svg to the PNG fallbacks and favicon.ico.
// Run: npm run favicon:render (needs `npx playwright install chromium` once).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const PUBLIC = here("../../public/");
const svg = readFileSync(`${PUBLIC}favicon.svg`, "utf8");
// iOS rounds the touch icon itself, so it gets a full-bleed square.
const squareSvg = svg.replace(' rx="14"', "");

// ICO container with embedded PNG images (supported since Vista).
function buildIco(pngs: Buffer[], sizes: number[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((png, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] ?? 0, 0);
    e.writeUInt8(sizes[i] ?? 0, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

const browser = await chromium.launch();
try {
  const render = async (source: string, size: number): Promise<Buffer> => {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const markup = source.replace(
      'width="64" height="64"',
      `width="${size}" height="${size}"`,
    );
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`,
    );
    const png = await page.screenshot({ type: "png", omitBackground: true });
    await page.close();
    return png;
  };

  const png16 = await render(svg, 16);
  const png32 = await render(svg, 32);
  const png180 = await render(squareSvg, 180);
  writeFileSync(`${PUBLIC}favicon-32.png`, png32);
  writeFileSync(`${PUBLIC}apple-touch-icon.png`, png180);
  writeFileSync(`${PUBLIC}favicon.ico`, buildIco([png16, png32], [16, 32]));
} finally {
  await browser.close();
}
console.log(`wrote favicon assets to ${PUBLIC}`);
