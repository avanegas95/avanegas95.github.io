// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StreamHandlers,
  StreamOptions,
  streamChat,
} from "../../src/scripts/blob/chat-client.ts";
import { attachConversation } from "../../src/scripts/blob/conversation.ts";
import { COPY } from "../../src/scripts/blob/copy.ts";
import {
  BlobAgent as BlobAgentClass,
  defineBlobAgent,
} from "../../src/scripts/blob/element.ts";
import type { BlobAgent } from "../../src/scripts/blob/element.ts";
import {
  ERROR_HOLD_MS,
  SLEEPY_AFTER_MS,
} from "../../src/scripts/blob/mood-state.ts";

const FIGURE = (size: string) =>
  `<div class="blob-figure" data-size="${size}" data-mood="idle" data-talking="false"><svg aria-hidden="true"></svg></div>`;
const EMOJI = /\p{Extended_Pictographic}/u;

// Mirrors the server-rendered markup of BlobAgent.astro (the E2E specs cover the real thing).
const MARKUP = `
<blob-agent>
  <div data-ba="figure">${FIGURE("hero")}</div>
  <form data-ba="form">
    <label for="blob-input">Your question</label>
    <input id="blob-input" data-ba="input" maxlength="500" />
    <button type="submit">Send</button>
  </form>
  <button type="button" data-ba="clear">Clear chat</button>
  <p data-ba="question" hidden></p>
  <div data-ba="bubble" data-phase="idle">
    <div data-ba="answer" aria-live="polite">
      <div data-ba="clip"><p data-ba="greeting">Hi! I'm Blob.</p></div>
    </div>
    <button type="button" data-ba="more" aria-expanded="false" hidden>Show more</button>
    <ul data-ba="starters"><li><button type="button" data-ba="chip">Show me his projects</button></li></ul>
  </div>
  <div data-ba="previous-wrap" hidden>
    <button type="button" data-ba="previous" aria-expanded="false" aria-controls="blob-history">Previous answers</button>
    <ol id="blob-history" data-ba="history" hidden></ol>
  </div>
</blob-agent>`;

type Body = {
  messages: { role: string; content: string }[];
  sessionId: string;
};
type Call = { body: Body; h: StreamHandlers; signal: AbortSignal };

let el: BlobAgent;
let calls: Call[];
let conv: { destroy(): void };

const stream = ((body: string, h: StreamHandlers, opts?: StreamOptions) => {
  calls.push({ body: JSON.parse(body) as Body, h, signal: opts!.signal! });
  return new Promise<void>(() => undefined);
}) as typeof streamChat;

const hero = () =>
  el.querySelector<HTMLElement>('[data-ba="figure"] .blob-figure')!;
const mood = () => hero().dataset["mood"];
const answer = () => el.answer;
const clip = () => el.querySelector<HTMLElement>('[data-ba="clip"]')!;
const question = () => el.querySelector<HTMLElement>('[data-ba="question"]')!;
const phase = () => el.bubble!.phase;
const history = () =>
  el.querySelectorAll<HTMLElement>('[data-ba="history"] > li');
const send = () =>
  el.querySelector<HTMLButtonElement>('[data-ba="form"] button')!;
const last = () => calls[calls.length - 1]!;
// Every assistant reply in the DOM: the current one first, then the archived ones.
const msgs = () => el.querySelectorAll<HTMLElement>('[data-role="assistant"]');
const current = () => clip().querySelector<HTMLElement>(":scope > .ba-msg");
const submit = (text: string) =>
  el.dispatchEvent(
    new CustomEvent("blob:submit", { bubbles: true, detail: { text } }),
  );
const frame = () => vi.advanceTimersByTime(20);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  defineBlobAgent();
  const holder = document.createElement("div");
  holder.innerHTML = MARKUP;
  document.body.replaceChildren(holder);
  el = holder.querySelector("blob-agent") as BlobAgent;
  calls = [];
  conv = attachConversation(el, { stream });
});

