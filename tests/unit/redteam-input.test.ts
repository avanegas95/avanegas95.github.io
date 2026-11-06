// P4-10 red team, rules 1-2: oversized/malformed input, header spoofing against the
// rate limits, and Origin/Referer tricks. Every rejection must be a generic 4xx JSON
// body with no SDK call, no spend and a text-free metric (SCOPE §6.1, §6.3).
import { readFileSync } from "node:fs";
import { getClientIpAddress } from "@astrojs/internal-helpers/request";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reached = vi.hoisted(() => [] as string[]);
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Forbidden {
    constructor() {
      reached.push("anthropic");
      throw new Error("real Anthropic client constructed in a test");
    }
  }
  return { ...actual, default: Forbidden, Anthropic: Forbidden };
});
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      reached.push("redis");
      throw new Error("real Redis constructed in a test");
    }
  },
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    constructor() {
      reached.push("ratelimit");
      throw new Error("real Ratelimit constructed in a test");
    }
  },
}));
vi.mock("botid/server", () => ({
  checkBotId: async () => {
    reached.push("botid");
    throw new Error("real BotID reached in a test");
  },
}));

import {
  IP,
  SESSION,
  SALT,
  body,
  call,
  expectAccepted,
  expectMetricClean,
  expectRejected,
  harness,
  request,
} from "../fixtures/redteam/harness.ts";
import { hashIp } from "../../src/lib/server/ratelimit.ts";

// SCOPE §6.1/§6.3 numbers, written out so a loosened constant fails this suite.
const MAX_BODY = 8192;
const MAX_ASSISTANT = 1500;
const IP_PER_MINUTE = 8;

beforeEach(() => {
  reached.length = 0;
});
afterEach(() => {
  expect(reached).toEqual([]);
});

const utf8 = new TextEncoder();
const bytes = (s: string): number => utf8.encode(s).byteLength;
const CANARY = "REDTEAM-CANARY-TEXT";

/**
 * A structurally valid request of exactly `target` UTF-8 bytes, padded with the
 * multi-byte `ch` (so its UTF-16 length is well under its byte length).
 */
function sizedRaw(target: number, ch = "\u00E9"): string {
  const msgs = Array.from({ length: 9 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: i % 2 === 0 ? CANARY : "a",
  }));
  const raw = () => JSON.stringify({ messages: msgs, sessionId: SESSION });
  const per = bytes(ch);
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    const room = MAX_ASSISTANT - [...m.content].length;
    const n = Math.min(room, Math.floor((target - bytes(raw())) / per));
    if (n > 0) m.content += ch.repeat(n);
  }
  const last = msgs[msgs.length - 1]!;
  last.content += "x".repeat(target - bytes(raw()));
  const out = raw();
  expect(bytes(out)).toBe(target);
  return out;
}

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < parts.length) c.enqueue(parts[i++]!);
      else c.close();
    },
  });
}

function chunked(s: string, size: number): ReadableStream<Uint8Array> {
  const all = utf8.encode(s);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += size) parts.push(all.slice(i, i + size));
  return streamOf(parts);
}

// ---------- rule 1: oversized and malformed input ----------

