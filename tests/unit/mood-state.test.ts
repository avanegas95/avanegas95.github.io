import { describe, expect, it } from "vitest";
import {
  ERROR_HOLD_MS,
  INITIAL_MOOD_STATE,
  SLEEPY_AFTER_MS,
  nextMood,
  resting,
  type MoodInput,
  type MoodState,
} from "../../src/scripts/blob/mood-state";

const S = (
  mood: MoodState["mood"],
  busy: boolean,
  replyMood: MoodState["replyMood"],
): MoodState => ({ mood, busy, replyMood });

const ALL_INPUTS: MoodInput[] = [
  { type: "typing" },
  { type: "inputBlur" },
  { type: "send" },
  { type: "mood", mood: "excited" },
  { type: "firstDelta" },
  { type: "done" },
  { type: "error" },
  { type: "errorExpired" },
  { type: "idleTimeout" },
  { type: "wake" },
  { type: "clear" },
];

describe("mood-state constants", () => {
  it("exports the initial state and timing constants", () => {
    expect(INITIAL_MOOD_STATE).toEqual(S("idle", false, null));
    expect(SLEEPY_AFTER_MS).toBe(60000);
    expect(ERROR_HOLD_MS).toBe(2000);
  });
});

describe("resting", () => {
  it("returns the reply mood when one is set, otherwise idle", () => {
    expect(resting(S("idle", false, "proud"))).toBe("proud");
    expect(resting(S("sleepy", false, null))).toBe("idle");
  });
});

describe("nextMood transitions", () => {
  it("clear resets to the initial state", () => {
    expect(nextMood(S("happy", true, "happy"), { type: "clear" })).toEqual(
      S("idle", false, null),
    );
  });

  it("send starts thinking", () => {
    expect(nextMood(S("proud", false, "proud"), { type: "send" })).toEqual(
      S("thinking", true, null),
    );
  });

  it("mood applies the model mood while busy", () => {
    expect(
      nextMood(S("thinking", true, null), { type: "mood", mood: "excited" }),
    ).toEqual(S("excited", true, "excited"));
  });

  it("mood is a no-op when not busy", () => {
    const s = S("idle", false, null);
    expect(nextMood(s, { type: "mood", mood: "excited" })).toBe(s);
  });

  it("firstDelta switches thinking to the default reply mood", () => {
    expect(nextMood(S("thinking", true, null), { type: "firstDelta" })).toEqual(
      S("happy", true, "happy"),
    );
  });

  it("firstDelta is a no-op once a mood is already showing", () => {
    const s = S("proud", true, "proud");
    expect(nextMood(s, { type: "firstDelta" })).toBe(s);
  });

  it("done ends busy and keeps the reply mood", () => {
    expect(nextMood(S("proud", true, "proud"), { type: "done" })).toEqual(
      S("proud", false, "proud"),
    );
  });

  it("done is a no-op when not busy", () => {
    const s = S("idle", false, null);
    expect(nextMood(s, { type: "done" })).toBe(s);
  });

  it("error shows the error mood and ends busy", () => {
    expect(nextMood(S("thinking", true, null), { type: "error" })).toEqual(
      S("error", false, null),
    );
  });

  it("errorExpired returns from error to resting", () => {
    const errored = nextMood(S("thinking", true, null), { type: "error" });
    expect(nextMood(errored, { type: "errorExpired" })).toEqual(
      S("idle", false, null),
    );
  });

  it("error keeps a set reply mood, and errorExpired rests on it", () => {
    const errored = nextMood(S("thinking", true, "happy"), { type: "error" });
    expect(errored).toEqual(S("error", false, "happy"));
    expect(nextMood(errored, { type: "errorExpired" })).toEqual(
      S("happy", false, "happy"),
    );
  });

  it("errorExpired is a no-op when not in error", () => {
    const s = S("happy", false, "happy");
    expect(nextMood(s, { type: "errorExpired" })).toBe(s);
  });

  it("typing shows listening when idle", () => {
    expect(nextMood(S("idle", false, null), { type: "typing" })).toEqual(
      S("listening", false, null),
    );
  });

  it("typing wakes from sleepy and keeps the reply mood", () => {
    expect(nextMood(S("sleepy", false, "happy"), { type: "typing" })).toEqual(
      S("listening", false, "happy"),
    );
  });

  it("typing is a no-op while busy", () => {
    const s = S("thinking", true, null);
    expect(nextMood(s, { type: "typing" })).toBe(s);
  });

  it("typing is a no-op during error", () => {
    const s = S("error", false, null);
    expect(nextMood(s, { type: "typing" })).toBe(s);
  });

  it("inputBlur returns listening to the reply mood", () => {
    expect(
      nextMood(S("listening", false, "curious"), { type: "inputBlur" }),
    ).toEqual(S("curious", false, "curious"));
  });

  it("inputBlur is a no-op when not listening", () => {
    const s = S("happy", false, "happy");
    expect(nextMood(s, { type: "inputBlur" })).toBe(s);
  });

  it("idleTimeout sleeps when idle and keeps the reply mood", () => {
    expect(
      nextMood(S("happy", false, "happy"), { type: "idleTimeout" }),
    ).toEqual(S("sleepy", false, "happy"));
  });

  it("idleTimeout is a no-op while busy", () => {
    const s = S("thinking", true, null);
    expect(nextMood(s, { type: "idleTimeout" })).toBe(s);
  });

  it("wake returns sleepy to the reply mood", () => {
    const slept = nextMood(S("happy", false, "happy"), { type: "idleTimeout" });
    expect(nextMood(slept, { type: "wake" })).toEqual(
      S("happy", false, "happy"),
    );
  });
});

describe("nextMood immutability", () => {
  it("never mutates the input state or input object", () => {
    const states: MoodState[] = [
      INITIAL_MOOD_STATE,
      S("thinking", true, null),
      S("proud", true, "proud"),
      S("listening", false, "curious"),
      S("error", false, null),
      S("sleepy", false, "happy"),
    ];
    for (const s of states) {
      for (const input of ALL_INPUTS) {
        const stateCopy = structuredClone(s);
        const inputCopy = structuredClone(input);
        nextMood(s, input);
        expect(s).toEqual(stateCopy);
        expect(input).toEqual(inputCopy);
      }
    }
  });
});

describe("nextMood sequence", () => {
  it("runs a full exchange from the initial state", () => {
    const inputs: MoodInput[] = [
      { type: "send" },
      { type: "mood", mood: "proud" },
      { type: "firstDelta" },
      { type: "done" },
      { type: "idleTimeout" },
      { type: "wake" },
      { type: "typing" },
      { type: "inputBlur" },
    ];
    const final = inputs.reduce(nextMood, INITIAL_MOOD_STATE);
    expect(final).toEqual(S("proud", false, "proud"));
  });
});
