import { describe, expect, it } from "vitest";
import {
  KB_ROOT,
  KB_TOKEN_BUDGET,
  buildKb,
  estimateTokens,
  loadKbSources,
} from "../../src/lib/kb.ts";

describe("kb budget", () => {
  it("real KB loads and fits the token budget", () => {
    const kb = buildKb(loadKbSources(KB_ROOT));
    expect(estimateTokens(kb)).toBeLessThanOrEqual(KB_TOKEN_BUDGET);
  });
});
