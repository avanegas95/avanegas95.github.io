import { afterEach, describe, expect, it, vi } from "vitest";
import { SSE_HEADERS, encodeEvent } from "../../src/lib/server/sse";
import type { ChatEvent } from "../../src/lib/chat-events";
import {
  createSseParser,
  streamChat,
  toChatEvent,
  type StreamHandlers,
} from "../../src/scripts/blob/chat-client";

const enc = new TextEncoder();
const SSE = SSE_HEADERS;

type Call = [string, ...unknown[]];
function recorder(): {
  h: StreamHandlers;
  calls: Call[];
  terminals: () => number;
} {
  const calls: Call[] = [];
  const h: StreamHandlers = {
    onMood: (m) => calls.push(["mood", m]),
    onDelta: (t) => calls.push(["delta", t]),
    onReset: () => calls.push(["reset"]),
    onDone: (b) => calls.push(["done", b]),
    onError: (c) => calls.push(["error", c]),
  };
  const terminals = (): number =>
    calls.filter(([k]) => k === "done" || k === "error").length;
  return { h, calls, terminals };
}

function streamOf(
  chunks: (string | Uint8Array)[],
  opts: { close?: boolean } = {},
): ReadableStream<Uint8Array> & { cancelled: () => boolean } {
  let cancelled = false;
  const s = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks)
        c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      if (opts.close !== false) c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return Object.assign(s, { cancelled: () => cancelled });
}

function fakeFetch(
  res: Response | (() => Promise<Response>),
): typeof fetch & { calls: [RequestInfo | URL, RequestInit | undefined][] } {
  const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init]);
    return typeof res === "function" ? res() : Promise.resolve(res);
  }) as typeof fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}

const sseResponse = (
  chunks: (string | Uint8Array)[],
  headers = SSE,
): Response => new Response(streamOf(chunks), { status: 200, headers });

const frames = (...events: ChatEvent[]): string =>
  events.map(encodeEvent).join("");

const HAPPY = frames(
  { event: "mood", data: { mood: "excited" } },
  { event: "delta", data: { text: "Anderson tests 🧪 " } },
  { event: "delta", data: { text: "things — a lot.\nReally." } },
  { event: "done", data: { usageBucket: "warm" } },
);
const HAPPY_CALLS: Call[] = [
  ["mood", "excited"],
  ["delta", "Anderson tests 🧪 "],
  ["delta", "things — a lot.\nReally."],
  ["done", "warm"],
];

async function run(
  res: Response | (() => Promise<Response>),
  opts: Parameters<typeof streamChat>[2] = {},
): Promise<{
  calls: Call[];
  terminals: number;
  fetch: ReturnType<typeof fakeFetch>;
}> {
  const r = recorder();
  const f = fakeFetch(res);
  await streamChat("{}", r.h, { fetchImpl: f, ...opts });
  return { calls: r.calls, terminals: r.terminals(), fetch: f };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createSseParser", () => {
  it("parses LF, CRLF and CR line endings identically", () => {
    const lf = "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n";
    const want = [
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ];
    expect(createSseParser().push(lf)).toEqual(want);
    expect(createSseParser().push(lf.replace(/\n/g, "\r\n"))).toEqual(want);
    expect(createSseParser().push(lf.replace(/\n/g, "\r"))).toEqual(want);
  });

  it("handles a CRLF split across chunks", () => {
    const p = createSseParser();
    expect(p.push("data: x\r")).toEqual([]);
    expect(p.push("\n\r")).toEqual([{ event: "message", data: "x" }]);
    expect(p.push("\ndata: y\r\n\r\n")).toEqual([
      { event: "message", data: "y" },
    ]);
  });

  it("joins multiple data lines, ignores comments, ids, retry and unknown fields", () => {
    const p = createSseParser();
    const out = p.push(
      ": keep-alive\nid: 7\nretry: 10\nfoo: bar\nevent: delta\ndata:one\ndata: two\ndata\n\n",
    );
    expect(out).toEqual([{ event: "delta", data: "one\ntwo\n" }]);
  });

  it("does not dispatch events without data and resets the event name", () => {
    const p = createSseParser();
    expect(p.push("event: mood\n\ndata: x\n\n")).toEqual([
      { event: "message", data: "x" },
    ]);
  });

  it("holds an incomplete event until its blank line", () => {
    const p = createSseParser();
    expect(p.push("event: delta\nda")).toEqual([]);
    expect(p.push('ta: {"text":"x"}\n')).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "delta", data: '{"text":"x"}' }]);
  });
});

