import { describe, expect, it } from "vitest";
import { logMetric, type ChatMetric } from "../../src/lib/server/log.ts";

describe("logMetric", () => {
  it("drops extra keys and emits one JSON line", () => {
    const lines: string[] = [];
    const wide = {
      evt: "chat",
      status: 200,
      mood: "happy",
      text: "fake question text",
      ip: "192.0.2.1",
      apiKey: "fake-key",
    };
    logMetric(wide as ChatMetric, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(JSON.parse(lines[0]!)).toEqual({
      evt: "chat",
      status: 200,
      mood: "happy",
    });
    expect(lines[0]).not.toMatch(/fake question text|192\.0\.2\.1|fake-key/);
  });
  it("keeps zero values and omits undefined", () => {
    const lines: string[] = [];
    logMetric(
      {
        evt: "chat",
        status: 429,
        turns: 0,
        code: undefined,
      } as unknown as ChatMetric,
      (l) => lines.push(l),
    );
    expect(JSON.parse(lines[0]!)).toEqual({
      evt: "chat",
      status: 429,
      turns: 0,
    });
  });
});
