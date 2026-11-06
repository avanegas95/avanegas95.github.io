import { describe, expect, it } from "vitest";
import { navItems } from "../../src/data/nav";

describe("nav (P5.5-08b)", () => {
  it("labels and order", () => {
    expect(navItems.map((i) => i.label)).toEqual([
      "Home",
      "Experience",
      "Projects",
      "Contact",
      "Blog",
    ]);
  });

  it("points Experience at #experience", () => {
    expect(navItems.map((i) => i.href)).toEqual([
      "#home",
      "#experience",
      "#projects",
      "#contact",
      "/blog/",
    ]);
  });

  it("gives every item its own icon; Experience is the briefcase", () => {
    expect(new Set(navItems.map((i) => i.icon)).size).toBe(5);
    expect(navItems[1]!.icon).toContain("M21 13.255");
  });
});