describe("toChatEvent", () => {
  it.each<ChatEvent>([
    { event: "mood", data: { mood: "proud" } },
    { event: "delta", data: { text: "<b>raw</b> [x](javascript:1)" } },
    { event: "reset", data: {} },
    { event: "done", data: { usageBucket: "hot" } },
    { event: "error", data: { code: "unavailable" } },
  ])("accepts $event", (e) => {
    expect(
      toChatEvent({ event: e.event, data: JSON.stringify(e.data) }),
    ).toEqual(e);
  });

  it.each([
    ["mood", '{"mood":"sleepy"}'], // client-only mood
    ["mood", '{"mood":"happy","x":1}'],
    ["mood", '{"mood":1}'],
    ["delta", '{"text":5}'],
    ["delta", '{"text":"a","extra":true}'],
    ["delta", "[]"],
    ["delta", "null"],
    ["delta", "not json"],
    ["reset", '{"a":1}'],
    ["reset", "[]"],
    ["done", '{"usageBucket":"cold"}'],
    ["done", "{}"],
    ["error", '{"code":"network"}'],
    ["error", '{"code":"toString"}'],
    ["error", '{"code":"bot","why":"x"}'],
    ["message", '{"text":"x"}'],
    ["__proto__", "{}"],
  ])("rejects %s %s", (event, data) => {
    expect(toChatEvent({ event, data })).toBeNull();
  });
});

describe("streamChat request", () => {
  it("POSTs the body to /api/chat with the required options", async () => {
    const { fetch: f } = await run(sseResponse([HAPPY]));
    expect(f.calls).toHaveLength(1);
    const [url, init] = f.calls[0]!;
    expect(url).toBe("/api/chat");
    expect(init).toMatchObject({
      method: "POST",
      body: "{}",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
    });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses globalThis.fetch resolved at call time", async () => {
    const r = recorder();
    const f = fakeFetch(sseResponse([HAPPY]));
    vi.stubGlobal("fetch", f);
    await streamChat("{}", r.h);
    expect(f.calls).toHaveLength(1);
    expect(r.calls).toEqual(HAPPY_CALLS);
  });
});

