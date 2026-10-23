import { describe, expect, it } from "vitest";
import { LIMITS, parseChatRequest } from "../../src/lib/server/input";

const URL_ = "https://avanegas.com/api/chat";
const SESSION = "abcdefgh-12345678";

type Init = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
};

function req(body: unknown, init: Init = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(URL_, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.method === "GET" ? null : (init.body ?? raw),
  });
}

function payload(messages: Record<string, unknown>[], extra: object = {}) {
  return { messages, sessionId: SESSION, ...extra };
}

const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });

async function err(request: Request) {
  const r = await parseChatRequest(request);
  expect(r.ok).toBe(false);
  return r.ok ? null : r.error;
}

describe("parseChatRequest: happy paths", () => {
  it("accepts a single user turn", async () => {
    const r = await parseChatRequest(req(payload([u("hi")])));
    expect(r).toEqual({
      ok: true,
      value: { messages: [u("hi")], sessionId: SESSION },
    });
  });

  it("accepts 9 alternating turns ending in user", async () => {
    const turns = Array.from({ length: 9 }, (_, i) =>
      i % 2 === 0 ? u(`q${i}`) : a(`a${i}`),
    );
    const r = await parseChatRequest(req(payload(turns)));
    expect(r.ok).toBe(true);
  });

  it("rejects 10 turns (they must end on assistant, so 9 is the largest valid count)", async () => {
    const turns = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? u("q") : a("a"),
    );
    expect(await err(req(payload(turns)))).toBe("invalid");
  });

  it("accepts charset=utf-8 on the content type", async () => {
    const r = await parseChatRequest(
      req(payload([u("hi")]), {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("accepts a same-origin Origin header and a missing one", async () => {
    const same = await parseChatRequest(
      req(payload([u("hi")]), { headers: { origin: "https://avanegas.com" } }),
    );
    expect(same.ok).toBe(true);
    const none = await parseChatRequest(req(payload([u("hi")])));
    expect(none.ok).toBe(true);
  });

  it("counts emoji by code point (500 emoji ok, 501 invalid)", async () => {
    expect(
      (await parseChatRequest(req(payload([u("😀".repeat(500))])))).ok,
    ).toBe(true);
    expect(await err(req(payload([u("😀".repeat(501))])))).toBe("invalid");
  });

  it("allows 500 user chars and 1500 assistant chars, rejects one more", async () => {
    const ok = [u("a".repeat(500)), a("b".repeat(1500)), u("c")];
    expect((await parseChatRequest(req(payload(ok)))).ok).toBe(true);
    expect(await err(req(payload([u("a".repeat(501))])))).toBe("invalid");
    const bad = [u("q"), a("b".repeat(1501)), u("c")];
    expect(await err(req(payload(bad)))).toBe("invalid");
  });

  it("measures length after NFC normalization", async () => {
    // 500 x (e + combining acute) = 1000 code points raw, 500 after NFC
    const r = await parseChatRequest(req(payload([u("é".repeat(500))])));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.messages[0]!.content).toBe("é".repeat(500));
  });

  it("normalizes CRLF to LF and keeps tabs/newlines", async () => {
    const r = await parseChatRequest(req(payload([u("a\r\nb\tc\nd")])));
    expect(r.ok && r.value.messages[0]!.content).toBe("a\nb\tc\nd");
  });
});

describe("parseChatRequest: method, content type, origin", () => {
  it("rejects non-POST methods", async () => {
    expect(await err(req(payload([u("hi")]), { method: "GET" }))).toBe(
      "method",
    );
    expect(await err(req(payload([u("hi")]), { method: "PUT" }))).toBe(
      "method",
    );
  });

  it("rejects wrong content types", async () => {
    for (const ct of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/json; charset=latin1",
      "application/jsonp",
      "application/json; boundary=x",
      "",
    ]) {
      const r = new Request(URL_, {
        method: "POST",
        headers: ct ? { "content-type": ct } : {},
        body: JSON.stringify(payload([u("hi")])),
      });
      // fetch assigns text/plain to string bodies when no type is set
      expect(await err(r)).toBe("content_type");
    }
  });

  it("rejects a cross-origin Origin", async () => {
    expect(
      await err(
        req(payload([u("hi")]), {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe("origin");
  });

  it("rejects lookalike, port-mismatched and unparsable origins", async () => {
    for (const origin of [
      "https://avanegas.com.evil.example",
      "https://avanegas.com:8443",
      "https://evil.example/avanegas.com",
      "null",
      "not a url",
    ]) {
      expect(await err(req(payload([u("hi")]), { headers: { origin } }))).toBe(
        "origin",
      );
    }
  });
});

describe("parseChatRequest: body size", () => {
  const padded = (bytes: number) => {
    const base = JSON.stringify(payload([u("x")]));
    return base + " ".repeat(bytes - base.length);
  };

  it("accepts exactly 8192 bytes", async () => {
    const body = padded(LIMITS.maxBodyBytes);
    expect(new TextEncoder().encode(body).length).toBe(8192);
    expect((await parseChatRequest(req(body))).ok).toBe(true);
  });

  it("rejects 8193 bytes", async () => {
    expect(await err(req(padded(8193)))).toBe("too_large");
  });

  it("rejects a 9 KB body even if content-length claims 100", async () => {
    const body = padded(9 * 1024);
    expect(await err(req(body, { headers: { "content-length": "100" } }))).toBe(
      "too_large",
    );
  });

  it("rejects an oversize declared content-length with a small body", async () => {
    expect(
      await err(
        req(payload([u("hi")]), { headers: { "content-length": "999999" } }),
      ),
    ).toBe("too_large");
  });

  it("counts bytes, not characters: multibyte over the limit", async () => {
    // 5,600 bytes of "é" fits; 4,200 x "é" in a JSON key slot pushes to > 8192 bytes
    const fits = JSON.stringify({
      ...payload([u("hi")]),
      pad: "é".repeat(2800),
    });
    expect(new TextEncoder().encode(fits).length).toBeLessThan(8192);
    // fits is under the byte limit, so it must fail on schema (unknown key), not size
    expect(await err(req(fits))).toBe("invalid");

    const over = JSON.stringify({
      ...payload([u("hi")]),
      pad: "é".repeat(4200),
    });
    expect(over.length).toBeLessThan(8192); // fewer chars than the limit...
    expect(new TextEncoder().encode(over).length).toBeGreaterThan(8192); // ...more bytes
    expect(await err(req(over))).toBe("too_large");
  });

  it("rejects 3-byte and 4-byte multibyte bodies over the byte limit", async () => {
    for (const ch of ["€", "😀"]) {
      const body = JSON.stringify({
        ...payload([u("hi")]),
        pad: ch.repeat(2800),
      });
      expect(new TextEncoder().encode(body).length).toBeGreaterThan(8192);
      expect(await err(req(body))).toBe("too_large");
    }
  });

  it("stops reading a stream once the limit is passed", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
        if (pulled > 1000) controller.close();
      },
    });
    const request = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-expect-error duplex is required for stream bodies in Node
      duplex: "half",
    });
    expect(await err(request)).toBe("too_large");
    expect(pulled).toBeLessThan(50);
  });
});

