// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { COPY } from "../../src/scripts/blob/copy.ts";
import { appendAssistant } from "../../src/scripts/blob/messages.ts";
import * as motion from "../../src/scripts/blob/motion.ts";

let log: HTMLElement;
beforeEach(() => {
  log = document.createElement("div");
  document.body.replaceChildren(log);
});

describe("appendAssistant", () => {
  it("starts with a screen-reader thinking note", () => {
    const m = appendAssistant(log);
    expect(log.lastElementChild).toBe(m.el);
    expect(m.el.dataset["role"]).toBe("assistant");
    expect(m.el.querySelector(".ba-sr")?.textContent).toBe(COPY.thinking);
  });

  it("renders safe markdown and replaces it on every call", () => {
    const m = appendAssistant(log);
    m.setMarkdown("Hi **there** <b>x</b> [gh](https://github.com/avanegas95)");
    expect(m.el.querySelector(".ba-sr")).toBeNull();
    expect(m.el.querySelector("strong")?.textContent).toBe("there");
    expect(m.el.querySelector("b")).toBeNull();
    expect(m.el.textContent).toContain("<b>x</b>");
    expect(m.el.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/avanegas95",
    );
    m.setMarkdown("[bad](https://evil.example) plain");
    expect(m.el.querySelector("a")).toBeNull();
    expect(m.el.textContent).toContain("bad plain");
    m.setMarkdown("");
    expect(m.el.querySelector(".ba-text")?.childNodes.length).toBe(0);
  });

  it("renders no emoji badge and offers no mood glyph API", () => {
    const m = appendAssistant(log);
    m.setMarkdown("Hello");
    expect(m.el.querySelector(".ba-badge")).toBeNull();
    expect("setMood" in m).toBe(false);
    expect("MOOD_EMOJI" in motion).toBe(false);
    expect(m.el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("setError shows the copy and links only to #contact", () => {
    const m = appendAssistant(log);
    m.setMarkdown("partial");
    m.setError(COPY.errors.budget);
    expect(m.el.dataset["error"]).toBe("true");
    expect(m.el.textContent).not.toContain("partial");
    expect(m.el.textContent).toContain(COPY.errors.budget.text);
    const links = m.el.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("#contact");
    expect(links[0]?.textContent).toBe(COPY.errors.budget.link?.label);
    expect(links[0]?.hasAttribute("target")).toBe(false);
  });

  it("setError forces #contact even for a tampered message", () => {
    const m = appendAssistant(log);
    m.setError({
      text: "<img onerror=x>",
      link: { label: "x", href: "javascript:alert(1)" as "#contact" },
    });
    expect(m.el.querySelector("img")).toBeNull();
    expect(m.el.querySelector("a")?.getAttribute("href")).toBe("#contact");
  });

  it("setError without a link renders no anchor", () => {
    const m = appendAssistant(log);
    m.setError(COPY.errors.rate_limited);
    expect(m.el.querySelector("a")).toBeNull();
    expect(m.el.textContent).toContain(COPY.errors.rate_limited.text);
  });
});
