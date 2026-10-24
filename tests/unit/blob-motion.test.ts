import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBlobMotion,
  eyeOffset,
  MOOD_EMOJI,
  nextBlinkDelay,
} from "../../src/scripts/blob/motion.ts";
import { MOODS } from "../../src/lib/moods.ts";

describe("nextBlinkDelay", () => {
  it("spans 3000..7000 ms inclusive", () => {
    expect(nextBlinkDelay(() => 0)).toBe(3000);
    expect(nextBlinkDelay(() => 0.9999999)).toBeLessThanOrEqual(7000);
    expect(nextBlinkDelay(() => 0.9999999)).toBeGreaterThan(6990);
    expect(nextBlinkDelay(() => 0.5)).toBe(5000);
  });
});

describe("eyeOffset", () => {
  it("is zero at the centre", () => {
    expect(eyeOffset(50, 50, 50, 50, 4)).toEqual({ x: 0, y: 0 });
  });
  it("is clamped to the radius for a far pointer", () => {
    for (const [px, py] of [
      [1000, 0],
      [-300, 400],
      [0, -9999],
    ] as const) {
      const o = eyeOffset(px, py, 0, 0, 4);
      expect(Math.hypot(o.x, o.y)).toBeCloseTo(4, 10);
    }
  });
  it("passes small offsets through unchanged", () => {
    expect(eyeOffset(51, 52, 50, 50, 4)).toEqual({ x: 1, y: 2 });
  });
});

describe("MOOD_EMOJI", () => {
  it("has exactly the mood keys and matches SCOPE 4.2", () => {
    expect(Object.keys(MOOD_EMOJI).sort()).toEqual([...MOODS].sort());
    expect(MOOD_EMOJI).toEqual({
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
    });
  });
});

function fakeFigure() {
  const emoji = { textContent: "" };
  const props = new Map<string, string>();
  const figure = {
    dataset: { mood: "idle", talking: "false" } as Record<string, string>,
    style: { setProperty: (k: string, v: string) => props.set(k, v) },
    querySelector: () => emoji,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  return { figure: figure as unknown as HTMLElement, emoji, props };
}

function stubEnv(reduce = false) {
  const listeners = new Set<string>();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") ? reduce : true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("addEventListener", (t: string) => listeners.add(t));
  vi.stubGlobal("removeEventListener", (t: string) => listeners.delete(t));
  return listeners;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createBlobMotion", () => {
  it("sets mood/talking attributes and pops the emoji on change only", () => {
    vi.useFakeTimers();
    stubEnv();
    const { figure, emoji } = fakeFigure();
    const m = createBlobMotion(figure);
    m.setMood("happy");
    expect(figure.dataset["mood"]).toBe("happy");
    expect(emoji.textContent).toBe("😄");
    expect(figure.dataset["pop"]).toBe("1");
    vi.advanceTimersByTime(1300);
    expect(figure.dataset["pop"]).toBeUndefined();
    m.setMood("happy");
    expect(figure.dataset["pop"]).toBeUndefined();
    m.setMood("idle");
    expect(emoji.textContent).toBe("");
    m.setTalking(true);
    expect(figure.dataset["talking"]).toBe("true");
    m.destroy();
  });

  it("blinks on a timer and destroy() clears every timer and listener", () => {
    vi.useFakeTimers();
    const listeners = stubEnv();
    const { figure } = fakeFigure();
    const m = createBlobMotion(figure, { track: true });
    expect(listeners.has("pointermove")).toBe(true);
    vi.advanceTimersByTime(7001);
    m.setMood("happy");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    m.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it("does not track the pointer under reduced motion", () => {
    vi.useFakeTimers();
    const listeners = stubEnv(true);
    const { figure } = fakeFigure();
    const m = createBlobMotion(figure, { track: true });
    expect(listeners.has("pointermove")).toBe(false);
    m.destroy();
  });
});