afterEach(() => {
  conv.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("submit and stream", () => {
  it("happy path: user turn, thinking, mood, streamed markdown, done", () => {
    submit("  Hello Blob  ");
    expect(calls).toHaveLength(1);
    expect(last().body.messages).toEqual([
      { role: "user", content: "Hello Blob" },
    ]);
    expect(last().body.sessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(question().hidden).toBe(false);
    expect(question().textContent).toBe("Hello Blob");
    expect(phase()).toBe("asking");
    expect(
      clip().querySelector<HTMLElement>('[data-ba="greeting"]')!.hidden,
    ).toBe(true);
    expect(el.querySelector<HTMLElement>('[data-ba="starters"]')!.hidden).toBe(
      true,
    );
    const reply = current()!;
    expect(reply.querySelector(".ba-sr")?.textContent).toBe(COPY.thinking);
    expect(mood()).toBe("thinking");
    expect(send().disabled).toBe(true);
    expect(send().getAttribute("aria-disabled")).toBe("true");

    last().h.onMood("excited");
    expect(mood()).toBe("excited");
    // Moods show through the figure only: no emoji element, badge or glyph anywhere.
    expect(hero().querySelector(".blob-emoji")).toBeNull();
    expect(reply.querySelector(".ba-badge")).toBeNull();
    expect(el.textContent).not.toMatch(EMOJI);

    last().h.onDelta("Hi ");
    expect(hero().dataset["talking"]).toBe("true");
    expect(phase()).toBe("streaming");
    expect(answer().getAttribute("aria-busy")).toBe("true");
    last().h.onDelta("**there**");
    // Rendering is batched to one animation frame.
    expect(reply.querySelector("strong")).toBeNull();
    frame();
    expect(reply.querySelector("strong")?.textContent).toBe("there");
    expect(reply.querySelector(".ba-sr")).toBeNull();
    last().h.onDelta(" <img src=x onerror=alert(1)>");

    last().h.onDone("ok");
    // Done flushes without waiting for a frame.
    expect(reply.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(reply.querySelector("img")).toBeNull();
    expect(answer().getAttribute("aria-busy")).toBe("false");
    expect(phase()).toBe("done");
    expect(hero().dataset["talking"]).toBe("false");
    expect(send().disabled).toBe(false);
    expect(send().hasAttribute("aria-disabled")).toBe(false);
    expect(mood()).toBe("excited");

    submit("And then?");
    expect(phase()).toBe("asking");
    expect(history()).toHaveLength(1); // turn 1 moved behind "Previous"
    expect(history()[0]?.querySelector(".ba-prev-q")?.textContent).toBe(
      "Hello Blob",
    );
    expect(calls).toHaveLength(2);
    expect(last().body.messages).toEqual([
      { role: "user", content: "Hello Blob" },
      {
        role: "assistant",
        content: "Hi **there** <img src=x onerror=alert(1)>",
      },
      { role: "user", content: "And then?" },
    ]);
    expect(last().body.sessionId).toBe(calls[0]!.body.sessionId);
  });

  it("first delta without a mood falls back to happy, still with no badge", () => {
    submit("hi");
    last().h.onDelta("Hey");
    expect(mood()).toBe("happy");
    expect(msgs()[0]?.querySelector(".ba-badge")).toBeNull();
  });

  it("reset mid-stream keeps only post-reset text in the DOM and history", () => {
    submit("q1");
    last().h.onMood("happy");
    last().h.onDelta("Draft text that gets scrubbed.");
    frame();
    const reply = msgs()[0]!;
    expect(reply.textContent).toContain("Draft");
    last().h.onReset();
    expect(reply.textContent).not.toContain("Draft");
    last().h.onMood("curious");
    last().h.onDelta("Let's try that again.");
    last().h.onDone("ok");
    expect(reply.textContent).toContain("Let's try that again.");
    expect(reply.textContent).not.toContain("Draft");
    submit("q2");
    expect(last().body.messages[1]).toEqual({
      role: "assistant",
      content: "Let's try that again.",
    });
  });

  it("ignores a submit while busy and empty submits", () => {
    submit("one");
    submit("two");
    submit("   ");
    expect(calls).toHaveLength(1);
    expect(question().textContent).toBe("one");
    last().h.onDone("ok");
    submit("   ");
    expect(calls).toHaveLength(1);
  });

  it("shows the invalid copy without calling the API when buildRequest fails", () => {
    submit("x".repeat(501));
    expect(calls).toHaveLength(0);
    expect(msgs()[0]?.textContent).toContain(COPY.errors.invalid.text);
    expect(mood()).toBe("error");
    expect(phase()).toBe("error");
    expect(send().disabled).toBe(false);
  });

  it("aria-busy, talking and handlers stop after done", () => {
    submit("hi");
    const h = last().h;
    h.onDelta("a");
    h.onDone("ok");
    h.onDelta("late");
    h.onError("upstream");
    frame();
    expect(msgs()[0]?.textContent).toBe("a");
    expect(answer().getAttribute("aria-busy")).toBe("false");
  });
});

describe("errors", () => {
  const codes = [
    "rate_limited",
    "budget",
    "bot",
    "upstream",
    "invalid",
    "unavailable",
    "network",
  ] as const;

  for (const code of codes) {
    it(`${code}: copy, error mood for ${ERROR_HOLD_MS} ms, user turn dropped`, () => {
      submit("first");
      last().h.onMood("proud");
      last().h.onDelta("Answer one.");
      last().h.onDone("ok");

      submit("second");
      last().h.onDelta("partial");
      last().h.onError(code);
      const reply = current()!;
      expect(history()).toHaveLength(1);
      expect(phase()).toBe("error");
      expect(reply.dataset["error"]).toBe("true");
      const copy = COPY.errors[code];
      expect(reply.textContent).toContain(copy.text);
      expect(reply.textContent).not.toContain("partial");
      const links = reply.querySelectorAll("a");
      if (copy.link) {
        expect(links).toHaveLength(1);
        expect(links[0]?.getAttribute("href")).toBe("#contact");
      } else {
        expect(links).toHaveLength(0);
      }
      expect(mood()).toBe("error");
      expect(reply.textContent).not.toMatch(EMOJI);
      expect(answer().getAttribute("aria-busy")).toBe("false");
      expect(hero().dataset["talking"]).toBe("false");
      expect(send().disabled).toBe(false);
      vi.advanceTimersByTime(ERROR_HOLD_MS - 1);
      expect(mood()).toBe("error");
      vi.advanceTimersByTime(1);
      // Resting = the failed reply's mood (firstDelta set happy).
      expect(mood()).toBe("happy");

      submit("third");
      expect(last().body.messages).toEqual([
        { role: "user", content: "first" },
        { role: "assistant", content: "Answer one." },
        { role: "user", content: "third" },
      ]);
    });
  }

  it("an error before any reply rests on idle", () => {
    submit("hi");
    last().h.onError("rate_limited");
    expect(mood()).toBe("error");
    vi.advanceTimersByTime(ERROR_HOLD_MS);
    expect(mood()).toBe("idle");
    submit("again");
    expect(last().body.messages).toEqual([{ role: "user", content: "again" }]);
  });
});

describe("empty reply", () => {
  for (const [name, deltas] of [
    ["no deltas", []],
    ["whitespace-only deltas", ["  ", "\n", " \t"]],
  ] as const) {
    it(`done with ${name}: error copy instead of an empty bubble, history unchanged`, () => {
      submit("first");
      last().h.onDelta("Answer one.");
      last().h.onDone("ok");

      submit("second");
      for (const d of deltas) last().h.onDelta(d);
      frame();
      last().h.onDone("ok");
      const reply = current()!;
      expect(reply.querySelector(".ba-text")?.textContent).toBe(
        COPY.errors.upstream.text,
      );
      expect(reply.dataset["error"]).toBe("true");
      expect(mood()).toBe("error");
      expect(answer().getAttribute("aria-busy")).toBe("false");
      expect(send().disabled).toBe(false);

      submit("third");
      expect(last().body.messages).toEqual([
        { role: "user", content: "first" },
        { role: "assistant", content: "Answer one." },
        { role: "user", content: "third" },
      ]);
    });
  }

  it("a normal reply is unaffected", () => {
    submit("hi");
    last().h.onDelta("Hello!");
    last().h.onDone("ok");
    expect(msgs()[0]?.textContent).toContain("Hello!");
    expect(msgs()[0]?.dataset["error"]).toBeUndefined();
    expect(phase()).toBe("done");
    expect(mood()).not.toBe("error");
  });
});

describe("clamp and Show more", () => {
  const more = () => el.querySelector<HTMLButtonElement>('[data-ba="more"]')!;
  // happy-dom has no layout: fake the metrics the clamp reads.
  const metrics = (scroll: number, client: number) => {
    Object.defineProperty(clip(), "scrollHeight", {
      configurable: true,
      get: () => scroll,
    });
    Object.defineProperty(clip(), "clientHeight", {
      configurable: true,
      get: () => client,
    });
  };

  it("short answers show no button; long ones show it and expand in place", () => {
    submit("hi");
    metrics(100, 100);
    last().h.onDelta("short");
    frame();
    expect(more().hidden).toBe(true);
    metrics(900, 448);
    last().h.onDelta(" and then much longer");
    frame();
    expect(more().hidden).toBe(false);
    expect(more().textContent).toBe(COPY.showMore);
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect(clip().dataset["clamped"]).toBe("true");
    more().click();
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(more().textContent).toBe(COPY.showLess);
    expect(clip().dataset["expanded"]).toBe("true");
    more().click();
    expect(clip().dataset["expanded"]).toBe("false");
  });

  it("a new question collapses it again, and nothing scrolls", () => {
    submit("hi");
    metrics(900, 448);
    last().h.onDelta("long");
    last().h.onDone("ok");
    more().click();
    metrics(100, 100);
    submit("next");
    expect(clip().dataset["expanded"]).toBe("false");
    expect(more().hidden).toBe(true);
    expect(clip().scrollTop).toBe(0);
  });
});

describe("previous turns", () => {
  const toggle = () =>
    el.querySelector<HTMLButtonElement>('[data-ba="previous"]')!;
  const list = () => el.querySelector<HTMLElement>('[data-ba="history"]')!;
  const wrap = () =>
    el.querySelector<HTMLElement>('[data-ba="previous-wrap"]')!;
  const ask = (q: string, a: string) => {
    submit(q);
    last().h.onDelta(a);
    last().h.onDone("ok");
  };

  it("hides the control until a turn is archived, then toggles aria-expanded", () => {
    expect(wrap().hidden).toBe(true);
    ask("q1", "answer one");
    expect(wrap().hidden).toBe(true); // the latest turn is the bubble itself
    ask("q2", "answer two");
    expect(wrap().hidden).toBe(false);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(list().hidden).toBe(true);
    toggle().click();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(list().hidden).toBe(false);
    expect(list().textContent).toContain("q1");
    expect(list().textContent).toContain("answer one");
    expect(current()?.textContent).toContain("answer two");
    toggle().click();
    expect(list().hidden).toBe(true);
  });

  it("keeps at most the last 10 turns and drops failed ones", () => {
    for (let i = 1; i <= 12; i++) ask(`q${i}`, `a${i}`);
    submit("last");
    last().h.onDelta("a13");
    last().h.onDone("ok");
    expect(history()).toHaveLength(9);
    expect(history()[0]?.textContent).toContain("q4");
    expect(history()[8]?.textContent).toContain("a12");
    expect(current()?.textContent).toBe("a13");

    submit("bad");
    last().h.onError("upstream");
    submit("after");
    expect(history()).toHaveLength(9); // the failed turn was not archived
    expect(list().textContent).not.toContain("bad");
  });
});

describe("clear chat", () => {
  it("aborts the stream, empties the log, resets history and session", () => {
    submit("q1");
    last().h.onDelta("one");
    last().h.onDone("ok");
    submit("q2");
    const inflight = last();
    inflight.h.onMood("excited");
    inflight.h.onDelta("streaming");
    const firstSession = inflight.body.sessionId;
    (document.activeElement as HTMLElement | null)?.blur();

    el.querySelector<HTMLButtonElement>('[data-ba="clear"]')!.click();
    expect(inflight.signal.aborted).toBe(true);
    expect(msgs()).toHaveLength(0);
    expect(phase()).toBe("idle");
    expect(question().hidden).toBe(true);
    expect(
      clip().querySelector<HTMLElement>('[data-ba="greeting"]')!.hidden,
    ).toBe(false);
    expect(el.querySelector<HTMLElement>('[data-ba="starters"]')!.hidden).toBe(
      false,
    );
    expect(
      el.querySelector<HTMLElement>('[data-ba="previous-wrap"]')!.hidden,
    ).toBe(true);
    expect(mood()).toBe("idle");
    expect(answer().getAttribute("aria-busy")).toBe("false");
    expect(hero().dataset["talking"]).toBe("false");
    expect(send().disabled).toBe(false);
    expect(document.activeElement).toBe(el.input);

    // A late callback from the aborted stream changes nothing.
    inflight.h.onDelta("late");
    inflight.h.onDone("ok");
    frame();
    expect(msgs()).toHaveLength(0);

    submit("fresh");
    expect(calls).toHaveLength(3);
    expect(last().body.messages).toEqual([{ role: "user", content: "fresh" }]);
    expect(last().body.sessionId).not.toBe(firstSession);
  });

  it("Esc moves focus to the input and does not abort; pagehide does", () => {
    submit("q");
    const inflight = last();
    el.querySelector<HTMLElement>('[data-ba="clear"]')!.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.activeElement).toBe(el.input);
    expect(inflight.signal.aborted).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(inflight.signal.aborted).toBe(true);
    expect(send().disabled).toBe(false);
    expect(answer().getAttribute("aria-busy")).toBe("false");
  });
});

describe("local moods", () => {
  it("typing shows listening, blur rests", () => {
    el.dispatchEvent(new CustomEvent("blob:typing", { bubbles: true }));
    expect(mood()).toBe("listening");
    el.input.dispatchEvent(new Event("blur"));
    expect(mood()).toBe("idle");
  });

  it("goes sleepy after 60 s without activity and wakes on keydown", () => {
    vi.advanceTimersByTime(SLEEPY_AFTER_MS - 1000);
    document.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(1000);
    expect(mood()).toBe("idle");
    vi.advanceTimersByTime(SLEEPY_AFTER_MS - 1000);
    expect(mood()).toBe("sleepy");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(mood()).toBe("idle");
    vi.advanceTimersByTime(SLEEPY_AFTER_MS);
    expect(mood()).toBe("sleepy");
  });

  it("does not doze mid-reply, and dozes after it ends", () => {
    submit("q");
    vi.advanceTimersByTime(SLEEPY_AFTER_MS);
    expect(mood()).toBe("thinking");
    last().h.onMood("curious");
    last().h.onDone("ok");
    vi.advanceTimersByTime(SLEEPY_AFTER_MS);
    expect(mood()).toBe("sleepy");
    document.dispatchEvent(new Event("pointermove"));
    expect(mood()).toBe("curious");
  });
});

describe("destroy", () => {
  it("aborts, removes listeners and leaves no timers", () => {
    submit("q");
    const inflight = last();
    inflight.h.onDelta("x"); // pending animation frame
    inflight.h.onError("upstream"); // pending error hold
    submit("q2");
    last().h.onDelta("y");
    conv.destroy();
    expect(last().signal.aborted).toBe(true);
    el.remove(); // also stops the motion controllers' blink timers
    expect(vi.getTimerCount()).toBe(0);

    const n = calls.length;
    submit("after");
    el.dispatchEvent(new CustomEvent("blob:clear"));
    document.dispatchEvent(new Event("pointerdown"));
    expect(calls).toHaveLength(n);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("element lifecycle hook", () => {
  afterEach(() => {
    BlobAgentClass.attach = undefined;
  });

  it("attaches on connect, destroys on disconnect, starts fresh on reconnect", () => {
    conv.destroy();
    BlobAgentClass.attach = (a) => attachConversation(a, { stream });
    const holder = el.parentElement!;
    el.remove();
    holder.append(el); // connect: attaches
    submit("q");
    expect(calls).toHaveLength(1);
    last().h.onMood("proud");
    last().h.onDelta("hi");
    const inflight = last();
    el.remove(); // disconnect: destroys and aborts
    expect(inflight.signal.aborted).toBe(true);
    holder.append(el);
    expect(msgs()).toHaveLength(0);
    expect(phase()).toBe("idle");
    expect(mood()).toBe("idle");
    expect(hero().dataset["talking"]).toBe("false");
    expect(send().disabled).toBe(false);
    submit("again");
    expect(calls).toHaveLength(2);
    expect(last().body.messages).toEqual([{ role: "user", content: "again" }]);
  });
});
