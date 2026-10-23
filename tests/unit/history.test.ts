import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  CLIENT_LIMITS,
  buildRequest,
  newSessionId,
  type Turn,
} from "../../src/scripts/blob/history";

// The server half (src/lib/server/input.ts) lands with P5-03b. Until it is merged, the
// cross-checks against it are skipped and LIMITS falls back to the SCOPE section 6.1 values;
// they switch on automatically once the module exists.
const SERVER_INPUT = new URL("../../src/lib/server/input.ts", import.meta.url);
type ServerInput = {
  LIMITS: {
    maxTurns: number;
    maxUserChars: number;
    maxAssistantChars: number;
    maxBodyBytes: number;
    maxSessionIdChars: number;
  };
  parseChatRequest: (r: Request) => Promise<unknown>;
};
const server = existsSync(SERVER_INPUT)
  ? ((await import(/* @vite-ignore */ SERVER_INPUT.href)) as ServerInput)
  : undefined;
const LIMITS = server?.LIMITS ?? {
  maxTurns: 10,
  maxUserChars: 500,
  maxAssistantChars: 1500,
  maxBodyBytes: 8192,
  maxSessionIdChars: 64,
};
const parseChatRequest = (r: Request): Promise<{ ok: boolean }> =>
  server!.parseChatRequest(r) as Promise<{ ok: boolean }>;
const itServer = it.skipIf(!server);

const SID = "session_1234";
const bytes = (s: string): number => new TextEncoder().encode(s).byteLength;
const cp = (s: string): number => [...s].length;

function alternating(n: number, text = (i: number) => `turn ${i}`): Turn[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: text(i),
  }));
}

function serverRequest(body: string): Request {
  return new Request("https://avanegas.com/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://avanegas.com",
    },
    body,
  });
}

describe("CLIENT_LIMITS", () => {
  it("matches the server LIMITS", () => {
    expect(CLIENT_LIMITS).toEqual({
      maxTurns: LIMITS.maxTurns,
      maxUserChars: LIMITS.maxUserChars,
      maxAssistantChars: LIMITS.maxAssistantChars,
      maxBodyBytes: LIMITS.maxBodyBytes,
    });
  });
});

describe("newSessionId", () => {
  it("matches the server session id rule and is unique", () => {
    const ids = new Set(Array.from({ length: 50 }, newSessionId));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(id.length).toBeLessThanOrEqual(LIMITS.maxSessionIdChars);
    }
  });
});