describe("parseChatRequest: JSON and schema", () => {
  it("rejects invalid JSON and empty bodies as malformed", async () => {
    expect(await err(req("{"))).toBe("malformed");
    expect(await err(req(""))).toBe("malformed");
    expect(await err(req("not json"))).toBe("malformed");
  });

  it("rejects invalid UTF-8 as malformed", async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    expect(await err(req("", { body: bytes }))).toBe("malformed");
  });

  it("rejects non-object JSON", async () => {
    for (const body of ["null", "[]", "42", '"x"']) {
      expect(await err(req(body))).toBe("invalid");
    }
  });

  it("rejects 11 turns and 0 turns", async () => {
    const turns = Array.from({ length: 11 }, (_, i) =>
      i % 2 === 0 ? u("q") : a("a"),
    );
    expect(await err(req(payload(turns)))).toBe("invalid");
    expect(await err(req(payload([])))).toBe("invalid");
  });

  it("rejects too many turns even when each is valid and alternating (ending user)", async () => {
    const turns = Array.from({ length: 13 }, (_, i) =>
      i % 2 === 0 ? u("q") : a("a"),
    );
    expect(await err(req(payload(turns)))).toBe("invalid");
  });

  it("rejects empty content", async () => {
    expect(await err(req(payload([u("")])))).toBe("invalid");
    expect(await err(req(payload([u("q"), a(""), u("q")])))).toBe("invalid");
  });

  it("rejects first/last assistant turns and repeated roles", async () => {
    expect(await err(req(payload([a("hi"), u("q")])))).toBe("invalid");
    expect(await err(req(payload([u("q"), a("a")])))).toBe("invalid");
    expect(await err(req(payload([a("a")])))).toBe("invalid");
    expect(await err(req(payload([u("q"), u("r")])))).toBe("invalid");
    expect(await err(req(payload([u("q"), a("a"), a("b"), u("r")])))).toBe(
      "invalid",
    );
  });

  it("rejects unknown top-level keys", async () => {
    for (const key of ["system", "model", "max_tokens", "tools", "stream"]) {
      expect(await err(req(payload([u("hi")], { [key]: "x" })))).toBe(
        "invalid",
      );
    }
  });

  it("rejects unknown keys inside a turn", async () => {
    expect(
      await err(req(payload([{ role: "user", content: "hi", name: "x" }]))),
    ).toBe("invalid");
    expect(
      await err(
        req(
          payload([
            { role: "user", content: "hi", cache_control: { type: "x" } },
          ]),
        ),
      ),
    ).toBe("invalid");
  });

  it("rejects content blocks and other wrong types", async () => {
    expect(
      await err(
        req(
          payload([{ role: "user", content: [{ type: "text", text: "hi" }] }]),
        ),
      ),
    ).toBe("invalid");
    expect(await err(req(payload([{ role: "user", content: 5 }])))).toBe(
      "invalid",
    );
    expect(await err(req(payload([{ role: "user", content: null }])))).toBe(
      "invalid",
    );
    expect(await err(req({ messages: "hi", sessionId: SESSION }))).toBe(
      "invalid",
    );
    expect(await err(req({ messages: {}, sessionId: SESSION }))).toBe(
      "invalid",
    );
    expect(
      await err(req({ messages: [u("hi")], sessionId: 12345678 } as never)),
    ).toBe("invalid");
    expect(await err(req({ messages: [u("hi")] }))).toBe("invalid");
    expect(await err(req({ sessionId: SESSION }))).toBe("invalid");
    expect(await err(req(payload([{ role: 1, content: "hi" }])))).toBe(
      "invalid",
    );
    expect(await err(req(payload(["hi"] as never)))).toBe("invalid");
  });

  it("rejects bad roles", async () => {
    expect(await err(req(payload([{ role: "system", content: "hi" }])))).toBe(
      "invalid",
    );
    expect(await err(req(payload([{ role: "tool", content: "hi" }])))).toBe(
      "invalid",
    );
    expect(await err(req(payload([{ role: "User", content: "hi" }])))).toBe(
      "invalid",
    );
  });

  it("rejects whitespace-only content", async () => {
    for (const s of [" ", "   ", "\n\t \n", "\u00A0", "\u2003"]) {
      expect(await err(req(payload([u(s)])))).toBe("invalid");
    }
    expect(await err(req(payload([u("q"), a("  "), u("q")])))).toBe("invalid");
  });

  it("rejects NUL and other C0 controls but not newline/tab", async () => {
    expect(
      await err(
        req(
          '{"messages":[{"role":"user","content":"a\\u0000b"}],"sessionId":"' +
            SESSION +
            '"}',
        ),
      ),
    ).toBe("invalid");
    for (const code of [0x01, 0x07, 0x08, 0x0b, 0x0c, 0x0d, 0x1b, 0x1f, 0x7f]) {
      const s = `a${String.fromCharCode(code)}b`;
      expect(await err(req(payload([u(s)])))).toBe("invalid");
    }
    expect(await err(req(payload([u("q"), a("a\u0000"), u("q")])))).toBe(
      "invalid",
    );
  });

  it("rejects lone surrogates (high, low) but accepts valid pairs", async () => {
    const raw = (s: string) =>
      `{"messages":[{"role":"user","content":"${s}"}],"sessionId":"${SESSION}"}`;
    expect(await err(req(raw("a\\ud800b")))).toBe("invalid");
    expect(await err(req(raw("a\\udc00b")))).toBe("invalid");
    expect(await err(req(raw("\\ud800")))).toBe("invalid");
    expect((await parseChatRequest(req(raw("\\ud83d\\ude00")))).ok).toBe(true);
  });

  it("rejects bad sessionIds", async () => {
    const bad = [
      "../x",
      "a".repeat(65),
      "short",
      "has space1",
      "bad/slash1",
      "emoji😀12345",
      "",
      "a\nb12345678",
    ];
    for (const sessionId of bad) {
      expect(await err(req({ messages: [u("hi")], sessionId }))).toBe(
        "invalid",
      );
    }
  });

  it("accepts sessionId boundaries (8 and 64 chars, - and _)", async () => {
    for (const sessionId of ["a-b_c123", "A".repeat(64)]) {
      expect(
        (await parseChatRequest(req({ messages: [u("hi")], sessionId }))).ok,
      ).toBe(true);
    }
  });

  it("returns the limits as documented", () => {
    expect(LIMITS).toEqual({
      maxBodyBytes: 8192,
      maxTurns: 10,
      maxUserChars: 500,
      maxAssistantChars: 1500,
      maxSessionIdChars: 64,
    });
  });
});

