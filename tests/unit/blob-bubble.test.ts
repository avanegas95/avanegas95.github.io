// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_TURNS,
  nextPhase,
  type BubbleEvent,
  type Phase,
} from "../../src/scripts/blob/bubble.ts";
import { COPY } from "../../src/scripts/blob/copy.ts";
import { defineBlobAgent } from "../../src/scripts/blob/element.ts";
import type { BlobAgent } from "../../src/scripts/blob/element.ts";

const FIGURE = `<div class="blob-figure" data-size="hero" data-mood="idle" data-talking="false"><svg aria-hidden="true"></svg></div>`;

// Mirrors the server-rendered markup of BlobAgent.astro (the E2E spec covers the real thing).
const MARKUP = `
<blob-agent>
  <div data-ba="figure">${FIGURE}</div>
  <form data-ba="form">
    <label for="blob-input">Your question</label>
    <input id="blob-input" data-ba="input" maxlength="500" />
    <button type="submit">Send</button>
  </form>
  <div><p>Questions? <a href="#contact" data-test="contact">contact</a></p>
  <button type="button" data-ba="clear">Clear chat</button></div>
  <p data-ba="question" hidden></p>
  <div data-ba="bubble" data-phase="idle">
    <div data-ba="answer" aria-live="polite">
      <div data-ba="clip"><p data-ba="greeting">${COPY.greeting}</p></div>
    </div>
    <button type="button" data-ba="more" aria-expanded="false" hidden>Show more</button>
    <ul data-ba="starters">
      <li><button type="button" data-ba="chip">What does he do?</button></li>
      <li><button type="button" data-ba="chip">Show me his projects</button></li>
    </ul>
  </div>
  <div data-ba="previous-wrap" hidden>
    <button type="button" data-ba="previous" aria-expanded="false" aria-controls="blob-history">Previous answers</button>
    <ol id="blob-history" data-ba="history" hidden></ol>
  </div>
</blob-agent>`;

function mount(): BlobAgent {
  defineBlobAgent();
  // Build detached so the children exist when the element connects (the page script upgrades
  // after parsing, so the real element always sees its children).
  const holder = document.createElement("div");
  holder.innerHTML = MARKUP;
  document.body.replaceChildren(holder);
  return holder.querySelector("blob-agent") as BlobAgent;
}
const q = <T extends HTMLElement>(a: BlobAgent, k: string): T =>
  a.querySelector(`[data-ba="${k}"]`) as T;

function record(a: BlobAgent) {
  const seen: { type: string; detail: unknown }[] = [];
  for (const t of ["blob:submit", "blob:clear", "blob:typing"]) {
    a.addEventListener(t, (e) =>
      seen.push({ type: t, detail: (e as CustomEvent).detail }),
    );
  }
  return seen;
}

describe("nextPhase (bubble state machine)", () => {
  const walk = (events: BubbleEvent[], from: Phase = "idle"): Phase =>
    events.reduce<Phase>((p, e) => nextPhase(p, e), from);

  it("goes idle -> asking -> streaming -> done", () => {
    expect(nextPhase("idle", "ask")).toBe("asking");
    expect(nextPhase("asking", "delta")).toBe("streaming");
    expect(nextPhase("streaming", "done")).toBe("done");
    expect(walk(["ask", "delta", "done"])).toBe("done");
  });

  it("a new question restarts from done or error, but not mid-stream", () => {
    expect(nextPhase("done", "ask")).toBe("asking");
    expect(nextPhase("error", "ask")).toBe("asking");
    expect(nextPhase("streaming", "ask")).toBe("streaming");
    expect(nextPhase("asking", "ask")).toBe("asking");
  });

  it("fail moves a running turn to error; clear always returns to idle", () => {
    expect(nextPhase("asking", "fail")).toBe("error");
    expect(nextPhase("streaming", "fail")).toBe("error");
    expect(nextPhase("done", "fail")).toBe("done");
    for (const p of ["idle", "asking", "streaming", "done", "error"] as const) {
      expect(nextPhase(p, "clear")).toBe("idle");
    }
  });

  it("late events after the end change nothing", () => {
    expect(nextPhase("done", "delta")).toBe("done");
    expect(nextPhase("error", "done")).toBe("error");
    expect(nextPhase("idle", "delta")).toBe("idle");
  });
});

