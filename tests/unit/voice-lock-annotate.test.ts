import { describe, expect, it } from "vitest";
import {
  annotations,
  lockChanges,
} from "../../scripts/ci/voice-lock-annotate.ts";

describe("voice-lock CI annotations", () => {
  it("lists changed, added and removed fields as GitHub warnings", () => {
    const lines = lockChanges({ a: "1", b: "1" }, { a: "2", c: "1" });
    expect(lines).toEqual(["changed: a", "added: c", "removed: b"]);
    expect(annotations(lines)[0]).toBe(
      "::warning file=voice.lock.json,title=Voice lock changed::changed: a",
    );
  });

  it("prints nothing when the lock is unchanged", () => {
    expect(lockChanges({ a: "1" }, { a: "1" })).toEqual([]);
  });
});