describe("parseChatRequest: invisible and control content", () => {
  const bad = [
    "\u200B",
    "\u200B\u200B \uFEFF",
    "hi\u202Ethere",
    "a\u2066b",
    "x\u0085y",
    "\u00AD",
    "a\u200Eb",
    "a\u061Cb",
  ];
  it.each(bad)("rejects user content %j", async (content) => {
    expect(await err(req(payload([u(content)])))).toBe("invalid");
  });
  it.each(bad)("rejects a prior user turn %j", async (content) => {
    expect(await err(req(payload([u(content), a("ok"), u("hi")])))).toBe(
      "invalid",
    );
  });
  const good = [
    "hi",
    "\u{1F469}\u200D\u{1F4BB} hello",
    "¿Qué hace Anderson?",
    "日本語",
  ];
  it.each(good)("accepts user content %j", async (content) => {
    const r = await parseChatRequest(req(payload([u(content)])));
    expect(r.ok).toBe(true);
  });
  it("accepts an assistant turn containing U+200B", async () => {
    const r = await parseChatRequest(
      req(payload([u("hi"), a("ok\u200Bay"), u("more")])),
    );
    expect(r.ok).toBe(true);
  });
});

// P4-15 / S-03 (F-IN-1): empty means nothing left after removing \s, every
// Default_Ignorable code point and U+2800.
describe("parseChatRequest: invisible-only user turns (Default_Ignorable)", () => {
  const invisible = [
    ["U+2800 braille blank", "⠀"],
    ["U+3164 Hangul filler", "ㅤ"],
    ["U+FFA0 halfwidth Hangul filler", "ﾠ"],
    ["U+115F Hangul choseong filler", "ᅟ"],
    ["U+034F combining grapheme joiner", "͏"],
    ["U+180E Mongolian vowel separator", "᠎"],
    ["U+2061-2064 invisible operators", "⁡⁢⁣⁤"],
    ["U+FE0F variation selector", "️"],
    ["U+E0100 variation selector supplement", "\u{E0100}"],
    ["U+1D173 musical format", "\u{1D173}"],
    ["tag characters", "\u{E0001}\u{E0068}\u{E0069}\u{E007F}"],
    ["a mix with spaces", " ⠀ ㅤ\t​\n"],
  ] as const;
  it.each(invisible)("rejects a user turn of only %s", async (_n, content) => {
    expect(await err(req(payload([u(content)])))).toBe("invalid");
  });
  it.each(invisible)(
    "accepts an assistant turn of only %s (user-only rule)",
    async (_n, content) => {
      const r = await parseChatRequest(
        req(payload([u("hi"), a(content), u("more")])),
      );
      expect(r.ok).toBe(true);
    },
  );
  it.each([
    ["visible text after U+2800", "⠀hi"],
    ["a ZWJ emoji sequence alone", "\u{1F469}‍\u{1F4BB}"],
    ["a flag emoji alone", "\u{1F1FA}\u{1F1F8}"],
    ["a keycap emoji alone", "1️⃣"],
    ["a single CJK character", "中"],
  ])("accepts a user turn with %s", async (_n, content) => {
    const r = await parseChatRequest(req(payload([u(content)])));
    expect(r.ok).toBe(true);
  });
});

