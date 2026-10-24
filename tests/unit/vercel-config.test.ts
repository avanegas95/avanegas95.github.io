import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

interface Header {
  key: string;
  value: string;
}
interface VercelConfig {
  redirects?: { source: string; destination: string; statusCode?: number }[];
  rewrites?: { source: string; destination: string }[];
  headers: { source: string; headers: Header[] }[];
}

// BotID proxy paths for "other" frameworks, copied from
// https://vercel.com/docs/botid/get-started#configure-redirects (and node_modules/botid/README.md).
const BOTID_BASE =
  "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3";
const BOTID_REWRITES = [
  {
    source: `${BOTID_BASE}/a-4-a/c.js`,
    destination: "https://api.vercel.com/bot-protection/v1/challenge",
  },
  {
    source: `${BOTID_BASE}/:path*`,
    destination: "https://api.vercel.com/bot-protection/v1/proxy/:path*",
  },
];
interface BuildRoute {
  src?: string;
  dest?: string;
  status?: number;
  handle?: string;
  headers?: Record<string, string>;
  continue?: boolean;
}

const RESUME = "/Anderson_Vanegas_Resume.pdf";
const config = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;

function globalHeaders(): Map<string, string> {
  const rule = config.headers.find((h) => h.source === "/(.*)");
  expect(rule).toBeDefined();
  return new Map(rule?.headers.map((h) => [h.key, h.value]));
}

function directivesOf(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name = "", ...values] = d.split(/\s+/);
        return [name, values] as [string, string[]];
      }),
  );
}

const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:$/i;

// Returns a list of policy violations (empty when the CSP is acceptable).
function cspProblems(d: Map<string, string[]>): string[] {
  const problems: string[] = [];
  for (const [name, values] of d) {
    for (const v of values) {
      if (["'unsafe-eval'", "'wasm-unsafe-eval'"].includes(v))
        problems.push(`${name}: ${v}`);
      // v1 has inline style="" attributes (about 36), so style-src alone may use 'unsafe-inline'.
      if (v === "'unsafe-inline'" && name !== "style-src")
        problems.push(`${name}: ${v}`);
      if (v.includes("*")) problems.push(`${name}: wildcard ${v}`);
      // Bare schemes allow any host; only data: in img-src/font-src is tolerated.
      if (BARE_SCHEME.test(v)) {
        const tolerated =
          v.toLowerCase() === "data:" && ["img-src", "font-src"].includes(name);
        if (!tolerated) problems.push(`${name}: bare scheme ${v}`);
      }
    }
  }
  return problems;
}