describe("rule 1: body size is counted in bytes", () => {
  it("accepts a valid body of exactly 8,192 bytes of 2-byte characters (boundary control)", async () => {
    const raw = sizedRaw(MAX_BODY);
    expect(raw.length).toBeLessThan(MAX_BODY);
    const h = harness();
    await expectAccepted(h, await call(h, request({ raw })));
  });

  it.each([
    ["2-byte", "\u00E9"],
    ["3-byte", "\u20AC"],
    ["4-byte", "\u{1F600}"],
  ])(
    "rejects 8,193 bytes padded with %s characters (UTF-16 length under the limit) -> 413",
    async (_name, ch) => {
      const raw = sizedRaw(MAX_BODY + 1, ch);
      expect(raw.length).toBeLessThan(MAX_BODY);
      const h = harness();
      await expectRejected(h, await call(h, request({ raw })), 413, "invalid", [
        CANARY,
      ]);
    },
  );

  it("rejects a chunked body with no content-length once it passes 8,192 bytes -> 413", async () => {
    const raw = sizedRaw(MAX_BODY + 1);
    const h = harness();
    const req = request({ raw: chunked(raw, 97) });
    expect(req.headers.get("content-length")).toBeNull();
    await expectRejected(h, await call(h, req), 413, "invalid", [CANARY]);
  });

  it("rejects an endless chunked body without reading it all -> 413", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(utf8.encode("x".repeat(1024)));
      },
    });
    const h = harness();
    await expectRejected(
      h,
      await call(h, request({ raw: endless })),
      413,
      "invalid",
    );
    expect(pulled).toBeLessThan(20);
  });

  it("a content-length that understates the body does not let it through -> 413", async () => {
    const raw = sizedRaw(MAX_BODY + 1);
    const h = harness();
    const req = request({ raw, headers: { "content-length": "100" } });
    await expectRejected(h, await call(h, req), 413, "invalid", [CANARY]);
  });

  it("a content-length over the limit is refused up front -> 413", async () => {
    const h = harness();
    const req = request({ headers: { "content-length": "999999" } });
    await expectRejected(h, await call(h, req), 413, "invalid");
  });
});

