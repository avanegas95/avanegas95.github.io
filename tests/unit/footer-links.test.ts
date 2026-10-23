import { describe, expect, it } from "vitest";
import { footerLinks } from "../../src/data/footer-links";

describe("footerLinks", () => {
  it("has exactly 3 entries", () => {
    expect(footerLinks).toHaveLength(3);
  });
  it("uses same-site hrefs that start and end with a slash", () => {
    for (const l of footerLinks) {
      expect(l.href.startsWith("/")).toBe(true);
      expect(l.href.endsWith("/")).toBe(true);
    }
  });
  it("has unique labels", () => {
    expect(new Set(footerLinks.map((l) => l.label)).size).toBe(
      footerLinks.length,
    );
  });
});
