// Chat log message DOM. createElement/textContent only, never HTML strings: user text is
// always plain text and Blob's replies go through the safe markdown renderer (SCOPE §6.6).
import type { ModelMood } from "../../lib/moods";
import { COPY, type Message } from "./copy";
import { parseMarkdown, renderMarkdown } from "./markdown";
import { MOOD_EMOJI } from "./motion";

function bubble(log: HTMLElement, role: "user" | "assistant"): HTMLElement {
  const el = log.ownerDocument.createElement("div");
  el.className = `ba-msg ba-msg-${role}`;
  el.dataset["role"] = role;
  log.append(el);
  return el;
}

export function appendUser(log: HTMLElement, text: string): HTMLElement {
  const el = bubble(log, "user");
  el.textContent = text;
  return el;
}

export function appendAssistant(log: HTMLElement): {
  setMarkdown(src: string): void;
  setMood(m: ModelMood): void;
  setError(msg: Message): void;
  el: HTMLElement;
} {
  const doc = log.ownerDocument;
  const el = bubble(log, "assistant");
  const badge = doc.createElement("span");
  badge.className = "ba-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.hidden = true;
  const body = doc.createElement("div");
  body.className = "ba-text";
  // Visible dots for sighted users, a plain note for screen readers; the first text replaces both.
  const dots = doc.createElement("span");
  dots.className = "ba-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.textContent = "…";
  const sr = doc.createElement("span");
  sr.className = "ba-sr";
  sr.textContent = COPY.thinking;
  body.append(dots, sr);
  el.append(badge, body);

  return {
    el,
    setMarkdown(src) {
      body.replaceChildren(renderMarkdown(parseMarkdown(src), doc));
    },
    setMood(m) {
      const glyph = MOOD_EMOJI[m];
      badge.textContent = glyph ?? "";
      badge.hidden = !glyph;
    },
    setError(msg) {
      const p = doc.createElement("p");
      p.textContent = msg.text;
      if (msg.link) {
        const a = doc.createElement("a");
        a.setAttribute("href", "#contact"); // the only target error copy may link to
        a.textContent = msg.link.label;
        p.append(" ", a);
      }
      body.replaceChildren(p);
      el.dataset["error"] = "true";
    },
  };
}
