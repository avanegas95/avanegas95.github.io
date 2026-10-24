// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { defineBlobAgent } from "../../src/scripts/blob/element.ts";
import type { BlobAgent } from "../../src/scripts/blob/element.ts";
import { focusables, trapTab } from "../../src/scripts/blob/panel.ts";

const FIGURE = (size: string) =>
  `<div class="blob-figure" data-size="${size}" data-mood="idle" data-talking="false"><svg aria-hidden="true"></svg><span class="blob-emoji" aria-hidden="true"></span></div>`;

// Mirrors the server-rendered markup of BlobAgent.astro (the E2E spec covers the real thing).
const MARKUP = `
<blob-agent>
  <div data-ba="ui">
    <button type="button" data-ba="toggle" aria-expanded="false" aria-controls="blob-panel" aria-label="Chat with Blob">${FIGURE("hero")}</button>
    <button type="button" data-ba="ask">Ask Blob about Anderson</button>
    <ul><li><button type="button" data-ba="chip">What does he do?</button></li><li><button type="button" data-ba="chip">Show me his projects</button></li></ul>
    <div id="blob-panel" data-ba="panel" role="dialog" aria-modal="true" aria-labelledby="blob-panel-title" tabindex="-1" hidden>
      <p id="blob-panel-title">Chat with Blob</p>
      ${FIGURE("avatar")}
      <button type="button" data-ba="close">Close chat</button>
      <div data-ba="log" role="log" aria-live="polite"></div>
      <form data-ba="form">
        <label for="blob-input">Your question</label>
        <input id="blob-input" data-ba="input" maxlength="500" />
        <button type="submit">Send</button>
      </form>
      <p>Questions? <a href="#contact" data-test="contact">contact</a></p>
      <button type="button" data-ba="clear">Clear chat</button>
    </div>
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
  for (const t of [
    "blob:submit",
    "blob:clear",
    "blob:open",
    "blob:close",
    "blob:typing",
  ]) {
    a.addEventListener(t, (e) =>
      seen.push({ type: t, detail: (e as CustomEvent).detail }),
    );
  }
  return seen;
}

describe("focusables", () => {
  it("skips hidden, disabled and non-tabbable elements", () => {
    document.body.innerHTML = `<div id="r">
      <button id="a">a</button>
      <button disabled>b</button>
      <div hidden><button>c</button></div>
      <button hidden>d</button>
      <input type="hidden" />
      <a href="#x" id="e">e</a>
      <button tabindex="-1">f</button>
    </div>`;
    const ids = focusables(document.getElementById("r") as HTMLElement).map(
      (e) => e.id,
    );
    expect(ids).toEqual(["a", "e"]);
  });
});

describe("trapTab", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="r"><button id="a">a</button><button id="b">b</button><button id="c">c</button></div>`;
  });
  const root = () => document.getElementById("r") as HTMLElement;
  const press = (shiftKey: boolean) =>
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      cancelable: true,
    });

  it("wraps last to first", () => {
    document.getElementById("c")?.focus();
    const e = press(false);
    trapTab(e, root());
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("a");
  });
  it("wraps first to last on Shift+Tab", () => {
    document.getElementById("a")?.focus();
    const e = press(true);
    trapTab(e, root());
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("c");
  });
  it("leaves middle tabs alone", () => {
    document.getElementById("b")?.focus();
    const e = press(false);
    trapTab(e, root());
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe("b");
  });
  it("pulls focus back in when it is outside", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="out">o</button>`,
    );
    document.getElementById("out")?.focus();
    const e = press(false);
    trapTab(e, root());
    expect(document.activeElement?.id).toBe("a");
  });
});

describe("<blob-agent>", () => {
  it("defineBlobAgent twice does not throw", () => {
    expect(() => {
      defineBlobAgent();
      defineBlobAgent();
    }).not.toThrow();
  });

  it("open/close toggles hidden and aria-expanded, and fires events", () => {
    const a = mount();
    const seen = record(a);
    const panel = q(a, "panel");
    const toggle = q<HTMLButtonElement>(a, "toggle");
    expect(a.isOpen).toBe(false);
    toggle.click();
    expect(a.isOpen).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(q(a, "input"));
    q<HTMLButtonElement>(a, "close").click();
    expect(a.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(seen.map((s) => s.type)).toEqual(["blob:open", "blob:close"]);
  });

  it("clicking Blob again closes the panel", () => {
    const a = mount();
    const toggle = q<HTMLButtonElement>(a, "toggle");
    toggle.click();
    toggle.click();
    expect(a.isOpen).toBe(false);
  });

  it("Esc closes and restores focus to the opener", () => {
    const a = mount();
    const toggle = q<HTMLButtonElement>(a, "toggle");
    toggle.focus();
    toggle.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(a.isOpen).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("the Ask field opens the panel and focuses the input", () => {
    const a = mount();
    q<HTMLButtonElement>(a, "ask").click();
    expect(a.isOpen).toBe(true);
    expect(document.activeElement).toBe(q(a, "input"));
  });

  it("chip click opens and fires blob:submit with the exact chip text", () => {
    const a = mount();
    const seen = record(a);
    const chip = a.querySelectorAll<HTMLButtonElement>('[data-ba="chip"]')[1];
    chip?.click();
    expect(a.isOpen).toBe(true);
    expect(seen.find((s) => s.type === "blob:submit")?.detail).toEqual({
      text: "Show me his projects",
    });
  });

  it("submits trimmed text and ignores empty or whitespace", () => {
    const a = mount();
    const seen = record(a);
    a.open();
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
    a.open();
    q<HTMLInputElement>(a, "input").dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(a, "clear").click();
    expect(seen.map((s) => s.type)).toEqual([
      "blob:open",
      "blob:typing",
      "blob:clear",
    ]);
  });

  it("makes everything outside the dialog inert while open", () => {
    const a = mount();
    a.open();
    expect(q(a, "toggle").closest("[inert]")).not.toBeNull();
    expect(q(a, "ask").closest("[inert]")).not.toBeNull();
    expect(q(a, "panel").closest("[inert]")).toBeNull();
    a.close();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("closes on pointerdown outside and restores focus, not inside", () => {
    const a = mount();
    const toggle = q<HTMLButtonElement>(a, "toggle");
    toggle.focus();
    toggle.click();
    q(a, "log").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(a.isOpen).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(a.isOpen).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("an in-panel #link closes without restoring focus to the opener", () => {
    const a = mount();
    const seen = record(a);
    const toggle = q<HTMLButtonElement>(a, "toggle");
    toggle.focus();
    toggle.click();
    const link = a.querySelector<HTMLAnchorElement>('[data-test="contact"]');
    link?.focus();
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(a.isOpen).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).not.toBe(toggle);
    expect(seen.map((s) => s.type)).toEqual(["blob:open", "blob:close"]);
  });

  it("removing while open resets fully; re-attached it is closed, then modal again", () => {
    const a = mount();
    const holder = a.parentElement as HTMLElement;
    const panel = q(a, "panel");
    const toggle = q<HTMLButtonElement>(a, "toggle");
    a.open();
    expect(document.querySelector("[inert]")).not.toBeNull();
    a.remove();
    expect(a.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(a.querySelector("[inert]")).toBeNull();

    holder.append(a);
    const seen = record(a);
    expect(a.isOpen).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(a.isOpen).toBe(false);
    expect(seen).toEqual([]);

    toggle.click();
    expect(a.isOpen).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.closest("[inert]")).not.toBeNull();
    expect(panel.closest("[inert]")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(a.isOpen).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(seen.map((s) => s.type)).toEqual(["blob:open", "blob:close"]);
  });

  it("exposes figures and stops reacting after disconnect", () => {
    const a = mount();
    expect(a.heroFigure.dataset["size"]).toBe("hero");
    expect(a.avatarFigure.dataset["size"]).toBe("avatar");
    a.open();
    a.remove();
    const seen = record(a);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(seen).toEqual([]);
  });
});
