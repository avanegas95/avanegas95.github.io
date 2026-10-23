// Pure mood reducer for Blob (SCOPE §4.2). No DOM, no timers: P3-09 owns those and calls this.
import type { Mood, ModelMood } from "../../lib/moods";
import { DEFAULT_MOOD } from "../../lib/moods";

export type MoodInput =
  | { type: "typing" }
  | { type: "inputBlur" }
  | { type: "send" }
  | { type: "mood"; mood: ModelMood }
  | { type: "firstDelta" }
  | { type: "done" }
  | { type: "error" }
  | { type: "errorExpired" }
  | { type: "idleTimeout" }
  | { type: "wake" }
  | { type: "clear" };

export type MoodState = {
  mood: Mood;
  busy: boolean;
  replyMood: ModelMood | null;
};

export const INITIAL_MOOD_STATE: MoodState = {
  mood: "idle",
  busy: false,
  replyMood: null,
};

export const SLEEPY_AFTER_MS = 60_000;
export const ERROR_HOLD_MS = 2_000;

/** The mood Blob rests on when no client-owned state is showing. */
export function resting(s: MoodState): Mood {
  return s.replyMood ?? "idle";
}

/** Returns the next state for an input. Never mutates `s`; returns `s` itself when nothing changes. */
export function nextMood(s: MoodState, i: MoodInput): MoodState {
  switch (i.type) {
    case "clear":
      return INITIAL_MOOD_STATE;

    case "send":
      return { mood: "thinking", busy: true, replyMood: null };

    case "error":
      return { mood: "error", busy: false, replyMood: s.replyMood };

    case "errorExpired":
      return s.mood === "error" ? { ...s, mood: resting(s) } : s;

    case "mood":
      return s.busy ? { mood: i.mood, busy: true, replyMood: i.mood } : s;

    case "firstDelta":
      return s.busy && s.mood === "thinking"
        ? { mood: DEFAULT_MOOD, busy: true, replyMood: DEFAULT_MOOD }
        : s;

    case "done":
      return s.busy ? { ...s, busy: false } : s;

    case "typing":
      return !s.busy && s.mood !== "error" ? { ...s, mood: "listening" } : s;

    case "inputBlur":
      return s.mood === "listening" ? { ...s, mood: resting(s) } : s;

    case "idleTimeout":
      return !s.busy && s.mood !== "error" ? { ...s, mood: "sleepy" } : s;

    case "wake":
      return s.mood === "sleepy" ? { ...s, mood: resting(s) } : s;
  }
}
