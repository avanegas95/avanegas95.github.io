import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "astro/zod";
import type { ChatEvent, ErrorBody } from "../../src/lib/chat-events";
import {
  ChatEventSchema,
  ErrorBodySchema,
  SSE_HEADERS,
  encodeEvent,
  errorResponse,
} from "../../src/lib/server/sse";

const events: ChatEvent[] = [
  { event: "mood", data: { mood: "excited" } },
  { event: "delta", data: { text: "Hi" } },
  { event: "reset", data: {} },
  { event: "done", data: { usageBucket: "warm" } },
  { event: "error", data: { code: "unavailable" } },
];

function parse(frame: string): unknown {
  const m = /^event: (\w+)\ndata: (.*)\n\n$/.exec(frame);
  if (!m) throw new Error("bad frame");
  return { event: m[1], data: JSON.parse(m[2]!) };
}

describe("encodeEvent", () => {
  for (const e of events) {
    it(`round-trips ${e.event}`, () => {
      const frame = encodeEvent(e);
      expect(frame.startsWith(`event: ${e.event}\ndata: `)).toBe(true);
      expect(ChatEventSchema.parse(parse(frame))).toEqual(e);
    });
  }

  it("keeps newlines in delta text on one data line", () => {
    const frame = encodeEvent({ event: "delta", data: { text: "a\nb\r\nc" } });
    expect(frame.split("\n")).toHaveLength(4); // event, data, "", ""
    expect(parse(frame)).toEqual({
      event: "delta",
      data: { text: "a\nb\r\nc" },
    });
  });

  it("throws on invalid payloads", () => {
    const bad = (x: unknown) => () => encodeEvent(x as ChatEvent);
    expect(bad({ event: "mood", data: { mood: "sleepy" } })).toThrow();
    expect(bad({ event: "error", data: { code: "nope" } })).toThrow();
    expect(bad({ event: "delta", data: { text: "x", extra: 1 } })).toThrow();
    expect(bad({ event: "reset", data: { x: 1 } })).toThrow();
    expect(bad({ event: "done", data: { usageBucket: "cold" } })).toThrow();
    expect(bad({ event: "bogus", data: {} })).toThrow();
    expect(bad({ event: "delta", data: { text: "x" }, extra: 1 })).toThrow();
  });
});

describe("SSE_HEADERS", () => {
  it("is exact", () => {
    expect(SSE_HEADERS).toEqual({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    });
  });
});

describe("schema types", () => {
  it("match the contract types exactly", () => {
    expectTypeOf<z.output<typeof ChatEventSchema>>().toEqualTypeOf<ChatEvent>();
    expectTypeOf<z.output<typeof ErrorBodySchema>>().toEqualTypeOf<ErrorBody>();
  });
});

describe("errorResponse", () => {
  it("cannot be overridden by differently-cased extra headers", () => {
    const res = errorResponse("bot", 403, {
      "content-type": "text/html",
      "CACHE-CONTROL": "public",
      "Retry-After": "30",
    });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("sets status, headers and body", async () => {
    const res = errorResponse("rate_limited", 429, { "retry-after": "5" });
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe("5");
    const body = await res.json();
    expect(body).toEqual({ error: { code: "rate_limited" } });
    expect(ErrorBodySchema.parse(body)).toEqual(body);
  });

  it("extra headers cannot override content-type", () => {
    const res = errorResponse("bot", 403, { "content-type": "text/html" });
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("ErrorBodySchema rejects unknown codes and extra keys", () => {
    expect(() => ErrorBodySchema.parse({ error: { code: "x" } })).toThrow();
    expect(() =>
      ErrorBodySchema.parse({ error: { code: "bot" }, extra: 1 }),
    ).toThrow();
  });
});

describe("chat-events.ts", () => {
  it("has no runtime imports", () => {
    const src = readFileSync("src/lib/chat-events.ts", "utf8");
    const lines = src
      .split("\n")
      .filter((l) => /^\s*(import|export)\b/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^\s*(import|export) type\b/);
    expect(src).not.toMatch(/zod|server\//);
  });
});
