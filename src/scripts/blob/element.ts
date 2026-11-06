// <blob-agent>: wires the server-rendered Blob (figure, input, chips, speech bubble) and emits
// events. No API calls here: index.ts sets BlobAgent.attach (the conversation, P3-09), which
// runs while connected. Not a modal: there is no open step, no focus trap and nothing goes inert.
// Markup contract: components/blob/BlobAgent.astro (data-ba hooks).
import { createBubble, type Bubble } from "./bubble";
import { createBlobMotion, type BlobMotion } from "./motion";

type Hook = "figure" | "answer" | "form" | "input" | "clear";

export class BlobAgent extends HTMLElement {
  /** Extra behaviour attached on connect and destroyed on disconnect (set by index.ts). */
  static attach: ((el: BlobAgent) => { destroy(): void }) | undefined;
  #attached: { destroy(): void } | undefined;
  // Mood and talking wiring (P3-09). Undefined while disconnected.
  motion: BlobMotion | undefined;
  bubble: Bubble | undefined;
  #ac: AbortController | undefined;

  #hook<T extends HTMLElement>(name: Hook): T {
    const el = this.querySelector<T>(`[data-ba="${name}"]`);
    if (!el) throw new Error(`blob-agent: missing [data-ba="${name}"]`);
    return el;
  }

  get figure(): HTMLElement {
    const f = this.#hook("figure").querySelector<HTMLElement>(".blob-figure");
    if (!f) throw new Error("blob-agent: missing .blob-figure");
    return f;
  }
  /** The aria-live region that holds the bubble's answer text. */
  get answer(): HTMLElement {
    return this.#hook("answer");
  }
  get input(): HTMLInputElement | HTMLTextAreaElement {
    return this.#hook("input");
  }

  #emit(name: string, detail?: unknown): void {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, detail: detail ?? null }),
    );
  }

  connectedCallback(): void {
    this.disconnectedCallback();
    const ac = new AbortController();
    this.#ac = ac;
    const on = { signal: ac.signal };

    this.motion = createBlobMotion(this.figure, { track: true });
    this.bubble = createBubble(this);

    for (const chip of this.querySelectorAll<HTMLElement>('[data-ba="chip"]')) {
      chip.addEventListener(
        "click",
        () => this.#emit("blob:submit", { text: chip.textContent.trim() }),
        on,
      );
    }
    this.#hook("clear").addEventListener(
      "click",
      () => this.#emit("blob:clear"),
      on,
    );
    this.#hook("form").addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = "";
        this.#emit("blob:submit", { text });
      },
      on,
    );
    this.input.addEventListener("input", () => this.#emit("blob:typing"), on);
    // Esc sends focus back to the input and stops nothing: a running stream keeps going.
    this.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && document.activeElement !== this.input) {
          this.input.focus();
        }
      },
      on,
    );
    this.#attached = BlobAgent.attach?.(this);
  }

  disconnectedCallback(): void {
    this.#attached?.destroy();
    this.#attached = undefined;
    this.#ac?.abort();
    this.#ac = undefined;
    this.bubble?.destroy();
    this.bubble = undefined;
    this.motion?.destroy();
    this.motion = undefined;
  }
}

export function defineBlobAgent(): void {
  if (!customElements.get("blob-agent")) {
    customElements.define("blob-agent", BlobAgent);
  }
}
