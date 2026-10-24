// Blob's speech bubble: the latest answer in full (clamped to a max height with "Show more"),
// the question above it, earlier turns behind a "Previous" toggle. DOM only, no timers.
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

export type Bubble = {
  readonly phase: Phase;
  /** Starts a turn: archives the finished one, shows the question, returns the new reply. */
  ask(question: string): Reply;
  delta(): void;
  done(): void;
  fail(): void;
  clear(): void;
  /** Re-measures the clamp after the content changed or the width did. */
  sync(): void;
  togglePrevious(force?: boolean): void;
  destroy(): void;
};

function hook<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const el = root.querySelector<T>(`[data-ba="${name}"]`);
  if (!el) throw new Error(`blob-agent: missing [data-ba="${name}"]`);
  return el;
}

export function createBubble(root: HTMLElement): Bubble {
  const doc = root.ownerDocument;
  const bubble = hook(root, "bubble");
  const question = hook(root, "question");
  const clip = hook(root, "clip");
  const greeting = hook(root, "greeting");
  const starters = hook(root, "starters");
  const more = hook<HTMLButtonElement>(root, "more");
  const prevWrap = hook(root, "previous-wrap");
  const prevToggle = hook<HTMLButtonElement>(root, "previous");
  const prevList = hook(root, "history");
  const ac = new AbortController();

  let phase: Phase = "idle";
  let expanded = false;
  let current: { question: string; reply: Reply } | null = null;

  const setPhase = (e: BubbleEvent): void => {
    phase = nextPhase(phase, e);
    bubble.dataset["phase"] = phase;
  };

  const sync = (): void => {
    const clamped = clip.scrollHeight > clip.clientHeight + 1;
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

  const syncPrevious = (): void => {
    const n = prevList.childElementCount;
    prevWrap.hidden = n === 0;
    togglePrevious(
      n > 0 && prevToggle.getAttribute("aria-expanded") === "true",
    );
  };

  function togglePrevious(force?: boolean): void {
    const open = force ?? prevToggle.getAttribute("aria-expanded") !== "true";
    prevToggle.setAttribute("aria-expanded", String(open));
    prevList.hidden = !open;
    const n = prevList.childElementCount;
    prevToggle.textContent = `${open ? COPY.previousHide : COPY.previous} (${n})`;
  }

  // Moves the finished turn into the "Previous" list; failed turns are dropped (as in history).
  const archive = (): void => {
    const turn = current;
    current = null;
    if (!turn || phase !== "done") return;
    const li = doc.createElement("li");
    li.className = "ba-prev-turn";
    const q = doc.createElement("p");
    q.className = "ba-prev-q";
    q.textContent = turn.question;
    li.append(q, turn.reply.el);
    prevList.append(li);
    while (prevList.childElementCount > MAX_TURNS - 1) {
      prevList.firstElementChild?.remove();
    }
    syncPrevious();
  };

  more.addEventListener("click", () => setExpanded(!expanded), {
    signal: ac.signal,
  });
  prevToggle.addEventListener("click", () => togglePrevious(), {
    signal: ac.signal,
  });
  addEventListener("resize", sync, { signal: ac.signal, passive: true });

  // A (re)attached element starts clean.
  bubble.dataset["phase"] = phase;
  question.hidden = true;
  togglePrevious(false);
  syncPrevious();
  sync();

  return {
    get phase() {
      return phase;
    },
    ask(text) {
      archive();
      for (const old of clip.querySelectorAll(":scope > .ba-msg")) old.remove();
      greeting.hidden = true;
      starters.hidden = true;
      question.textContent = text;
      question.hidden = false;
      setPhase("ask");
      expanded = false;
      const reply = appendAssistant(clip);
      current = { question: text, reply };
      sync();
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
      current = null;
      for (const old of clip.querySelectorAll(":scope > .ba-msg")) old.remove();
      prevList.replaceChildren();
      question.hidden = true;
      question.textContent = "";
      greeting.hidden = false;
      starters.hidden = false;
      expanded = false;
      setPhase("clear");
      syncPrevious();
      sync();
    },
    sync,
    togglePrevious,
    destroy() {
      ac.abort();
    },
  };
}