describe("vercel.json", () => {
  it("has no redirect for the resume (the PDF is served directly)", () => {
    const redirects = config.redirects ?? [];
    expect(redirects.filter((r) => r.source === RESUME)).toEqual([]);
    for (const r of redirects) expect(r).not.toHaveProperty("permanent");
  });

  it("serves the resume PDF inline with its filename", () => {
    const rule = config.headers.find((h) => h.source === RESUME);
    expect(rule?.headers).toEqual([
      {
        key: "Content-Disposition",
        value: 'inline; filename="Anderson_Vanegas_Resume.pdf"',
      },
    ]);
  });

  it("headers: each required header is present on /(.*)", () => {
    const h = globalHeaders();
    expect(h.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    const pp = h.get("Permissions-Policy") ?? "";
    for (const f of ["camera", "microphone", "geolocation"]) {
      expect(pp).toContain(`${f}=()`);
    }
  });

  it("CSP has the required directives and nothing unsafe", () => {
    const d = directivesOf(
      globalHeaders().get("Content-Security-Policy") ?? "",
    );
    expect(d.get("connect-src")).toContain("'self'");
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'", "https://formspree.io"]);
    expect(d.get("img-src")).toEqual(["'self'", "data:"]);
    expect(d.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("font-src")).toEqual(["'self'"]);
    expect(cspProblems(d)).toEqual([]);
  });

  it("CSP checker rejects wildcards, bare schemes and unsafe-eval (mutation check)", () => {
    const bad = (csp: string) => cspProblems(directivesOf(csp)).length;
    expect(bad("default-src 'self'; img-src 'self' data:")).toBe(0);
    expect(bad("default-src *")).toBeGreaterThan(0);
    expect(bad("default-src 'self'; img-src https://*.example.com")).toBe(1);
    expect(bad("script-src 'self' https:")).toBe(1);
    expect(bad("script-src 'self' http:")).toBe(1);
    expect(bad("script-src 'self' data:")).toBe(1);
    expect(bad("default-src data:")).toBe(1);
    expect(bad("script-src 'self' 'unsafe-eval'")).toBe(1);
    expect(bad("script-src 'self' 'unsafe-inline'")).toBe(1);
    expect(bad("style-src 'self' 'unsafe-inline'")).toBe(0);
    expect(bad("default-src 'self' 'unsafe-inline'")).toBe(1);
    expect(bad("script-src 'self' 'wasm-unsafe-eval'")).toBe(1);
    expect(bad("connect-src 'self' blob:")).toBe(1);
  });

  it("CSP script-src is 'self' plus sha256 hashes only; connect-src adds only Formspree", () => {
    const d = directivesOf(
      globalHeaders().get("Content-Security-Policy") ?? "",
    );
    const script = d.get("script-src") ?? [];
    expect(script[0]).toBe("'self'");
    const hashes = script.slice(1);
    expect(hashes.length).toBeGreaterThanOrEqual(2);
    for (const h of hashes) expect(h).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
    expect(d.get("connect-src")).toEqual(["'self'", "https://formspree.io"]);
    for (const [name, values] of d) {
      if (name === "style-src") continue;
      expect(values).not.toContain("'unsafe-inline'");
    }
    for (const v of [...d.values()].flat()) {
      expect(v).not.toBe("'unsafe-eval'");
      expect(v).not.toBe("'wasm-unsafe-eval'");
      expect(v).not.toMatch(/^blob:$/i);
    }
  });

  it("has exactly the BotID rewrites from the Vercel docs, in order", () => {
    expect(config.rewrites).toEqual(BOTID_REWRITES);
  });

  it("the specific c.js rewrite precedes the catch-all proxy rewrite", () => {
    const sources = (config.rewrites ?? []).map((r) => r.source);
    expect(sources.indexOf(`${BOTID_BASE}/a-4-a/c.js`)).toBeLessThan(
      sources.indexOf(`${BOTID_BASE}/:path*`),
    );
  });

  it("BotID rewrites only target the Vercel bot-protection API", () => {
    for (const r of config.rewrites ?? []) {
      expect(r.source.startsWith(`${BOTID_BASE}/`)).toBe(true);
      expect(
        r.destination.startsWith("https://api.vercel.com/bot-protection/v1/"),
      ).toBe(true);
    }
  });

  it("BotID proxy path gets X-Frame-Options SAMEORIGIN, as the docs give it", () => {
    const rule = config.headers.find(
      (h) => h.source === `${BOTID_BASE}/:path*`,
    );
    expect(rule).toEqual({
      source: `${BOTID_BASE}/:path*`,
      headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
    });
  });

  it("only the global, BotID and resume PDF rules exist; the BotID rule adds no CSP", () => {
    expect(config.headers.map((h) => h.source).sort()).toEqual(
      ["/(.*)", `${BOTID_BASE}/:path*`, RESUME].sort(),
    );
    // The global rule comes first; the BotID rule is path-specific and only adds X-Frame-Options.
    expect(config.headers[0]?.source).toBe("/(.*)");
    const botid = config.headers.find((h) => h.source !== "/(.*)");
    expect(
      botid?.headers.some((h) => h.key === "Content-Security-Policy"),
    ).toBe(false);
  });

  it("public/ holds the resume PDF at the legacy URL", () => {
    const head = readFileSync(`public${RESUME}`).subarray(0, 5);
    expect(head.toString("latin1")).toBe("%PDF-");
  });
});

// `astro build` (the @astrojs/vercel adapter) writes .vercel/output/config.json WITHOUT the
// vercel.json `redirects`/`headers`: Vercel merges them at deploy/`vercel build` time, placing
// them ahead of `handle: filesystem` and the adapter's `^/.*$ -> _render` catch-all.
// Docs: https://vercel.com/docs/project-configuration#redirects and
// https://vercel.com/docs/build-output-api/configuration#routes
// So we cannot assert the redirect/CSP inside the built config. Instead we guard the
// preconditions that keep the vercel.json redirect authoritative (needs `npm run build`).
const BUILT_CONFIG = ".vercel/output/config.json";
const isBuilt = existsSync(BUILT_CONFIG);

// Reads happen in beforeAll (not at collection time) so a fresh clone without a build passes.
describe("built output carries config", () => {
  let routes: BuildRoute[] = [];
  let fsIdx = -1;

  beforeAll(() => {
    if (!isBuilt) return;
    const built = JSON.parse(readFileSync(BUILT_CONFIG, "utf8")) as {
      routes?: BuildRoute[];
    };
    routes = built.routes ?? [];
    fsIdx = routes.findIndex((r) => r.handle === "filesystem");
  });

  it.skipIf(!isBuilt)(
    "has a filesystem handle, and only pass-through routes before it",
    () => {
      expect(fsIdx).toBeGreaterThanOrEqual(0);
      for (const r of routes.slice(0, fsIdx)) {
        expect(r.continue, JSON.stringify(r)).toBe(true);
        expect(r.dest).toBeUndefined();
      }
    },
  );

  it.skipIf(!isBuilt)(
    "no adapter route before the filesystem handle can capture the resume path",
    () => {
      for (const r of routes.slice(0, fsIdx)) {
        if (r.src !== undefined && new RegExp(r.src).test(RESUME)) {
          expect(r.continue).toBe(true);
          expect(r.status).toBeUndefined();
        }
      }
    },
  );

  it.skipIf(!isBuilt)(
    "the catch-all render route comes after the filesystem handle",
    () => {
      const catchAll = routes.findIndex(
        (r) => r.src === "^/.*$" && r.dest === "_render",
      );
      if (catchAll >= 0) expect(catchAll).toBeGreaterThan(fsIdx);
    },
  );

  it.skipIf(!isBuilt)("the built static output contains the resume PDF", () => {
    expect(existsSync(`.vercel/output/static${RESUME}`)).toBe(true);
  });
});

// Every inline <script> in EVERY built page must be allowed by a sha256 in the CSP, and every
// hash must belong to a real inline script on some page (no stale hashes).
const BUILT_STATIC = ".vercel/output/static";
function builtHtmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return builtHtmlFiles(full);
    return full.endsWith(".html") ? [full] : [];
  });
}
// JSON-LD is a non-executable data block, so the CSP does not apply to it.
function inlineScriptBodies(html: string): string[] {
  return [
    ...html.matchAll(
      /<script(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => m[1] ?? "");
}
describe("inline script extraction (mutation check)", () => {
  it("skips ld+json blocks but still finds executable inline scripts", () => {
    const html =
      '<script type="application/ld+json">{"a":1}</script><script>alert(1)</script>';
    expect(inlineScriptBodies(html)).toEqual(["alert(1)"]);
  });
});
describe("CSP hashes match the built pages", () => {
  it.skipIf(!existsSync(BUILT_STATIC))(
    "each inline script hash is in script-src and vice versa, across all pages",
    () => {
      const d = directivesOf(
        globalHeaders().get("Content-Security-Policy") ?? "",
      );
      const allowed = (d.get("script-src") ?? []).filter((v) =>
        v.startsWith("'sha256-"),
      );
      const pages = builtHtmlFiles(BUILT_STATIC);
      expect(pages.length).toBeGreaterThan(1);
      const used = new Set<string>();
      for (const page of pages) {
        const html = readFileSync(page, "utf8");
        const inline = inlineScriptBodies(html);
        for (const body of inline) {
          const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
          used.add(hash);
          expect(
            allowed,
            `${page}: inline script not allowed by CSP`,
          ).toContain(hash);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      expect([...used].sort()).toEqual([...allowed].sort());
    },
  );
});
