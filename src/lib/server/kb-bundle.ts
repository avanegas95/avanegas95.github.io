// Vite-only (import.meta.glob): bundles the KB into the function, which has no
// `src/` on disk at runtime. Parity with loadKbSources() is unit-tested.
import { buildKb, type KbSource } from "../kb.ts";
import { buildSystemPrompt } from "../prompt.ts";

const RAW = import.meta.glob<string>(
  ["/src/content/knowledge/*.md", "/src/content/knowledge/projects/*.md"],
  { query: "?raw", import: "default", eager: true },
);

const PREFIX = "/src/content/knowledge/";

// Same filter and order as loadKbSources(): skip `_`-prefixed names, sort by path.
export function sourcesFromGlob(modules: Record<string, string>): KbSource[] {
  const out: KbSource[] = [];
  for (const [key, raw] of Object.entries(modules)) {
    const path = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name.startsWith("_") || !name.endsWith(".md")) continue;
    out.push({ path, raw });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function bundledKbSources(): KbSource[] {
  return sourcesFromGlob(RAW);
}

let cached: string | undefined;

export function getSystemPrompt(): string {
  cached ??= buildSystemPrompt(buildKb(bundledKbSources()));
  return cached;
}