describe("rule 1: turn count and per-turn length", () => {
  const turns = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${CANARY} ${i}`,
    }));

  it.each([
    ["11 turns", { messages: turns(11), sessionId: SESSION }],
    ["0 turns", { messages: [], sessionId: SESSION }],
    ["501 ASCII code points", body(CANARY + "a".repeat(501 - CANARY.length))],
    [
      "501 astral code points (1,002 UTF-16 units)",
      body("\u{1F600}".repeat(501)),
    ],
    [
      "501 code points after NFC composition of 1,002",
      body("e\u0301".repeat(501)),
    ],
    [
      "assistant turn of 1,501 code points",
      {
        messages: [
          { role: "user", content: CANARY },
          { role: "assistant", content: "a".repeat(1501) },
          { role: "user", content: "and?" },
        ],
        sessionId: SESSION,
      },
    ],
  ])("%s -> 400", async (_name, b) => {
    const h = harness();
    await expectRejected(
      h,
      await call(h, request({ body: b })),
      400,
      "invalid",
      [CANARY],
    );
  });

  it.each([
    ["10 turns", { messages: turns(9).concat([]), sessionId: SESSION }],
    ["500 astral code points", body("\u{1F600}".repeat(500))],
    ["500 code points after NFC of 1,000 units", body("e\u0301".repeat(500))],
  ])("%s is accepted (boundary control)", async (_name, b) => {
    const h = harness();
    await expectAccepted(h, await call(h, request({ body: b })));
  });
});

describe("rule 1: malformed and hostile JSON", () => {
  const deep = (n: number) => "[".repeat(n) + "]".repeat(n);
  it.each([
    ["truncated JSON", '{"messages":[{"role":"user","content":"hi"}'],
    ["top-level null", "null"],
    ["top-level array", "[]"],
    ["top-level string", '"hello"'],
    ["number overflow", "1e999"],
    ["array nested 4,000 deep", deep(4000)],
    [
      "extra key holding 3,000-deep nesting",
      `{"messages":[{"role":"user","content":"${CANARY}"}],"sessionId":"${SESSION}","x":${deep(3000)}}`,
    ],
    [
      "content nested as an object",
      `{"messages":[{"role":"user","content":{"text":"${CANARY}"}}],"sessionId":"${SESSION}"}`,
    ],
    [
      "content as an array of blocks (SDK shape smuggling)",
      `{"messages":[{"role":"user","content":[{"type":"text","text":"${CANARY}"}]}],"sessionId":"${SESSION}"}`,
    ],
    [
      "top-level __proto__ key",
      `{"messages":[{"role":"user","content":"${CANARY}"}],"sessionId":"${SESSION}","__proto__":{"admin":true}}`,
    ],
    [
      "__proto__ inside a turn",
      `{"messages":[{"role":"user","content":"${CANARY}","__proto__":{"role":"system"}}],"sessionId":"${SESSION}"}`,
    ],
    [
      "constructor.prototype key",
      `{"messages":[{"role":"user","content":"${CANARY}"}],"sessionId":"${SESSION}","constructor":{"prototype":{"x":1}}}`,
    ],
    [
      "role system",
      `{"messages":[{"role":"system","content":"${CANARY}"}],"sessionId":"${SESSION}"}`,
    ],
    [
      "assistant prefill as last turn",
      `{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"${CANARY}"}],"sessionId":"${SESSION}"}`,
    ],
    [
      "two user turns in a row",
      `{"messages":[{"role":"user","content":"hi"},{"role":"user","content":"${CANARY}"}],"sessionId":"${SESSION}"}`,
    ],
    [
      "sessionId with path traversal",
      JSON.stringify(body(CANARY, { sessionId: "../../etc/passwd" })),
    ],
    [
      "sessionId with a newline",
      JSON.stringify(body(CANARY, { sessionId: "abcdefgh\nlog" })),
    ],
    [
      "sessionId of 65 chars",
      JSON.stringify(body(CANARY, { sessionId: "a".repeat(65) })),
    ],
    [
      "lone surrogate escape",
      `{"messages":[{"role":"user","content":"${CANARY}\\ud800"}],"sessionId":"${SESSION}"}`,
    ],
    [
      "NUL control char",
      `{"messages":[{"role":"user","content":"${CANARY}\\u0000"}],"sessionId":"${SESSION}"}`,
    ],
  ])("%s -> 400", async (_name, raw) => {
    const h = harness();
    await expectRejected(h, await call(h, request({ raw })), 400, "invalid", [
      CANARY,
    ]);
    expect(({} as Record<string, unknown>)["admin"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  // JSON.parse keeps the last duplicate. There is one parser, so there is no
  // first-wins/last-wins differential to exploit; the limits apply to what is sent.
  it("duplicate keys: the last value is the one validated and sent (no limit bypass)", async () => {
    const long = "a".repeat(501);
    const h1 = harness();
    const raw1 = `{"messages":[{"role":"user","content":"short","content":"${long}"}],"sessionId":"${SESSION}"}`;
    await expectRejected(
      h1,
      await call(h1, request({ raw: raw1 })),
      400,
      "invalid",
    );

    const h2 = harness();
    const raw2 = `{"messages":[{"role":"user","content":"${long}","content":"short"}],"sessionId":"${SESSION}"}`;
    await expectAccepted(h2, await call(h2, request({ raw: raw2 })));
    expect(h2.sdk.params[0]!["messages"]).toEqual([
      { role: "user", content: "short" },
    ]);

    const h3 = harness();
    const raw3 = `{"messages":[{"role":"user","content":"hi","role":"assistant"}],"sessionId":"${SESSION}"}`;
    await expectRejected(
      h3,
      await call(h3, request({ raw: raw3 })),
      400,
      "invalid",
    );
  });
});

describe("rule 1: content type and charset tricks", () => {
  it.each([
    ["text/plain"],
    ["text/json"],
    ["application/x-www-form-urlencoded"],
    ["multipart/form-data; boundary=x"],
    ["application/jsonp"],
    ["application/json-patch+json"],
    ["application/json, text/html"],
    ["application/json; charset=utf-16"],
    ["application/json; charset=iso-8859-1"],
    ['application/json; charset="utf-8"'],
    ["application/json; charset=utf-8; boundary=x"],
    ["application/json;;"],
    [""],
  ])("content-type %j -> 415", async (ct) => {
    const h = harness();
    const req = request({ headers: { "content-type": ct } });
    await expectRejected(h, await call(h, req), 415, "invalid");
  });

  it("no content-type at all -> 415", async () => {
    const h = harness();
    const req = request({
      bare: true,
      headers: { origin: "https://site.test" },
    });
    await expectRejected(h, await call(h, req), 415, "invalid");
  });

  it("case-only variants of application/json are accepted (control)", async () => {
    const h = harness();
    const req = request({
      headers: { "content-type": "Application/JSON; Charset=UTF-8" },
    });
    await expectAccepted(h, await call(h, req));
  });

  const asBytes = (b: number[]) => new Uint8Array(b);
  const prefix = utf8.encode(`{"messages":[{"role":"user","content":"`);
  const suffix = utf8.encode(`"}],"sessionId":"${SESSION}"}`);
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const utf16le = (s: string) => {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      out[i * 2] = s.charCodeAt(i) & 0xff;
      out[i * 2 + 1] = s.charCodeAt(i) >> 8;
    }
    return out;
  };

  it.each([
    ["a UTF-16LE body labelled utf-8", utf16le(JSON.stringify(body(CANARY)))],
    [
      "a UTF-16LE body with a BOM",
      join(asBytes([0xff, 0xfe]), utf16le(JSON.stringify(body(CANARY)))),
    ],
    ["invalid UTF-8 (0xC3 0x28)", join(prefix, asBytes([0xc3, 0x28]), suffix)],
    [
      "an overlong '<' (0xC0 0xBC)",
      join(prefix, asBytes([0xc0, 0xbc]), suffix),
    ],
    [
      "an encoded surrogate (0xED 0xA0 0x80)",
      join(prefix, asBytes([0xed, 0xa0, 0x80]), suffix),
    ],
    [
      "Latin-1 bytes (0xE9)",
      join(prefix, asBytes([0x63, 0x61, 0x66, 0xe9]), suffix),
    ],
  ])("%s -> 400", async (_name, raw) => {
    const h = harness();
    await expectRejected(
      h,
      await call(h, request({ raw: streamOf([raw]) })),
      400,
      "invalid",
      [CANARY],
    );
  });
});

