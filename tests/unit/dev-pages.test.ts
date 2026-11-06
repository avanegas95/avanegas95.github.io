import { describe, expect, it } from "vitest";
import { devPreviewEnabled } from "../../src/lib/dev-pages.ts";

describe("devPreviewEnabled", () => {
  it("is false only for production", () => {
    expect(devPreviewEnabled("production")).toBe(false);
    expect(devPreviewEnabled("preview")).toBe(true);
    expect(devPreviewEnabled("development")).toBe(true);
    expect(devPreviewEnabled(undefined)).toBe(true);
  });
});