describe("buildRequest", () => {
  it("keeps the newest turns, starting and ending with user, within maxTurns", () => {
    // 13 turns: user … user. A valid request has an odd length, so at most 9 fit in 10.
    const history = alternating(13);
    const r = buildRequest(history, SID)!;
    expect(r.turns.length).toBeLessThanOrEqual(CLIENT_LIMITS.maxTurns);
    expect(r.turns).toHaveLength(9);
    expect(r.turns[0]!.role).toBe("user");
    expect(r.turns.at(-1)).toEqual({ role: "user", content: "turn 12" });
    expect(r.turns).toEqual(history.slice(4));
  });

  it("returns null when the history ends with an assistant turn (12 alternating)", () => {
    expect(buildRequest(alternating(12), SID)).toBeNull();
  });

  it("body is exactly messages + sessionId", () => {
    const r = buildRequest(alternating(3), SID)!;
    expect(JSON.parse(r.body)).toEqual({ messages: r.turns, sessionId: SID });
    expect(Object.keys(JSON.parse(r.body) as object)).toEqual([
      "messages",
      "sessionId",
    ]);
  });

  it("cuts a 2,000-char assistant turn to 1,500", () => {
    const history: Turn[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "a".repeat(2000) },
      { role: "user", content: "more" },
    ];
    const r = buildRequest(history, SID)!;
    expect(r.turns[1]!.content).toBe("a".repeat(1500));
  });

  it("cuts by code points without splitting surrogate pairs", () => {
    const history: Turn[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "😀".repeat(1600) },
      { role: "user", content: "more" },
    ];
    const r = buildRequest(history, SID)!;
    expect(r.turns[1]!.content).toBe("😀".repeat(1500));
  });

  it("drops the oldest pairs until the body fits in maxBodyBytes", () => {
    const history = alternating(11, () => "😀".repeat(500)); // 2,000 bytes each
    const r = buildRequest(history, SID)!;
    expect(bytes(r.body)).toBeLessThanOrEqual(CLIENT_LIMITS.maxBodyBytes);
    expect(r.turns).toHaveLength(3);
    expect(r.turns[0]!.role).toBe("user");
    expect(r.turns.at(-1)!.role).toBe("user");
  });

  itServer(
    "10+ turns of 500 multibyte chars still form a valid request",
    async () => {
      const history = alternating(11, (i) => (i % 2 ? "é" : "日").repeat(500));
      const r = buildRequest(history, SID)!;
      expect(bytes(r.body)).toBeLessThanOrEqual(8192);
      const parsed = await parseChatRequest(serverRequest(r.body));
      expect(parsed.ok).toBe(true);
    },
  );

  it("drops a leading assistant turn", () => {
    const history: Turn[] = [
      { role: "assistant", content: "Hi, I'm Blob!" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(buildRequest(history, SID)!.turns).toEqual(history.slice(1));
  });

  it("stops at a broken alternation and keeps the newer run", () => {
    const history: Turn[] = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ];
    expect(buildRequest(history, SID)!.turns).toEqual(history.slice(1));
  });

  it("stops at an empty assistant turn (e.g. an interrupted reply)", () => {
    const history: Turn[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "   " },
      { role: "user", content: "b" },
    ];
    expect(buildRequest(history, SID)!.turns).toEqual([
      { role: "user", content: "b" },
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace", " \n\t "],
    ["501 chars", "x".repeat(501)],
  ])("returns null for a %s last user turn", (_, content) => {
    expect(buildRequest([{ role: "user", content }], SID)).toBeNull();
  });

  it("returns null for an empty history", () => {
    expect(buildRequest([], SID)).toBeNull();
  });

  it("accepts a 500-char last user turn and trims it", () => {
    const r = buildRequest(
      [{ role: "user", content: `  ${"ü".repeat(500)}  ` }],
      SID,
    )!;
    expect(r.turns[0]!.content).toBe("ü".repeat(500));
  });

  itServer("cleans characters the server would reject", async () => {
    const history: Turn[] = [
      { role: "user", content: "a\r\nb\rc\u0000d\u007f\uD800e" },
    ];
    const r = buildRequest(history, SID)!;
    expect(r.turns[0]!.content).toBe("a\nb\ncd�e");
    expect((await parseChatRequest(serverRequest(r.body))).ok).toBe(true);
  });

  it("does not mutate its input", () => {
    const history = alternating(13);
    const copy = structuredClone(history);
    buildRequest(history, SID);
    expect(history).toEqual(copy);
  });
});

describe("buildRequest × server parseChatRequest (randomised)", () => {
  // Deterministic PRNG (mulberry32) so failures reproduce.
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ALPHABET = [
    "a",
    "Z",
    "0",
    " ",
    "\n",
    "\t",
    "\r",
    "\r\n",
    "\u0000",
    "\u001b",
    "\u007f",
    "é",
    "é",
    "日",
    "😀",
    "\uD83D",
    "\uDE00",
    "क़",
    " ",
    '"',
    "\\",
    "<",
    "ﬁ",
    "﻿",
  ];

  itServer(
    "every non-null body is accepted by the server, unchanged",
    async () => {
      const rand = rng(0xb10b);
      const pick = <T>(xs: readonly T[]): T =>
        xs[Math.floor(rand() * xs.length)]!;
      let accepted = 0;
      for (let n = 0; n < 400; n++) {
        const len = Math.floor(rand() * 16);
        const history: Turn[] = [];
        for (let i = 0; i < len; i++) {
          const alt = rand() < 0.9;
          const role: Turn["role"] = alt
            ? i % 2 === 0
              ? "user"
              : "assistant"
            : pick(["user", "assistant"] as const);
          const size = Math.floor(rand() * (rand() < 0.2 ? 2200 : 300));
          let content = "";
          for (let k = 0; k < size; k++) content += pick(ALPHABET);
          history.push({ role, content });
        }
        if (rand() < 0.7) history.push({ role: "user", content: "hello?" });

        const r = buildRequest(history, newSessionId());
        if (r === null) continue;
        accepted++;
        expect(bytes(r.body)).toBeLessThanOrEqual(CLIENT_LIMITS.maxBodyBytes);
        expect(r.turns.length).toBeLessThanOrEqual(CLIENT_LIMITS.maxTurns);
        for (const t of r.turns) {
          expect(cp(t.content)).toBeLessThanOrEqual(
            t.role === "user"
              ? CLIENT_LIMITS.maxUserChars
              : CLIENT_LIMITS.maxAssistantChars,
          );
        }
        const parsed = await parseChatRequest(serverRequest(r.body));
        expect(parsed).toEqual({
          ok: true,
          value: { messages: r.turns, sessionId: JSON.parse(r.body).sessionId },
        });
      }
      expect(accepted).toBeGreaterThan(150);
    },
  );
});