describe("rule 1: method override headers never turn another method into POST", () => {
  const OVERRIDES = {
    "x-http-method-override": "POST",
    "x-http-method": "POST",
    "x-method-override": "POST",
  };
  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "%s with override headers -> 405 allow: POST",
    async (method) => {
      const h = harness();
      const res = await call(
        h,
        request({
          method,
          headers: OVERRIDES,
          url: "https://site.test/api/chat?_method=POST",
        }),
      );
      expect(res.headers.get("allow")).toBe("POST");
      await expectRejected(h, res, 405, "invalid");
    },
  );

  it("POST with an override to DELETE/GET is still handled as one POST (header ignored)", async () => {
    const h = harness();
    const res = await call(
      h,
      request({
        headers: { "x-http-method-override": "DELETE", "x-http-method": "GET" },
        url: "https://site.test/api/chat?_method=GET",
      }),
    );
    await expectAccepted(h, res);
  });
});

// PLAN "P4-10 additions": the zero-width/bidi rules apply to user turns only.
describe("rule 1: zero-width and bidi rules are user-turn only", () => {
  it.each([
    ["only U+200B", "\u200B"],
    [
      "only the closed invisible list",
      "\u200B\u200C\u200D\u2060\uFEFF\u00AD \t\n",
    ],
    ["RLO override U+202E", `${CANARY} \u202Egnp.exe`],
    ["isolate U+2066", `${CANARY} \u2066x\u2069`],
    ["LRM U+200E", `${CANARY}\u200E`],
    ["ALM U+061C", `${CANARY}\u061C`],
    ["C1 control U+0085", `${CANARY}\u0085`],
  ])("a user turn with %s -> 400", async (_name, content) => {
    const h = harness();
    await expectRejected(
      h,
      await call(h, request({ body: body(content) })),
      400,
      "invalid",
      [CANARY],
    );
  });

  it.each([
    ["only U+200B", "\u200B"],
    ["U+202E inside", "Sure \u202Ething"],
  ])(
    "an assistant turn with %s is accepted and sent as-is",
    async (_name, content) => {
      const h = harness();
      const messages = [
        { role: "user", content: "hi" },
        { role: "assistant", content },
        { role: "user", content: "more please" },
      ];
      await expectAccepted(
        h,
        await call(h, request({ body: { messages, sessionId: SESSION } })),
      );
      expect(h.sdk.params[0]!["messages"]).toEqual(messages);
    },
  );

  it("a user turn with visible text plus an emoji ZWJ sequence is accepted (control)", async () => {
    const h = harness();
    const content = "Hi from \u{1F469}\u200D\u{1F4BB}";
    await expectAccepted(h, await call(h, request({ body: body(content) })));
  });

  // Invisible characters outside the old closed list (U+034F, U+180E, U+2061-2064,
  // U+3164, U+FFA0, U+2800, tag characters). Finding F-IN-1, fixed in P4-15: a user
  // turn is empty once \s, Default_Ignorable code points and U+2800 are removed.
  it.each([
    ["U+034F combining grapheme joiner", "\u034F"],
    ["U+180E Mongolian vowel separator", "\u180E"],
    ["U+2061-2064 invisible operators", "\u2061\u2062\u2063\u2064"],
    ["U+3164 Hangul filler", "\u3164"],
    ["U+FFA0 halfwidth Hangul filler", "\uFFA0"],
    ["U+2800 braille blank", "\u2800"],
    ["tag characters U+E0001, U+E0048, U+E0049", "\u{E0001}\u{E0048}\u{E0049}"],
  ])("[F-IN-1] a user turn of only %s -> 400", async (_name, content) => {
    const h = harness();
    await expectRejected(
      h,
      await call(h, request({ body: body(content) })),
      400,
      "invalid",
    );
  });
});

