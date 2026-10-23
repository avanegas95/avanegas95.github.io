import { DEFAULT_MOOD, isModelMood, type ModelMood } from "../moods";

// SCOPE §5.4: the reply may start with `<mood>X</mood>`. We buffer only until
// that can be decided; afterwards chunks pass through untouched.
export const MOOD_BUFFER_CHARS = 40;

const OPEN = "<mood>";
const CLOSE = "</mood>";

export type MoodParseResult = { mood?: ModelMood; text: string };

export function createMoodParser(): {
  push(chunk: string): MoodParseResult;
  end(): MoodParseResult;
} {
  let decided = false;
  let buf = "";
  // The single space/newline after a closed tag may arrive in a later chunk.
  let stripPending = false;

  const stripOne = (t: string): string => {
    if (t === "") return t;
    stripPending = false;
    return t[0] === " " || t[0] === "\n" ? t.slice(1) : t;
  };

  const decide = (mood: ModelMood, text: string): MoodParseResult => {
    decided = true;
    buf = "";
    return { mood, text };
  };

  // `final`: the stream ended, so waiting is no longer possible.
  const evaluate = (final: boolean): MoodParseResult => {
    const s = buf.trimStart();
    if (s === "") {
      return final ? decide(DEFAULT_MOOD, buf) : { text: "" };
    }
    if (!s.startsWith(OPEN)) {
      if (OPEN.startsWith(s) && !final) return { text: "" }; // partial `<mo`
      return decide(DEFAULT_MOOD, buf); // not a tag: whole buffer is text
    }
    const idx = s.indexOf(CLOSE);
    if (idx !== -1 && idx + CLOSE.length <= MOOD_BUFFER_CHARS) {
      const raw = s.slice(OPEN.length, idx).trim().toLowerCase();
      const mood = isModelMood(raw) ? raw : DEFAULT_MOOD;
      stripPending = true;
      return decide(mood, stripOne(s.slice(idx + CLOSE.length)));
    }
    if (s.length >= MOOD_BUFFER_CHARS || final) {
      // Never closed: drop the literal opener, pass the rest through.
      return decide(DEFAULT_MOOD, s.slice(OPEN.length));
    }
    return { text: "" };
  };

  return {
    push(chunk) {
      if (decided) return { text: stripPending ? stripOne(chunk) : chunk };
      buf += chunk;
      return evaluate(false);
    },
    end() {
      if (decided) return { text: "" };
      return evaluate(true);
    },
  };
}