describe("streamChat stream handling", () => {
  it("happy path: mood → deltas → done", async () => {
    const { calls, terminals } = await run(sseResponse([HAPPY]));
    expect(calls).toEqual(HAPPY_CALLS);
    expect(terminals).toBe(1);
  });

  it("every byte split of the fixture yields the same events", async () => {
    const bytes = enc.encode(HAPPY);
    for (let i = 0; i <= bytes.length; i++) {
      const { calls } = await run(
        sseResponse([bytes.slice(0, i), bytes.slice(i)]),
      );
      expect(calls, `split at ${i}`).toEqual(HAPPY_CALLS);
    }
  });

  it("random multi-way splits (CRLF variant) yield the same events", async () => {
    const bytes = enc.encode(
      HAPPY.replace(/\n\n/g, "\r\n\r\n").replace(/\n(?=data|event)/g, "\r\n"),
    );
    let seed = 42;
    const rand = (): number =>
      (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 100; n++) {
      const chunks: Uint8Array[] = [];
      let at = 0;
      while (at < bytes.length) {
        const len = 1 + Math.floor(rand() * 7);
        chunks.push(bytes.slice(at, at + len));
        at += len;
      }
      const { calls } = await run(sseResponse(chunks));
      expect(calls).toEqual(HAPPY_CALLS);
    }
  });

  it("CRLF framing", async () => {
    const { calls } = await run(sseResponse([HAPPY.replace(/\n/g, "\r\n")]));
    // The delta's \n lives inside JSON ("\\n"), so it survives line-ending rewrites.
    expect(calls).toEqual(HAPPY_CALLS);
  });

  it("reset → onReset, then continues", async () => {
    const { calls } = await run(
      sseResponse([
        frames(
          { event: "delta", data: { text: "bad" } },
          { event: "reset", data: {} },
          { event: "delta", data: { text: "good" } },
          { event: "done", data: { usageBucket: "ok" } },
        ),
      ]),
    );
    expect(calls).toEqual([
      ["delta", "bad"],
      ["reset"],
      ["delta", "good"],
      ["done", "ok"],
    ]);
  });

  it("SSE error event → its code, and the reader is cancelled", async () => {
    const body = streamOf(
      [
        frames({ event: "error", data: { code: "unavailable" } }),
        frames({ event: "delta", data: { text: "late" } }),
      ],
      { close: false },
    );
    const { calls, terminals } = await run(
      new Response(body, { status: 200, headers: SSE }),
    );
    expect(calls).toEqual([["error", "unavailable"]]);
    expect(terminals).toBe(1);
    expect(body.cancelled()).toBe(true);
  });

  it("ignores unknown event names and comments", async () => {
    const { calls } = await run(
      sseResponse([": ping\n\nevent: sparkle\ndata: {}\n\n", HAPPY]),
    );
    expect(calls).toEqual(HAPPY_CALLS);
  });

  it("bad mood value → upstream, reader cancelled, nothing after", async () => {
    const body = streamOf(
      [
        'event: mood\ndata: {"mood":"sleepy"}\n\n',
        frames({ event: "delta", data: { text: "x" } }),
      ],
      { close: false },
    );
    const { calls } = await run(
      new Response(body, { status: 200, headers: SSE }),
    );
    expect(calls).toEqual([["error", "upstream"]]);
    expect(body.cancelled()).toBe(true);
  });

  it("truncated stream (no done/error) → upstream", async () => {
    const { calls, terminals } = await run(
      sseResponse([
        frames(
          { event: "mood", data: { mood: "happy" } },
          { event: "delta", data: { text: "Hi" } },
        ),
      ]),
    );
    expect(calls).toEqual([
      ["mood", "happy"],
      ["delta", "Hi"],
      ["error", "upstream"],
    ]);
    expect(terminals).toBe(1);
  });

  it("an unterminated final frame is not dispatched", async () => {
    const { calls } = await run(
      sseResponse(['event: done\ndata: {"usageBucket":"ok"}\n']),
    );
    expect(calls).toEqual([["error", "upstream"]]);
  });

  it("ignores everything after done", async () => {
    const { calls } = await run(
      sseResponse([
        HAPPY,
        frames(
          { event: "delta", data: { text: "late" } },
          { event: "error", data: { code: "bot" } },
        ),
      ]),
    );
    expect(calls).toEqual(HAPPY_CALLS);
  });

  it("a stream that errors mid-read → network", async () => {
    let n = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (n++ === 0)
          c.enqueue(
            enc.encode(frames({ event: "delta", data: { text: "a" } })),
          );
        else c.error(new TypeError("reset"));
      },
    });
    const { calls } = await run(
      new Response(body, { status: 200, headers: SSE }),
    );
    expect(calls).toEqual([
      ["delta", "a"],
      ["error", "network"],
    ]);
  });

  it("a throwing handler still yields exactly one terminal callback", async () => {
    const r = recorder();
    r.h.onDelta = () => {
      throw new Error("ui bug");
    };
    await streamChat("{}", r.h, { fetchImpl: fakeFetch(sseResponse([HAPPY])) });
    expect(r.calls).toEqual([
      ["mood", "excited"],
      ["error", "upstream"],
    ]);
  });
});