// ---------- rule 2: header spoofing and origin ----------

describe("rule 2: spoofed client-IP headers never change the rate-limit bucket", () => {
  const SPOOFS: Record<string, (i: number) => string> = {
    "x-forwarded-for": (i) => `10.0.0.${i}, 192.0.2.${i}`,
    "x-real-ip": (i) => `192.0.2.${i}`,
    "cf-connecting-ip": (i) => `192.0.2.${i}`,
    "true-client-ip": (i) => `192.0.2.${i}`,
    forwarded: (i) => `for=192.0.2.${i};proto=https`,
    "x-client-ip": (i) => `192.0.2.${i}`,
    "x-vercel-forwarded-for": (i) => `192.0.2.${i}`,
  };

  it.each(Object.keys(SPOOFS))(
    "rotating %s with a fixed clientAddress: request 9 in a minute -> 429",
    async (header) => {
      const h = harness();
      const statuses: number[] = [];
      for (let i = 1; i <= IP_PER_MINUTE + 1; i++) {
        const res = await call(
          h,
          request({ headers: { [header]: SPOOFS[header]!(i) } }),
        );
        statuses.push(res.status);
        await res.text();
      }
      expect(statuses).toEqual([...Array(IP_PER_MINUTE).fill(200), 429]);
      expect(new Set(h.ipMinute.keys)).toEqual(new Set([hashIp(IP, SALT)]));
      expect(h.sdk.make).toHaveBeenCalledTimes(IP_PER_MINUTE);
      expect(h.store.incrby).toHaveBeenCalledTimes(IP_PER_MINUTE);
      expectMetricClean(h.logs.slice(-1), ["192.0.2."]);
      expect(h.logs.at(-1)).toMatchObject({
        status: 429,
        code: "rate_limited",
      });
    },
  );

  it("all spoof headers at once, rotating: still one bucket, 9th -> 429", async () => {
    const h = harness();
    const statuses: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const headers = Object.fromEntries(
        Object.entries(SPOOFS).map(([k, f]) => [k, f(i)]),
      );
      const res = await call(h, request({ headers }));
      statuses.push(res.status);
      await res.text();
    }
    expect(statuses.at(-1)).toBe(429);
    expect(h.ipMinute.counts.size).toBe(1);
  });

  it("naming a victim's IP in X-Forwarded-For never spends the victim's bucket", async () => {
    const victim = "192.0.2.200";
    const h = harness();
    for (let i = 0; i < 9; i++) {
      await (
        await call(h, request({ headers: { "x-forwarded-for": victim } }))
      ).text();
    }
    expect(h.ipMinute.counts.get(hashIp(victim, SALT))).toBeUndefined();
    const res = await call(h, request(), undefined, victim);
    expect(res.status).toBe(200);
    await res.text();
    expect(h.ipMinute.counts.get(hashIp(victim, SALT))).toBe(1);
  });

  it("an unavailable clientAddress falls into one shared 'unknown' bucket (fails closed)", async () => {
    const h = harness();
    const throwing = () => {
      throw new Error("ClientAddressNotAvailable");
    };
    const statuses: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const res = await call(
        h,
        request({ headers: { "x-forwarded-for": `192.0.2.${i}` } }),
        undefined,
        throwing,
      );
      statuses.push(res.status);
      await res.text();
    }
    expect(statuses.at(-1)).toBe(429);
    expect([...h.ipMinute.counts.keys()]).toEqual([hashIp("unknown", SALT)]);
  });

  // An IPv6 client usually controls a whole /64. Finding F-RL-1, fixed in P4-15:
  // IPv6 is keyed by its /64.
  it("[F-RL-1] nine addresses from one IPv6 /64 share the per-IP minute bucket", async () => {
    const h = harness();
    const statuses: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const res = await call(
        h,
        request(),
        undefined,
        `2001:db8:1:2::${i.toString(16)}`,
      );
      statuses.push(res.status);
      await res.text();
    }
    expect(statuses.at(-1)).toBe(429);
  });

  it("[F-RL-1] respelling one address (case, expansion, IPv4-mapped) never opens a new bucket", async () => {
    const h = harness();
    const spellings = [
      "2001:db8:1:2::1",
      "2001:DB8:1:2::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:db8:1:2:0:0:0:ffff",
      "203.0.113.5",
      "::ffff:203.0.113.5",
      "::FFFF:cb00:7105",
      "0:0:0:0:0:ffff:203.0.113.5",
      "203.0.113.5",
    ];
    for (const ip of spellings) {
      await (await call(h, request(), undefined, ip)).text();
    }
    expect([...h.ipMinute.counts.values()].sort()).toEqual([4, 5]);
  });
});

