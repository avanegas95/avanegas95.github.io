import { describe, expect, it } from "vitest";
import {
  createMoodParser,
  MOOD_BUFFER_CHARS,
} from "../../src/lib/server/mood-parser";

type Out = { mood?: string; text: string };

function run(chunks: string[]): { moods: string[]; text: string; log: Out[] } {
  const p = createMoodParser();
  const log: Out[] = [];
  for (const c of chunks) log.push(p.push(c));
  log.push(p.end());
  return {
    moods: log.flatMap((r) => (r.mood ? [r.mood] : [])),
    text: log.map((r) => r.text).join(""),
    log,
  };
}
const chars = (s: string) => [...s];

const A40 = "a".repeat(40);
const table: [string, string, string][] = [
  ["<mood>excited</mood> Hi", "excited", "Hi"],
  ["<mood> PROUD </mood>\nYes", "proud", "Yes"],
  ["<mood>sleepy</mood>x", "happy", "x"],
  ["<mood>banana</mood>x", "happy", "x"],
  ["Hello", "happy", "Hello"],
  ["  <mood>curious</mood>?", "curious", "?"],
  ["<mo", "happy", "<mo"],
  ["<mood>" + A40, "happy", A40],
  ["<mood>happy</mood><mood>proud</mood>z", "happy", "<mood>proud</mood>z"],
  ["", "happy", ""],
  ["<mood>confused</mood>", "confused", ""],
  ["<mood>confused</mood>  two", "confused", " two"],
  ["<mood>happy</mood>\n\nA", "happy", "\nA"],
  ["<mood>happy", "happy", "happy"],
];

describe("mood parser table", () => {
  for (const [input, mood, text] of table) {
    it(`whole: ${JSON.stringify(input)}`, () => {
      const r = run([input]);
      expect(r.moods).toEqual([mood]);
      expect(r.text).toBe(text);
    });
    it(`1-char chunks: ${JSON.stringify(input)}`, () => {
      const r = run(chars(input));
      expect(r.moods).toEqual([mood]);
      expect(r.text).toBe(text);
    });
  }

  it('"<" then "b>bold" stays plain text', () => {
    const r = run(["<", "b>bold"]);
    expect(r.moods).toEqual(["happy"]);
    expect(r.text).toBe("<b>bold");
  });

  it("handles a tag split at every position", () => {
    const s = "<mood>excited</mood> Hi there";
    for (let i = 1; i < s.length; i++) {
      const r = run([s.slice(0, i), s.slice(i)]);
      expect(r.moods).toEqual(["excited"]);
      expect(r.text).toBe("Hi there");
    }
  });
});

describe("mood parser invariants", () => {
  it("reports mood once, before any text", () => {
    for (const input of [
      "<mood>proud</mood>Hello world",
      "Hello world",
      "<mood>nope</mood>Hello",
      "<mood>" + A40 + "tail",
    ]) {
      const { log } = run(chars(input));
      const firstMood = log.findIndex((r) => r.mood !== undefined);
      const firstText = log.findIndex((r) => r.text !== "");
      expect(log.filter((r) => r.mood !== undefined)).toHaveLength(1);
      if (firstText !== -1) expect(firstMood).toBeLessThanOrEqual(firstText);
    }
  });

  it("never leaks tag text for an unknown mood", () => {
    expect(run(chars("<mood>banana</mood>Hi")).text).toBe("Hi");
  });

  it("treats a close beyond the buffer window as unclosed", () => {
    const long = "<mood>" + "x".repeat(MOOD_BUFFER_CHARS) + "</mood>Hi";
    const r = run([long]);
    expect(r.moods).toEqual(["happy"]);
    expect(r.text).toBe("x".repeat(MOOD_BUFFER_CHARS) + "</mood>Hi");
  });

  it("passes chunks through unchanged after the decision", () => {
    const p = createMoodParser();
    p.push("<mood>happy</mood>A");
    expect(p.push("<mood>proud</mood>")).toEqual({
      text: "<mood>proud</mood>",
    });
    expect(p.end()).toEqual({ text: "" });
  });

  it("end() on an empty stream is happy with no text", () => {
    expect(createMoodParser().end()).toEqual({ mood: "happy", text: "" });
  });
});

describe("mood parser 40-char boundary", () => {
  const tag = (n: number) => "<mood>" + "x".repeat(n) + "</mood>";
  it("parses a close ending exactly at char 40", () => {
    const s = tag(27) + "Hi";
    expect(s.indexOf("Hi")).toBe(MOOD_BUFFER_CHARS);
    for (const chunks of [[s], chars(s), [s.slice(0, 20), s.slice(20)]]) {
      const r = run(chunks);
      expect(r.moods).toEqual(["happy"]);
      expect(r.text).toBe("Hi");
    }
  });
  it("does not parse a close ending at char 41", () => {
    const s = tag(28) + "Hi";
    for (const chunks of [[s], chars(s), [s.slice(0, 20), s.slice(20)]]) {
      const r = run(chunks);
      expect(r.moods).toEqual(["happy"]);
      expect(r.text).toBe("x".repeat(28) + "</mood>Hi");
    }
  });
});