describe("parseChatRequest: error results never echo input", () => {
  const SENTINEL = "SENTINEL_9f3a7c";

  it("leaks nothing for any error path", async () => {
    const cases: Request[] = [
      req(payload([u(SENTINEL)]), { method: "GET" }),
      req(payload([u(SENTINEL)]), {
        headers: { "content-type": "text/plain" },
      }),
      req(payload([u(SENTINEL)]), {
        headers: { origin: `https://${SENTINEL}.example` },
      }),
      req(`{"${SENTINEL}":`),
      req(payload([u(SENTINEL + "\u0000")])),
      req(payload([u(SENTINEL)], { [SENTINEL]: SENTINEL })),
      req(payload([u(SENTINEL), u(SENTINEL)])),
      req({ messages: [u("hi")], sessionId: SENTINEL + "/../" }),
      req(
        JSON.stringify({ ...payload([u("hi")]), pad: SENTINEL.repeat(1000) }),
      ),
      req(payload([u(SENTINEL)]), { headers: { "content-length": "999999" } }),
    ];
    for (const c of cases) {
      const r = await parseChatRequest(c);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(SENTINEL);
      if (!r.ok) {
        expect(Object.keys(r)).toEqual(["ok", "error"]);
        expect([
          "method",
          "content_type",
          "too_large",
          "malformed",
          "invalid",
          "origin",
        ]).toContain(r.error);
      }
    }
  });
});
