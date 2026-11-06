// Blob's speech bubble: one answer at a time (clamped to a max height with "Show more") with its
// question above it. Earlier turns cycle in the same place with Previous / Next, so the page never
// grows with the conversation. DOM only, no timers.
// Markup contract: components/blob/BlobAgent.astro (data-ba hooks). Growth is downward only.
import { COPY } from "./copy";
import { appendAssistant } from "./messages";

export type Phase = "idle" | "asking" | "streaming" | "done" | "error";
export type BubbleEvent = "ask" | "delta" | "done" | "fail" | "clear";

// The newest answer plus its predecessors; mirrors the request history cap in history.ts.
export const MAX_TURNS = 10;

// idle -> asking -> streaming -> done; fail from asking/streaming; a new ask from done/error.
export function nextPhase(phase: Phase, e: BubbleEvent): Phase {
  switch (e) {
    case "clear":
      return "idle";
    case "ask":
      return phase === "asking" || phase === "streaming" ? phase : "asking";
    case "delta":
      return phase === "asking" ? "streaming" : phase;
    case "done":
      return phase === "streaming" || phase === "asking" ? "done" : phase;
    case "fail":
      return phase === "asking" || phase === "streaming" ? "error" : phase;
  }
}

type Reply = ReturnType<typeof appendAssistant>;
type Turn = { question: string; reply: Reply };

export type Bubble = {
  readonly phase: Phase;
  /** Starts a turn: keeps the finished one for Previous, shows the question, returns the reply. */
  ask(question: string): Reply;
  delta(): void;
  done(): void;
  fail(): void;
  clear(): void;
  /** Re-measures the clamp after the content changed or the width did. */
  sync(): void;
  /** Shows the turn `step` places before (negative) or after (positive) the one on screen. */
  page(step: number): void;
  destroy(): void;
};

function hook<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const el = root.querySelector<T>(`[data-ba="${name}"]`);
  if (!el) throw new Error(`blob-agent: missing [data-ba="${name}"]`);
  return el;
}

export function createBubble(root: HTMLElement): Bubble {
  const bubble = hook(root, "bubble");
  const question = hook(root, "question");
  const clip = hook(root, "clip");
  const greeting = hook(root, "greeting");
  const starters = hook(root, "starters");
  const more = hook<HTMLButtonElement>(root, "more");
  const pager = hook(root, "pager");
  const prevBtn = hook<HTMLButtonElement>(root, "prev");
  const nextBtn = hook<HTMLButtonElement>(root, "next");
  const position = hook(root, "position");
  const ac = new AbortController();
  // Paging swaps the answer inside the live region, which reads only the answer. This status
  // adds which turn and question it is; it changes only on Previous / Next, never on a new ask.
  const status = root.ownerDocument.createElement("span");
  status.className = "ba-sr";
  status.setAttribute("role", "status");
  pager.append(status);
  // "Show more" controls the clip; the id is set here so the markup contract stays small.
  if (!clip.id) clip.id = "blob-clip";
  more.setAttribute("aria-controls", clip.id);

  let phase: Phase = "idle";
  let expanded = false;
  // Oldest first; the last one is the latest turn (in flight, done or failed).
  let turns: Turn[] = [];
  let view = -1;

  const busy = (): boolean => phase === "asking" || phase === "streaming";

  // aria-disabled, not disabled: the button keeps focus when it reaches the first or last turn.
  const setOff = (btn: HTMLButtonElement, off: boolean): void => {
    btn.setAttribute("aria-disabled", String(off));
  };

  const syncPager = (): void => {
    const n = turns.length;
    pager.hidden = n < 2;
    setOff(prevBtn, busy() || view <= 0);
    setOff(nextBtn, busy() || view >= n - 1);
    position.textContent = n > 0 ? `${view + 1} ${COPY.of} ${n}` : "";
  };

  const setPhase = (e: BubbleEvent): void => {
    phase = nextPhase(phase, e);
    bubble.dataset["phase"] = phase;
    syncPager();
  };

  const sync = (): void => {
    // No text yet means nothing to clamp (the thinking dots never need "Show more").
    const clamped =
      phase !== "asking" && clip.scrollHeight > clip.clientHeight + 1;
    // While expanded the clamp is off, so keep the button (as "Show less") once it was needed.
    more.hidden = !(expanded || clamped);
    more.textContent = expanded ? COPY.showLess : COPY.showMore;
    more.setAttribute("aria-expanded", String(expanded));
    clip.dataset["expanded"] = String(expanded);
    clip.dataset["clamped"] = String(clamped && !expanded);
  };

  const setExpanded = (v: boolean): void => {
    expanded = v;
    sync();
  };

  const clearClip = (): void => {
    for (const old of clip.querySelectorAll(":scope > .ba-msg")) old.remove();
  };

  // Puts turn i in the bubble: its question above, its reply in the clip, collapsed.
  const show = (i: number): void => {
    const turn = turns[i];
    if (!turn) return;
    view = i;
    clearClip();
    clip.append(turn.reply.el);
    question.textContent = turn.question;
    question.hidden = false;
    expanded = false;
    syncPager();
    sync();
  };

  const page = (step: number): void => {
    if (busy()) return;
    const i = Math.min(Math.max(view + step, 0), turns.length - 1);
    if (i === view) return;
    show(i);
    status.textContent = `${COPY.answer} ${i + 1} ${COPY.of} ${turns.length}: ${turns[i]!.question}`;
  };

  more.addEventListener("click", () => setExpanded(!expanded), {
    signal: ac.signal,
  });
  // A link inside the clipped part must never take focus while hidden (WCAG 2.4.11): expand.
  clip.addEventListener(
    "focusin",
    () => {
      if (!expanded && clip.dataset["clamped"] === "true") setExpanded(true);
    },
    { signal: ac.signal },
  );
  prevBtn.addEventListener("click", () => page(-1), { signal: ac.signal });
  nextBtn.addEventListener("click", () => page(1), { signal: ac.signal });
  addEventListener("resize", sync, { signal: ac.signal, passive: true });

  // A (re)attached element starts clean.
  bubble.dataset["phase"] = phase;
  question.hidden = true;
  syncPager();
  sync();

  return {
    get phase() {
      return phase;
    },
    ask(text) {
      // A failed latest turn is replaced, never kept (as in history.ts); a done one stays.
      if (phase === "error") turns.pop();
      while (turns.length >= MAX_TURNS) turns.shift();
      greeting.hidden = true;
      starters.hidden = true;
      clearClip();
      const reply = appendAssistant(clip);
      turns.push({ question: text, reply });
      setPhase("ask");
      show(turns.length - 1);
      return reply;
    },
    delta() {
      setPhase("delta");
    },
    done() {
      setPhase("done");
      sync();
    },
    fail() {
      setPhase("fail");
      sync();
    },
    clear() {
      status.textContent = "";
      turns = [];
      view = -1;
      clearClip();
      question.hidden = true;
      question.textContent = "";
      greeting.hidden = false;
      starters.hidden = false;
      expanded = false;
      setPhase("clear");
      sync();
    },
    sync,
    page,
    destroy() {
      ac.abort();
    },
  };
}