describe("bubble controller", () => {
  let a: BlobAgent;
  beforeEach(() => {
    a = mount();
  });

  it("starts idle: greeting and chips visible, question and Previous hidden", () => {
    expect(a.bubble?.phase).toBe("idle");
    expect(q(a, "bubble").dataset["phase"]).toBe("idle");
    expect(q(a, "greeting").hidden).toBe(false);
    expect(q(a, "greeting").textContent).toBe(
      "Hi! I'm Blob. Ask me anything about Anderson.",
    );
    expect(q(a, "starters").hidden).toBe(false);
    expect(q(a, "question").hidden).toBe(true);
    expect(q(a, "previous-wrap").hidden).toBe(true);
    expect(q(a, "more").hidden).toBe(true);
  });

  it("walks idle -> asking -> streaming -> done, mirrored in data-phase", () => {
    const b = a.bubble!;
    b.ask("<b>hi</b>");
    expect(q(a, "bubble").dataset["phase"]).toBe("asking");
    expect(q(a, "question").textContent).toBe("<b>hi</b>"); // plain text
    expect(q(a, "question").querySelector("b")).toBeNull();
    b.delta();
    expect(q(a, "bubble").dataset["phase"]).toBe("streaming");
    b.done();
    expect(q(a, "bubble").dataset["phase"]).toBe("done");
  });

  it("an error turn is replaced, not archived; a done turn is archived in order", () => {
    const b = a.bubble!;
    b.ask("one").setMarkdown("first");
    b.delta();
    b.done();
    b.ask("two").setError(COPY.errors.upstream);
    b.fail();
    expect(b.phase).toBe("error");
    b.ask("three").setMarkdown("third");
    const items = a.querySelectorAll('[data-ba="history"] > li');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("one");
    expect(items[0]?.textContent).toContain("first");
    expect(q(a, "previous-wrap").hidden).toBe(false);
  });

  it("Previous toggles aria-expanded and hidden on the list", () => {
    const b = a.bubble!;
    for (const t of ["a", "b"]) {
      b.ask(t).setMarkdown(t);
      b.delta();
      b.done();
    }
    const btn = q<HTMLButtonElement>(a, "previous");
    const list = q(a, "history");
    expect(btn.getAttribute("aria-controls")).toBe(list.id);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(btn.textContent).toContain(COPY.previousHide);
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
  });

  it("keeps at most MAX_TURNS turns in total", () => {
    const b = a.bubble!;
    for (let i = 0; i < MAX_TURNS + 5; i++) {
      b.ask(`q${i}`).setMarkdown(`a${i}`);
      b.delta();
      b.done();
    }
    expect(a.querySelectorAll('[data-ba="history"] > li')).toHaveLength(
      MAX_TURNS - 1,
    );
  });

  it("clear restores the idle bubble", () => {
    const b = a.bubble!;
    b.ask("x").setMarkdown("y");
    b.delta();
    b.done();
    b.ask("z");
    b.clear();
    expect(b.phase).toBe("idle");
    expect(q(a, "greeting").hidden).toBe(false);
    expect(q(a, "starters").hidden).toBe(false);
    expect(q(a, "question").hidden).toBe(true);
    expect(q(a, "previous-wrap").hidden).toBe(true);
    expect(a.querySelector(".ba-msg")).toBeNull();
  });
});

describe("<blob-agent>", () => {
  it("defineBlobAgent twice does not throw", () => {
    expect(() => {
      defineBlobAgent();
      defineBlobAgent();
    }).not.toThrow();
  });

  it("is not a modal: no dialog role, aria-modal, inert or focus trap", () => {
    const a = mount();
    expect(a.querySelector('[role="dialog"], [aria-modal]')).toBeNull();
    expect("open" in a).toBe(false);
    expect("close" in a).toBe(false);
    q(a, "chip").click();
    q<HTMLButtonElement>(a, "clear").focus();
    // Tab handling is left entirely to the browser.
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    q(a, "clear").dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("the live region is polite, holds answer text only, and is not a dialog", () => {
    const a = mount();
    const live = a.answer;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.contains(q(a, "question"))).toBe(false);
    expect(live.contains(q(a, "starters"))).toBe(false);
    expect(live.contains(a.figure)).toBe(false);
  });

  it("chip click fires blob:submit with the exact chip text", () => {
    const a = mount();
    const seen = record(a);
    a.querySelectorAll<HTMLButtonElement>('[data-ba="chip"]')[1]?.click();
    expect(seen).toEqual([
      { type: "blob:submit", detail: { text: "Show me his projects" } },
    ]);
  });

  it("submits trimmed text and ignores empty or whitespace", () => {
    const a = mount();
    const seen = record(a);
    const input = q<HTMLInputElement>(a, "input");
    const form = q<HTMLFormElement>(a, "form");
    input.value = "   ";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(seen.some((s) => s.type === "blob:submit")).toBe(false);
    input.value = "  hello  ";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    const sub = seen.filter((s) => s.type === "blob:submit");
    expect(sub).toHaveLength(1);
    expect(sub[0]?.detail).toEqual({ text: "hello" });
    expect(input.value).toBe("");
  });

  it("fires blob:typing on input and blob:clear on Clear chat", () => {
    const a = mount();
    const seen = record(a);
    q<HTMLInputElement>(a, "input").dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(a, "clear").click();
    expect(seen.map((s) => s.type)).toEqual(["blob:typing", "blob:clear"]);
  });

  it("Esc sends focus to the input and emits nothing", () => {
    const a = mount();
    const seen = record(a);
    const chip = a.querySelector<HTMLButtonElement>('[data-ba="chip"]')!;
    chip.focus();
    chip.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.activeElement).toBe(q(a, "input"));
    expect(seen).toEqual([]);
  });

  it("exposes the figure, and a removed element stops reacting and can re-attach", () => {
    const a = mount();
    const holder = a.parentElement as HTMLElement;
    expect(a.figure.dataset["size"]).toBe("hero");
    expect(a.motion).toBeDefined();
    a.remove();
    expect(a.motion).toBeUndefined();
    expect(a.bubble).toBeUndefined();
    const seen = record(a);
    q(a, "chip").click();
    expect(seen).toEqual([]);
    holder.append(a);
    expect(a.bubble?.phase).toBe("idle");
    q(a, "chip").click();
    expect(seen.map((s) => s.type)).toEqual(["blob:submit"]);
  });
});