// ---------- P4-15: extra attack tests ----------

describe("P4-15: limits are keyed on the client, not on anything it sends", () => {
  it("rotating sessionId never resets the minute, day or global limit", async () => {
    const h = harness();
    const statuses: number[] = [];
    for (let i = 1; i <= IP_PER_MINUTE + 1; i++) {
      const res = await call(
        h,
        request({ body: body("hi", { sessionId: `rotated_session_${i}` }) }),
      );
      statuses.push(res.status);
      await res.text();
    }
    expect(statuses).toEqual([...Array(IP_PER_MINUTE).fill(200), 429]);
    // One key per limiter, and none of them is derived from the sessionId.
    expect(new Set(h.ipMinute.keys)).toEqual(new Set([hashIp(IP, SALT)]));
    expect(new Set(h.ipDay.keys)).toEqual(new Set([hashIp(IP, SALT)]));
    expect(new Set(h.globalDay.keys)).toEqual(new Set(["all"]));
    expect(h.sdk.make).toHaveBeenCalledTimes(IP_PER_MINUTE);
  });

  it("9 parallel requests racing the limiter: exactly one is limited", async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: IP_PER_MINUTE + 1 }, () => call(h)),
    );
    const statuses = results.map((r) => r.status);
    await Promise.all(results.map((r) => r.text()));
    expect(statuses.filter((s) => s === 200)).toHaveLength(IP_PER_MINUTE);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    expect(h.sdk.make).toHaveBeenCalledTimes(IP_PER_MINUTE);
    expect(h.store.incrby).toHaveBeenCalledTimes(IP_PER_MINUTE);
  });

  it("9 parallel requests from one IPv6 /64: exactly one is limited", async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: IP_PER_MINUTE + 1 }, (_, i) =>
        call(h, request(), undefined, `2001:db8:9:9::${i + 1}`),
      ),
    );
    await Promise.all(results.map((r) => r.text()));
    expect(results.filter((r) => r.status === 429)).toHaveLength(1);
  });
});

