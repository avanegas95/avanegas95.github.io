// Live chat smoke: sends ONE question to a deployed /api/chat and prints event names, sizes and
// timings only (never the reply text). It spends real (tiny) money, so it needs an explicit flag
// and refuses to run in CI.
//   node scripts/smoke/chat-smoke.js <url> --spend [--question "text"]
// A deployment behind Vercel authentication needs VERCEL_AUTOMATION_BYPASS_SECRET (sent as a
// header, never printed). BotID may reject a non-browser client with code "bot"; that is a valid
// outcome to report, not something to work around.
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 60_000;
const DEFAULT_QUESTION = "What does Anderson do?";

export async function run(argv, env, fetchImpl) {
  const url = argv.find((a) => !a.startsWith("--") && URL.canParse(a));
  const qi = argv.indexOf("--question");
  const question = qi >= 0 && argv[qi + 1] ? argv[qi + 1] : DEFAULT_QUESTION;
  if (!url || !argv.includes("--spend")) {
    return {
      code: 2,
      output:
        "refusing: pass <url> and --spend (this sends one real request that costs money)",
    };
  }
  if (env.CI) return { code: 2, output: "refusing to run in CI" };

  const headers = { "content-type": "application/json" };
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET)
    headers["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const sessionId = "smoke" + Math.random().toString(36).slice(2, 12);
  const t0 = Date.now();
  // One deadline covers the request and the whole stream read.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetchImpl(new URL("/api/chat", url).href, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      sessionId,
    }),
  });
  const out = {
    status: res.status,
    contentType: res.headers.get("content-type"),
    ttfbMs: Date.now() - t0,
  };
  const isSse = (out.contentType ?? "").startsWith("text/event-stream");
  if (!res.ok || !res.body || !isSse) {
    try {
      out.errorCode = (await res.json())?.error?.code ?? null;
    } catch {
      out.errorCode = null;
    }
    const ra = res.headers.get("retry-after");
    if (ra) out.retryAfter = ra;
    return { code: 1, output: JSON.stringify(out) };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const sequence = [];
  let deltaBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const name = /^event: (.*)$/m.exec(frame)?.[1] ?? "?";
      const data = /^data: (.*)$/m.exec(frame)?.[1] ?? "";
      sequence.push(name);
      if (name === "delta") deltaBytes += data.length;
      try {
        const d = JSON.parse(data);
        if (name === "done") out.usageBucket = d.usageBucket;
        if (name === "error") out.errorCode = d.code;
      } catch {
        // size and name only
      }
    }
  }
  out.totalMs = Date.now() - t0;
  out.deltaCount = sequence.filter((s) => s === "delta").length;
  out.deltaBytes = deltaBytes;
  out.sequence = sequence.filter((s) => s !== "delta");
  const ok = sequence.includes("done") && !sequence.includes("error");
  return { code: ok ? 0 : 1, output: JSON.stringify(out) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await run(process.argv.slice(2), process.env, fetch);
  console.log(r.output);
  process.exit(r.code);
}
