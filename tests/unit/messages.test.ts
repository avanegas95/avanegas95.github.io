// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { COPY } from "../../src/scripts/blob/copy.ts";
import {
  appendAssistant,
  appendUser,
} from "../../src/scripts/blob/messages.ts";
import { MOOD_EMOJI } from "../../src/scripts/blob/motion.ts";

let log: HTMLElement;
beforeEach(() => {
  log = document.createElement("div");
  document.body.replaceChildren(log);
});

describe("appendUser", () => {
  it("keeps markup in user text as plain text", () => {
    const evil = `<img src=x onerror="alert(1)"> **bold** [x](javascript:alert(1))`;
    const el = appendUser(log, evil);
    expect(log.lastElementChild).toBe(el);
    expect(el.textContent).toBe(evil);
    expect(log.querySelector("img, strong, a")).toBeNull();
    expect(el.dataset["role"]).toBe("user");
  });
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

  it("shows the mood emoji in an aria-hidden badge", () => {
    const m = appendAssistant(log);
    const badge = m.el.querySelector<HTMLElement>(".ba-badge");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.hidden).toBe(true);
    m.setMood("excited");
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe(MOOD_EMOJI.excited);
    m.setMood("proud");
    expect(badge?.textContent).toBe(MOOD_EMOJI.proud);
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
