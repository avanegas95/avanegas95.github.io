import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN,
  ISLAND_BUDGET_BYTES,
  evaluate,
  findBlobEntries,
  gzipSize,
  readHtmlFiles,
  readJsFiles,
  reachableGraph,
  scanForbidden,
} from "../../scripts/check-client-bundle.ts";

const ROOT = "tests/fixtures/bundle";
const load = (name: string) => ({
  htmls: readHtmlFiles(`${ROOT}/${name}`),
  files: readJsFiles(`${ROOT}/${name}`),
});

// Deterministic, incompressible filler: gzip size is about `bytes` (no flaky budget tests).
function noise(bytes: number): string {
  const chunks: Buffer[] = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const h = createHash("sha256").update(`seed-${i}`).digest();
    chunks.push(h);
    n += h.length;
  }
  return Buffer.concat(chunks).subarray(0, bytes).toString("base64");
}
// base64 inflates 4/3 but gzip recovers the entropy, so gzip(noise(b)) is about b.
const KB = 1024;

describe("Blob entry detection", () => {
  it("finds the module that defines <blob-agent>, not by file name", () => {
    const { files } = load("clean");
    expect(findBlobEntries(files)).toEqual(["_astro/blob.AAAA1111.js"]);
  });

  it("follows static imports from the entry only", () => {
    const { files } = load("clean");
    expect(reachableGraph(["_astro/blob.AAAA1111.js"], files).sort()).toEqual([
      "_astro/blob.AAAA1111.js",
      "_astro/moods.DDDD4444.js",
    ]);
  });
});

describe("size budget (Blob graph only, React chunks excluded)", () => {
  it("(a) passes: 20 KB Blob graph next to a 60 KB React chunk", () => {
    const { htmls, files } = load("clean");
    files.set(
      "_astro/moods.DDDD4444.js",
      `export const mood="${noise(20 * KB)}";`,
    );
    files.set(
      "_astro/client.EEEE5555.js",
      `export const r="${noise(60 * KB)}";`,
    );
    expect(gzipSize(files.get("_astro/moods.DDDD4444.js") ?? "")).toBeLessThan(
      ISLAND_BUDGET_BYTES,
    );
    const r = evaluate(htmls, files);
    expect(r.problems).toEqual([]);
    expect(r.total).toBeLessThan(ISLAND_BUDGET_BYTES);
  });

  it("(b) fails: Blob graph of 26 KB gzip", () => {
    const { htmls, files } = load("clean");
    files.set(
      "_astro/moods.DDDD4444.js",
      `export const mood="${noise(26 * KB)}";`,
    );
    const r = evaluate(htmls, files);
    expect(r.total).toBeGreaterThan(ISLAND_BUDGET_BYTES);
    expect(r.problems.join("\n")).toContain("budget");
  });

  it("does not count a React chunk even when the Blob graph imports it", () => {
    const { htmls, files } = load("clean");
    files.set(
      "_astro/blob.AAAA1111.js",
      `import "./client.EEEE5555.js";\n${files.get("_astro/blob.AAAA1111.js")}`,
    );
    files.set(
      "_astro/client.EEEE5555.js",
      `export const r="${noise(60 * KB)}";`,
    );
    const r = evaluate(htmls, files);
    expect(r.excluded).toEqual(["_astro/client.EEEE5555.js"]);
    expect(r.problems).toEqual([]);
  });

  it("does not count a large chunk outside the Blob graph", () => {
    const { htmls, files } = load("clean");
    files.set(
      "_astro/island.FFFF6666.js",
      `export default "${noise(40 * KB)}";`,
    );
    expect(evaluate(htmls, files).problems).toEqual([]);
  });
});

describe("entry presence fails closed", () => {
  it("(d) fails: <blob-agent> in the HTML but no Blob entry chunk", () => {
    const { htmls, files } = load("no-entry");
    const r = evaluate(htmls, files);
    expect(r.problems.join("\n")).toContain("no Blob entry chunk");
  });

  it("passes with a note before Blob lands: no <blob-agent> in any HTML", () => {
    const { files } = load("no-entry");
    const htmls = new Map([["index.html", "<html><body>plain</body></html>"]]);
    const r = evaluate(htmls, files);
    expect(r.problems).toEqual([]);
    expect(r.notes.join("\n")).toContain("no Blob entry found");
  });
});

describe("forbidden-string scan covers every client chunk", () => {
  it("returns [] for the clean fixture", () => {
    expect(scanForbidden(load("clean").files)).toEqual([]);
    expect(evaluate(load("clean").htmls, load("clean").files).problems).toEqual(
      [],
    );
  });

  it("(c) fails: a React chunk containing KV_REST_API_TOKEN", () => {
    const { htmls, files } = load("secret-in-react");
    const r = evaluate(htmls, files);
    expect(r.problems).toEqual([
      "forbidden content in _astro/island.BBBB2222.js: KV_REST_API_TOKEN",
    ]);
  });

  it.each(FORBIDDEN.map((f) => [String(f).slice(0, 30), f] as const))(
    "finds planted %s in a chunk outside the Blob graph",
    (_name, f) => {
      const planted = typeof f === "string" ? f : "key sk-ant-api03-abc";
      const { files } = load("clean");
      files.set("_astro/island.FFFF6666.js", `const x = "${planted}";`);
      expect(scanForbidden(files).map((m) => m.file)).toContain(
        "_astro/island.FFFF6666.js",
      );
    },
  );

  it("never echoes surrounding source in a finding", () => {
    const files = new Map([["a.js", "const k='sk-ant-api03-SECRETVALUE';"]]);
    expect(JSON.stringify(scanForbidden(files))).not.toContain("SECRETVALUE");
  });

  it("fails closed: the word 'upstashing' in prose is still flagged", () => {
    const files = new Map([["a.js", 'const s = "upstashing is fun";']]);
    expect(scanForbidden(files)).toEqual([{ file: "a.js", match: "upstash" }]);
  });
});
