// Conversation wiring for <blob-agent> (SCOPE §4.2-§4.4, §5.4): submit -> /api/chat stream ->
// safe markdown in the log, moods on both figures, friendly errors, clear chat.
// Owns every timer and listener it creates; destroy() removes them all.
import type { ClientErrorCode, streamChat } from "./chat-client";
import { COPY } from "./copy";
import type { BlobAgent } from "./element";
import { buildRequest, newSessionId, type Turn } from "./history";
import { appendAssistant, appendUser } from "./messages";
import {
  ERROR_HOLD_MS,
  INITIAL_MOOD_STATE,
  SLEEPY_AFTER_MS,
  nextMood,
  type MoodInput,
} from "./mood-state";

export type ConversationDeps = {
  stream: typeof streamChat;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

type Timer = ReturnType<typeof setTimeout>;
type Reply = ReturnType<typeof appendAssistant>;

const NEAR_BOTTOM_PX = 32;
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "input"] as const;

export function attachConversation(
  el: BlobAgent,
  deps: ConversationDeps,
): { destroy(): void } {
  // Resolved per call so test fake timers installed later still apply.
  const now = (): number => (deps.now ?? Date.now)();
  const later = (fn: () => void, ms: number): Timer =>
    deps.setTimeout ? deps.setTimeout(fn, ms) : setTimeout(fn, ms);
  const cancel = (t: Timer | undefined): void => {
    if (t === undefined) return;
    if (deps.clearTimeout) deps.clearTimeout(t);
    else clearTimeout(t);
  };

  const ac = new AbortController();
  const on = { signal: ac.signal };
  const log = el.log;
  const sendButton = el.querySelector<HTMLButtonElement>(
    '[data-ba="form"] [type="submit"]',
  );

  let state = INITIAL_MOOD_STATE;
  let history: Turn[] = [];
  let sessionId = newSessionId();
  // The in-flight request; null when idle. Doubles as the "busy" flag.
  let inflight: AbortController | null = null;
  let errorTimer: Timer | undefined;
  let idleTimer: Timer | undefined;
  let lastActive = now();
  let frame = 0;
  let paint: (() => void) | null = null;
  let failInflight: ((code: ClientErrorCode) => void) | null = null;

  const mood = (i: MoodInput): void => {
    state = nextMood(state, i);
    el.heroMotion?.setMood(state.mood);
    el.avatarMotion?.setMood(state.mood);
  };
  const talking = (v: boolean): void => {
    el.heroMotion?.setTalking(v);
    el.avatarMotion?.setTalking(v);
  };

  const setBusy = (busy: boolean): void => {
    if (!sendButton) return;
    if (busy && sendButton.ownerDocument.activeElement === sendButton) {
      el.input.focus(); // a disabled button would drop focus to <body>
    }
    sendButton.disabled = busy;
    if (busy) sendButton.setAttribute("aria-disabled", "true");
    else sendButton.removeAttribute("aria-disabled");
  };

  const cancelFrame = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    paint = null;
  };
  const flush = (): void => {
    const p = paint;
    cancelFrame();
    p?.();
  };

  const scrollDown = (): void => {
    log.scrollTop = log.scrollHeight;
  };
  // Runs a content change and follows it to the bottom only if the reader was already there
  // (within NEAR_BOTTOM_PX), so scrolling up to re-read is never yanked back down.
  const follow = (change: () => void): void => {
    const stick =
      log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_BOTTOM_PX;
    change();
    if (stick) scrollDown();
  };

  // Ends the in-flight request's UI state. Callbacks from it are ignored afterwards.
  const finish = (): void => {
    inflight = null;
    failInflight = null;
    log.setAttribute("aria-busy", "false");
    talking(false);
    setBusy(false);
  };

  const showError = (reply: Reply, code: ClientErrorCode): void => {
    follow(() => reply.setError(COPY.errors[code]));
    mood({ type: "error" });
    cancel(errorTimer);
    errorTimer = later(() => {
      errorTimer = undefined;
      mood({ type: "errorExpired" });
    }, ERROR_HOLD_MS);
  };

  const submit = (raw: string): void => {
    const text = raw.trim();
    if (text === "" || inflight) return;
    cancel(errorTimer);
    errorTimer = undefined;
    appendUser(log, text);
    const reply = appendAssistant(log);
    scrollDown();
    const req = buildRequest(
      [...history, { role: "user", content: text }],
      sessionId,
    );
    if (req === null) {
      showError(reply, "invalid");
      return;
    }

    const ctrl = new AbortController();
    inflight = ctrl;
    setBusy(true);
    mood({ type: "send" });
    const live = (): boolean => inflight === ctrl;
    let buffer = "";
    let started = false;
    let badged = false;
    const render = (): void => {
      follow(() => reply.setMarkdown(buffer));
    };
    const fail = (code: ClientErrorCode): void => {
      if (!live()) return;
      cancelFrame();
      finish();
      showError(reply, code);
    };
    failInflight = fail;

    deps
      .stream(
        req.body,
        {
          onMood(m) {
            if (!live()) return;
            mood({ type: "mood", mood: m });
            reply.setMood(m);
            badged = true;
          },
          onDelta(t) {
            if (!live()) return;
            if (!started) {
              started = true;
              mood({ type: "firstDelta" });
              if (!badged && state.replyMood) reply.setMood(state.replyMood);
              badged = true;
              log.setAttribute("aria-busy", "true");
              talking(true);
            }
            buffer += t;
            paint = render;
            frame ||= requestAnimationFrame(flush);
          },
          onReset() {
            if (!live()) return;
            cancelFrame();
            buffer = "";
            reply.setMarkdown("");
          },
          onDone() {
            if (!live()) return;
            cancelFrame();
            if (buffer.trim() === "") {
              // Nothing visible arrived: never leave an empty bubble or an empty history turn.
              finish();
              showError(reply, "upstream");
              return;
            }
            render();
            history = [
              ...history,
              { role: "user", content: text },
              { role: "assistant", content: buffer },
            ];
            finish();
            mood({ type: "done" });
          },
          onError: fail,
        },
        { signal: ctrl.signal },
      )
      .catch(() => fail("upstream"));
  };

  // Aborts the in-flight request, if any. Returns whether there was one.
  const abort = (): boolean => {
    const ctrl = inflight;
    if (!ctrl) return false;
    cancelFrame();
    finish();
    ctrl.abort();
    return true;
  };

  const clear = (): void => {
    abort();
    cancel(errorTimer);
    errorTimer = undefined;
    log.replaceChildren();
    history = [];
    sessionId = newSessionId();
    mood({ type: "clear" });
    el.input.focus();
  };

  // Sleepy after SLEEPY_AFTER_MS without activity. Activity only stamps the time; the single
  // timer re-arms for whatever is left, so pointermove stays cheap.
  const armIdle = (ms: number): void => {
    idleTimer = later(() => {
      const left = SLEEPY_AFTER_MS - (now() - lastActive);
      if (left > 0) return armIdle(left);
      mood({ type: "idleTimeout" });
      // Busy or showing an error: try again later. Asleep: wait for activity.
      if (state.mood === "sleepy") idleTimer = undefined;
      else armIdle(SLEEPY_AFTER_MS);
    }, ms);
  };
  const activity = (): void => {
    lastActive = now();
    if (state.mood === "sleepy") mood({ type: "wake" });
    if (idleTimer === undefined) armIdle(SLEEPY_AFTER_MS);
  };

  el.addEventListener(
    "blob:submit",
    (e) => {
      const detail = (e as CustomEvent<{ text?: unknown } | null>).detail;
      if (typeof detail?.text === "string") submit(detail.text);
    },
    on,
  );
  el.addEventListener("blob:clear", clear, on);
  el.addEventListener("blob:typing", () => mood({ type: "typing" }), on);
  el.input.addEventListener("blur", () => mood({ type: "inputBlur" }), on);
  for (const type of ACTIVITY) {
    document.addEventListener(type, activity, {
      capture: true,
      passive: true,
      signal: ac.signal,
    });
  }
  // Closing the panel keeps the reply streaming; leaving the page does not.
  addEventListener(
    "pagehide",
    () => {
      const ctrl = inflight;
      if (!ctrl) return;
      failInflight?.("network");
      ctrl.abort();
    },
    on,
  );
  // A (re)attached element starts fresh: empty log, idle figures (setMood skips an unchanged
  // mood, so this also syncs figures left on another mood by an earlier attach).
  log.replaceChildren();
  log.setAttribute("aria-busy", "false");
  mood({ type: "clear" });
  armIdle(SLEEPY_AFTER_MS);

  return {
    destroy() {
      abort();
      ac.abort();
      cancel(errorTimer);
      cancel(idleTimer);
      errorTimer = idleTimer = undefined;
    },
  };
}
