import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOOD,
  isModelMood,
  MODEL_MOODS,
  MOODS,
} from "../../src/lib/moods.ts";

describe("moods", () => {
  it("matches SCOPE §4.2 order", () => {
    expect(MOODS.length).toBe(10);
    expect([...MOODS]).toEqual([
      "idle",
      "listening",
      "thinking",
      "happy",
      "excited",
      "proud",
      "curious",
      "confused",
      "sleepy",
      "error",
    ]);
  });
  it("MODEL_MOODS is a subset of MOODS and includes the default", () => {
    for (const m of MODEL_MOODS) expect(MOODS).toContain(m);
    expect(MODEL_MOODS).toContain(DEFAULT_MOOD);
  });
  it("isModelMood", () => {
    expect(isModelMood("excited")).toBe(true);
    for (const v of ["sleepy", "EXCITED", ""])
      expect(isModelMood(v)).toBe(false);
  });
});
