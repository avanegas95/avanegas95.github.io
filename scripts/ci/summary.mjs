/* global process, console */
// Appends a Lighthouse score table (median of the runs per URL) to the GitHub step summary.
// Reads the `*.report.json` files that `lhci autorun` writes to reports/lhci/.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "reports/lhci";
const out = process.env["GITHUB_STEP_SUMMARY"];
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const lines = [
  "## Lighthouse",
  "",
  "| URL | Perf | A11y | BP | SEO |",
  "|---|---|---|---|---|",
];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const byUrl = new Map();
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((n) => /\.report\.json$/.test(n))) {
    const lhr = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const runs = byUrl.get(lhr.finalUrl) ?? [];
    runs.push(lhr);
    byUrl.set(lhr.finalUrl, runs);
  }
}

if (byUrl.size === 0) {
  lines.push("| no Lighthouse results | | | | |");
} else {
  for (const [url, runs] of [...byUrl].sort()) {
    const s = (k) =>
      Math.round(median(runs.map((r) => r.categories[k]?.score ?? 0)) * 100);
    lines.push(`| ${url} | ${CATEGORIES.map(s).join(" | ")} |`);
  }
}

const text = lines.join("\n") + "\n";
if (out) appendFileSync(out, text);
else console.log(text);