// S-04: `clientAddress` is the first X-Forwarded-For value under @astrojs/vercel.
// That is safe ONLY because Vercel's edge overwrites X-Forwarded-For with the real
// client IP. Never put another proxy or CDN in front of Vercel (or switch adapters)
// without revisiting this: the client could then choose its own rate-limit key.
describe("S-04: the Vercel adapter's clientAddress contract (pinned)", () => {
  it("the serverless entrypoint derives clientAddress from getClientIpAddress", () => {
    const src = readFileSync(
      new URL(
        "../../node_modules/@astrojs/vercel/dist/serverless/entrypoint.js",
        import.meta.url,
      ),
      "utf8",
    );
    expect(src).toMatch(/clientAddress:\s*getClientIpAddress\(request\)/);
    expect(src).toMatch(
      /import\s*\{\s*getClientIpAddress\s*\}\s*from\s*["']@astrojs\/internal-helpers\/request["']/,
    );
  });

  it.each([
    ["1.2.3.4, 5.6.7.8", "1.2.3.4"],
    ["1.2.3.4", "1.2.3.4"],
    ["2001:db8::1, 1.2.3.4", "2001:db8::1"],
    ["not-an-ip, 1.2.3.4", undefined],
    ["", undefined],
  ])("X-Forwarded-For %j -> clientAddress %j", (xff, expected) => {
    const req = new Request("https://site.test/api/chat", {
      headers: xff === "" ? {} : { "x-forwarded-for": xff },
    });
    expect(getClientIpAddress(req)).toBe(expected);
  });

  it("whatever the adapter yields, a non-address falls into the shared 'unknown' bucket", async () => {
    const h = harness();
    for (let i = 0; i < 9; i++) {
      await (await call(h, request(), undefined, `garbage-${i}`)).text();
    }
    expect([...h.ipMinute.counts.keys()]).toEqual([hashIp("unknown", SALT)]);
  });
});

describe("rule 2: Origin is checked by exact host (P2-02); Referer is not trusted", () => {
  it.each([
    ["a lookalike suffix", "https://site.test.evil.zz"],
    ["a lookalike prefix", "https://evilsite.test"],
    ["the host as a path", "https://evil.zz/site.test"],
    ["userinfo naming the host", "https://site.test@evil.zz"],
    ["a fragment naming the host", "https://evil.zz#@site.test"],
    ["another port", "https://site.test:8443"],
    ["a trailing dot", "https://site.test."],
    [
      "a Cyrillic homoglyph host (punycode)",
      new URL("https://\u0455ite.test").origin,
    ],
    ["the literal null", "null"],
    ["not a URL", "site.test"],
    ["an empty Origin", ""],
    ["a file origin", "file://"],
  ])("Origin with %s -> 403", async (_name, origin) => {
    const h = harness();
    const req = request({ headers: { origin } });
    await expectRejected(h, await call(h, req), 403, "invalid");
  });

  it.each([
    ["no Origin header", undefined],
    ["upper-case host", "https://SITE.TEST"],
    ["http scheme, same host (host-only rule)", "http://site.test"],
  ])("%s is accepted (control)", async (_name, origin) => {
    const h = harness();
    const req = request({
      bare: true,
      headers: { "content-type": "application/json" },
    });
    if (origin !== undefined) req.headers.set("origin", origin);
    await expectAccepted(h, await call(h, req));
  });

  it("a same-site Referer cannot rescue a cross-site Origin", async () => {
    const h = harness();
    const req = request({
      headers: { origin: "https://evil.zz", referer: "https://site.test/" },
    });
    await expectRejected(h, await call(h, req), 403, "invalid");
  });

  it("a spoofed Host-style header cannot redefine the expected host", async () => {
    const h = harness();
    const req = request({
      headers: {
        origin: "https://evil.zz",
        "x-forwarded-host": "evil.zz",
        "x-original-host": "evil.zz",
      },
    });
    await expectRejected(h, await call(h, req), 403, "invalid");
  });
});
