// N-3: verify live security headers on a deployed URL (a Preview, normally).
//   node scripts/ops/check-headers.mjs <url> [--botid-path /some/path]
// Sends HEAD requests only (no chat traffic, no spend). If the deployment sits behind Vercel
// authentication, put the automation bypass value in VERCEL_AUTOMATION_BYPASS_SECRET; it is
// sent as a header and never printed. The BotID base path defaults to the one in vercel.json.
// BotID paths are rewrites proxied to api.vercel.com; Vercel applies only HSTS to those
// responses (our `headers` rules do not), so that path gets a reduced, third-party check.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMMON = [
  ["content-security-policy", (v) => v.length > 0],
  ["strict-transport-security", (v) => /max-age=\d+/.test(v)],
  ["x-content-type-options", (v) => v.toLowerCase() === "nosniff"],
  ["referrer-policy", (v) => v.length > 0],
  ["permissions-policy", (v) => v.length > 0],
  ["cross-origin-opener-policy", (v) => v.length > 0],
];

/** The BotID challenge path is the `/:path*` rewrite source in vercel.json. */
function botIdPathFromConfig() {
  try {
    const url = new URL("../../vercel.json", import.meta.url);
    const cfg = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
    const src = (cfg.rewrites ?? [])
      .map((r) => r.source)
      .find((s) => typeof s === "string" && s.endsWith("/:path*"));
    return src ? src.replace(/\/:path\*$/, "/") : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  let url = null;
  let botIdPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--botid-path") botIdPath = argv[++i] ?? null;
    else if (!argv[i].startsWith("--")) url = argv[i];
  }
  return { url, botIdPath };
}

export async function run(argv, env, fetchImpl) {
  const { url, botIdPath: botArg } = parseArgs(argv);
  const lines = [];
  if (!url || !URL.canParse(url)) {
    return {
      code: 2,
      output: "usage: check-headers.mjs <url> [--botid-path /path]",
    };
  }
  const botIdPath = botArg ?? botIdPathFromConfig();
  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const reqHeaders = bypass ? { "x-vercel-protection-bypass": bypass } : {};
  let failed = false;

  const checks = [
    { label: "HEAD /", path: "/", method: "HEAD", frame: "DENY" },
    {
      label: "HEAD /api/chat",
      path: "/api/chat",
      method: "HEAD",
      frame: "DENY",
      status: 405,
    },
    {
      label: "GET /api/chat",
      path: "/api/chat",
      method: "GET",
      frame: "DENY",
      status: 405,
    },
  ];
  if (botIdPath) {
    checks.push({
      label: "HEAD <botid-path>/a-4-a/c.js",
      path: `${botIdPath.replace(/\/?$/, "/")}a-4-a/c.js`,
      method: "HEAD",
      proxied: true,
    });
  } else {
    lines.push(
      "FAIL BotID path unknown (no --botid-path, none in vercel.json)",
    );
    failed = true;
  }

  for (const c of checks) {
    let res;
    try {
      res = await fetchImpl(new URL(c.path, url).href, {
        method: c.method,
        headers: reqHeaders,
        redirect: "manual",
      });
    } catch (e) {
      lines.push(`FAIL ${c.label}: request error (${e?.name ?? "Error"})`);
      failed = true;
      continue;
    }
    if (c.status && res.status !== c.status) {
      lines.push(`FAIL ${c.label}: expected ${c.status}, got ${res.status}`);
      failed = true;
    }
    if (c.proxied) {
      const hsts = res.headers.get("strict-transport-security");
      if (hsts === null || !/max-age=\d+/.test(hsts)) {
        lines.push(
          `FAIL ${c.label}: ${hsts === null ? "missing" : "bad value for"} strict-transport-security`,
        );
        failed = true;
      }
      const ct = res.headers.get("content-type") ?? "";
      if (/text\/html/i.test(ct)) {
        lines.push(
          `FAIL ${c.label}: served as text/html, not the challenge script`,
        );
        failed = true;
      }
      continue;
    }
    for (const [name, ok] of COMMON) {
      const v = res.headers.get(name);
      if (v === null || !ok(v)) {
        lines.push(
          `FAIL ${c.label}: ${v === null ? "missing" : "bad value for"} ${name}`,
        );
        failed = true;
      }
    }
    const xfo = res.headers.get("x-frame-options");
    if (xfo === null || xfo.toUpperCase() !== c.frame) {
      lines.push(
        `FAIL ${c.label}: x-frame-options must be ${c.frame}, got ${xfo ?? "missing"}`,
      );
      failed = true;
    }
  }
  lines.push(failed ? "headers check FAILED" : "headers check passed");
  return { code: failed ? 1 : 0, output: lines.join("\n") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await run(process.argv.slice(2), process.env, fetch);
  console.log(r.output);
  process.exit(r.code);
}
