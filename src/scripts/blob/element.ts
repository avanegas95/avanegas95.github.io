// <blob-agent>: toggles the server-rendered chat panel and emits events. No API calls here:
// index.ts sets BlobAgent.attach (the conversation, P3-09), which runs while connected.
// Markup contract: components/blob/BlobAgent.astro (data-ba hooks).
import { createBlobMotion, type BlobMotion } from "./motion";
import { trapTab } from "./panel";

type Hook =
  "toggle" | "ask" | "panel" | "close" | "log" | "form" | "input" | "clear";

type FocusOpts = { focus?: "input" | "panel" };

export class BlobAgent extends HTMLElement {
  /** Extra behaviour attached on connect and destroyed on disconnect (set by index.ts). */
  static attach: ((el: BlobAgent) => { destroy(): void }) | undefined;
  #attached: { destroy(): void } | undefined;
  // Exposed for P3-09 (mood and talking wiring). Undefined while disconnected.
  heroMotion: BlobMotion | undefined;
  avatarMotion: BlobMotion | undefined;
  #ac: AbortController | undefined;
  #opener: HTMLElement | null = null;

  #hook<T extends HTMLElement>(name: Hook): T {
    const el = this.querySelector<T>(`[data-ba="${name}"]`);
    if (!el) throw new Error(`blob-agent: missing [data-ba="${name}"]`);
    return el;
  }

  #figure(root: HTMLElement): HTMLElement {
    const f = root.querySelector<HTMLElement>(".blob-figure");
    if (!f) throw new Error("blob-agent: missing .blob-figure");
    return f;
  }

  get isOpen(): boolean {
    return !this.#hook("panel").hidden;
  }
  get heroFigure(): HTMLElement {
    return this.#figure(this.#hook("toggle"));
  }
  get avatarFigure(): HTMLElement {
    return this.#figure(this.#hook("panel"));
  }
  get log(): HTMLElement {
    return this.#hook("log");
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
    const toggle = this.#hook<HTMLButtonElement>("toggle");
    const panel = this.#hook("panel");

    this.heroMotion = createBlobMotion(this.heroFigure, { track: true });
    this.avatarMotion = createBlobMotion(this.avatarFigure);

    toggle.addEventListener(
      "click",
      () => (this.isOpen ? this.close() : this.#openFrom(toggle)),
      on,
    );
    const ask = this.#hook("ask");
    ask.addEventListener("click", () => this.#openFrom(ask), on);
    for (const chip of this.querySelectorAll<HTMLElement>('[data-ba="chip"]')) {
      chip.addEventListener(
        "click",
        () => {
          this.#openFrom(chip);
          this.#emit("blob:submit", { text: chip.textContent.trim() });
        },
        on,
      );
    }
    this.#hook("close").addEventListener("click", () => this.close(), on);
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
    panel.addEventListener("keydown", (e) => trapTab(e, panel), on);
    // In-panel same-page links (e.g. the disclaimer's #contact): close without restoring focus so
    // the browser's fragment jump and focus starting point move to the target.
    panel.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        if (t instanceof Element && t.closest('a[href^="#"]')) {
          this.#close(false);
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
    document.removeEventListener("keydown", this.#onDocKey);
    document.removeEventListener("pointerdown", this.#onDocPointer);
    this.#setInert(false);
    // Reset open state so a re-attached element starts closed.
    this.querySelector<HTMLElement>('[data-ba="panel"]')?.setAttribute(
      "hidden",
      "",
    );
    this.querySelector('[data-ba="toggle"]')?.setAttribute(
      "aria-expanded",
      "false",
    );
    this.#opener = null;
    this.heroMotion?.destroy();
    this.avatarMotion?.destroy();
    this.heroMotion = this.avatarMotion = undefined;
  }

  #onDocKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  #onDocPointer = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof Node) || this.#hook("panel").contains(t)) return;
    const opener = this.#opener;
    this.close();
    // The pointer's default action (mousedown focus change) runs after this handler and would
    // blur the restored focus, so restore once more after it.
    setTimeout(() => {
      if (opener?.isConnected && !this.isOpen) opener.focus();
    }, 0);
  };

  // Everything outside the dialog becomes inert while it is open (aria-modal made real).
  #inerted: Element[] = [];
  #setInert(on: boolean): void {
    if (!on) {
      for (const el of this.#inerted) el.removeAttribute("inert");
      this.#inerted = [];
      return;
    }
    let node: Element = this.#hook("panel");
    while (node.parentElement) {
      for (const sib of node.parentElement.children) {
        if (sib !== node && !sib.hasAttribute("inert")) {
          sib.setAttribute("inert", "");
          this.#inerted.push(sib);
        }
      }
      if (node.parentElement === document.body) break;
      node = node.parentElement;
    }
  }

  #openFrom(opener: HTMLElement, opts?: FocusOpts): void {
    if (this.isOpen) {
      this.#focusInto(opts);
      return;
    }
    this.#opener = opener;
    this.#hook("panel").hidden = false;
    this.#hook("toggle").setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", this.#onDocKey);
    document.addEventListener("pointerdown", this.#onDocPointer);
    this.#setInert(true);
    this.#focusInto(opts);
    this.#emit("blob:open");
  }

  #focusInto(opts?: FocusOpts): void {
    (opts?.focus === "panel" ? this.#hook("panel") : this.input).focus();
  }

  open(opts?: FocusOpts): void {
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement && !this.#hook("panel").contains(active)
        ? active
        : this.#hook<HTMLElement>("toggle");
    this.#openFrom(opener, opts);
  }

  close(): void {
    this.#close(true);
  }

  #close(restoreFocus: boolean): void {
    if (!this.isOpen) return;
    this.#hook("panel").hidden = true;
    this.#hook("toggle").setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", this.#onDocKey);
    document.removeEventListener("pointerdown", this.#onDocPointer);
    this.#setInert(false);
    const target = this.#opener?.isConnected
      ? this.#opener
      : this.#hook<HTMLElement>("toggle");
    this.#opener = null;
    if (restoreFocus) target.focus();
    this.#emit("blob:close");
  }
}

export function defineBlobAgent(): void {
  if (!customElements.get("blob-agent")) {
    customElements.define("blob-agent", BlobAgent);
  }
}