describe("streamChat HTTP errors", () => {
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it.each([
    [429, "rate_limited"],
    [503, "budget"],
    [403, "bot"],
    [400, "invalid"],
    [503, "unavailable"],
  ] as const)("%i JSON %s → that code", async (status, code) => {
    const { calls, terminals } = await run(json(status, { error: { code } }));
    expect(calls).toEqual([["error", code]]);
    expect(terminals).toBe(1);
  });

  it.each([
    [
      "500 HTML",
      new Response("<h1>oops</h1>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    ],
    ["unknown code", json(500, { error: { code: "teapot" } })],
    ["extra keys", json(429, { error: { code: "rate_limited" }, retry: 1 })],
    ["empty body", new Response(null, { status: 502 })],
  ])("%s → upstream", async (_, res) => {
    const { calls } = await run(res);
    expect(calls).toEqual([["error", "upstream"]]);
  });

  it("200 with the wrong content-type → upstream", async () => {
    const { calls } = await run(
      new Response(HAPPY, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(calls).toEqual([["error", "upstream"]]);
  });

  it("200 without a content-type → upstream", async () => {
    const res = new Response(streamOf([HAPPY]), { status: 200 });
    res.headers.delete("content-type");
    const { calls } = await run(res);
    expect(calls).toEqual([["error", "upstream"]]);
  });

  it("fetch rejection → network", async () => {
    const { calls } = await run(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect(calls).toEqual([["error", "network"]]);
  });
});

describe("streamChat timeouts and abort", () => {
  it("never-resolving fetch (hung BotID challenge) → network after the first-byte timeout", async () => {
    vi.useFakeTimers();
    const r = recorder();
    let fetchSignal: AbortSignal | undefined;
    const f = ((_: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const done = streamChat("{}", r.h, { fetchImpl: f });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(r.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(r.calls).toEqual([["error", "network"]]);
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("honours a custom first-byte timeout", async () => {
    vi.useFakeTimers();
    const r = recorder();
    const done = streamChat("{}", r.h, {
      fetchImpl: () => new Promise<Response>(() => undefined),
      firstByteTimeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(r.calls).toEqual([["error", "network"]]);
  });

  it("idle stall → network; the timer restarts on every chunk", async () => {
    vi.useFakeTimers();
    const r = recorder();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => void (ctl = c),
    });
    const done = streamChat("{}", r.h, {
      fetchImpl: fakeFetch(new Response(body, { status: 200, headers: SSE })),
    });
    await vi.advanceTimersByTimeAsync(15_000);
    ctl.enqueue(enc.encode(frames({ event: "mood", data: { mood: "happy" } })));
    await vi.advanceTimersByTimeAsync(15_000);
    ctl.enqueue(enc.encode(frames({ event: "delta", data: { text: "a" } })));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(r.calls).toEqual([
      ["mood", "happy"],
      ["delta", "a"],
    ]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(r.calls).toEqual([
      ["mood", "happy"],
      ["delta", "a"],
      ["error", "network"],
    ]);
  });

  it("stalled error body → network", async () => {
    vi.useFakeTimers();
    const r = recorder();
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const done = streamChat("{}", r.h, {
      fetchImpl: fakeFetch(new Response(body, { status: 500 })),
      idleTimeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(r.calls).toEqual([["error", "network"]]);
  });

  it("caller abort while fetch is pending → no callbacks, no throw", async () => {
    vi.useFakeTimers();
    const r = recorder();
    const ac = new AbortController();
    const done = streamChat("{}", r.h, {
      signal: ac.signal,
      fetchImpl: () => new Promise<Response>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    await expect(done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.calls).toEqual([]);
  });

  it("caller abort mid-stream → no further callbacks; reader cancelled", async () => {
    const r = recorder();
    const ac = new AbortController();
    const body = streamOf([frames({ event: "delta", data: { text: "a" } })], {
      close: false,
    });
    r.h.onDelta = (t) => {
      r.calls.push(["delta", t]);
      ac.abort();
    };
    await streamChat("{}", r.h, {
      signal: ac.signal,
      fetchImpl: fakeFetch(new Response(body, { status: 200, headers: SSE })),
    });
    expect(r.calls).toEqual([["delta", "a"]]);
    expect(body.cancelled()).toBe(true);
  });

  it("caller abort while the stream is idle → no callbacks", async () => {
    const r = recorder();
    const ac = new AbortController();
    const body = streamOf(
      [frames({ event: "mood", data: { mood: "curious" } })],
      { close: false },
    );
    const done = streamChat("{}", r.h, {
      signal: ac.signal,
      fetchImpl: fakeFetch(new Response(body, { status: 200, headers: SSE })),
    });
    await new Promise((res) => setTimeout(res, 10));
    ac.abort();
    await done;
    expect(r.calls).toEqual([["mood", "curious"]]);
  });

  it("an already-aborted signal → fetch is never called", async () => {
    const r = recorder();
    const ac = new AbortController();
    ac.abort();
    const f = fakeFetch(sseResponse([HAPPY]));
    await streamChat("{}", r.h, { signal: ac.signal, fetchImpl: f });
    expect(f.calls).toHaveLength(0);
    expect(r.calls).toEqual([]);
  });

  it("fetch rejecting because of the caller's abort → no callbacks", async () => {
    const r = recorder();
    const ac = new AbortController();
    const f = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;
    const done = streamChat("{}", r.h, { signal: ac.signal, fetchImpl: f });
    ac.abort();
    await done;
    expect(r.calls).toEqual([]);
  });
});
