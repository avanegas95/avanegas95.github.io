// Blob motion controller. Sets attributes and CSS custom properties only (CSP-safe).
import type { Mood } from "../../lib/moods";

// SCOPE §4.2. idle has no emoji.
export const MOOD_EMOJI: Record<Mood, string | null> = {
  idle: null,
  listening: "✍️",
  thinking: "🤔",
  happy: "😄",
  excited: "🤩",
  proud: "😎",
  curious: "🧐",
  confused: "😅",
  sleepy: "😴",
  error: "🫠",
};

const POP_MS = 1200;
const BLINK_MS = 140;
const SLOW_BLINK_MS = 320;
const TRACK_RADIUS = 4; // viewBox units
const TRACK_SCALE = 30; // pointer distance (px) for full deflection

export function nextBlinkDelay(rand: () => number): number {
  return Math.round(3000 + rand() * 4000);
}

export function eyeOffset(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const dx = px - cx;
  const dy = py - cy;
  const len = Math.hypot(dx, dy);
  if (len <= radius) return { x: dx + 0, y: dy + 0 };
  const k = radius / len;
  return { x: dx * k, y: dy * k };
}

export type BlobMotion = {
  setMood(m: Mood): void;
  setTalking(on: boolean): void;
  destroy(): void;
};

export function createBlobMotion(
  figure: HTMLElement,
  opts?: { track?: boolean },
): BlobMotion {
  const emoji = figure.querySelector(".blob-emoji");
  const reduce = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = globalThis.matchMedia("(pointer: fine)");
  let blinkTimer: ReturnType<typeof setTimeout> | undefined;
  let popTimer: ReturnType<typeof setTimeout> | undefined;
  let tracking = false;
  let dead = false;

  const scheduleBlink = (): void => {
    blinkTimer = setTimeout(() => {
      figure.dataset["blink"] = "1";
      const slow = figure.dataset["mood"] === "thinking";
      blinkTimer = setTimeout(
        () => {
          delete figure.dataset["blink"];
          if (!dead) scheduleBlink();
        },
        slow ? SLOW_BLINK_MS : BLINK_MS,
      );
    }, nextBlinkDelay(Math.random));
  };

  const onMove = (e: PointerEvent): void => {
    const r = figure.getBoundingClientRect();
    const o = eyeOffset(
      e.clientX / TRACK_SCALE,
      e.clientY / TRACK_SCALE,
      (r.left + r.width / 2) / TRACK_SCALE,
      (r.top + r.height / 2) / TRACK_SCALE,
      TRACK_RADIUS,
    );
    figure.style.setProperty("--eye-x", o.x.toFixed(2));
    figure.style.setProperty("--eye-y", o.y.toFixed(2));
  };

  const syncTracking = (): void => {
    const want = !!opts?.track && fine.matches && !reduce.matches;
    if (want && !tracking) {
      globalThis.addEventListener("pointermove", onMove);
    } else if (!want && tracking) {
      globalThis.removeEventListener("pointermove", onMove);
      figure.style.setProperty("--eye-x", "0");
      figure.style.setProperty("--eye-y", "0");
    }
    tracking = want;
  };

  syncTracking();
  reduce.addEventListener("change", syncTracking);
  fine.addEventListener("change", syncTracking);
  scheduleBlink();

  return {
    setMood(m) {
      if (figure.dataset["mood"] === m) return;
      figure.dataset["mood"] = m;
      const glyph = MOOD_EMOJI[m];
      clearTimeout(popTimer);
      delete figure.dataset["pop"];
      if (emoji) emoji.textContent = glyph ?? "";
      if (glyph) {
        void figure.offsetWidth; // restart the CSS animation
        figure.dataset["pop"] = "1";
        popTimer = setTimeout(() => delete figure.dataset["pop"], POP_MS);
      }
    },
    setTalking(on) {
      figure.dataset["talking"] = on ? "true" : "false";
    },
    destroy() {
      dead = true;
      clearTimeout(blinkTimer);
      clearTimeout(popTimer);
      delete figure.dataset["blink"];
      delete figure.dataset["pop"];
      if (tracking) globalThis.removeEventListener("pointermove", onMove);
      tracking = false;
      reduce.removeEventListener("change", syncTracking);
      fine.removeEventListener("change", syncTracking);
    },
  };
}
