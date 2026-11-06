import { describe, expect, it } from "vitest";
import { COPY } from "../../src/scripts/blob/copy.ts";
import { scanText } from "../../src/lib/pii.ts";

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

const all = strings(COPY);

describe("COPY SCOPE strings", () => {
  it("matches SCOPE 4.3 bubble and chips", () => {
    expect(COPY.greeting).toBe("Hi! I'm Blob. Ask me anything about Anderson.");
    expect(COPY.chips).toHaveLength(4);
    expect([...COPY.chips]).toEqual([
      "What does he do at Boston Dynamics?",
      "Show me his projects",
      "What's his test automation stack?",
      "Can I get his resume?",
    ]);
  });

  it("joins the disclaimer and no-JS parts into the SCOPE sentences", () => {
    const d = COPY.disclaimer;
    expect(d.before + d.linkLabel + d.after).toBe(
      "Blob is an AI and can make mistakes. Ask Anderson directly via contact.",
    );
    const n = COPY.noJs;
    expect(n.before + n.resume + n.middle + n.contact + n.after).toBe(
      "Chat needs JavaScript. Here's the resume and contact.",
    );
  });
});

describe("COPY errors", () => {
  const keys = [
    "bot",
    "budget",
    "invalid",
    "network",
    "rate_limited",
    "unavailable",
    "upstream",
  ];

  it("has exactly the 7 keys, each 1..140 chars", () => {
    expect(Object.keys(COPY.errors).sort()).toEqual(keys);
    for (const m of Object.values(COPY.errors)) {
      expect(m.text.length).toBeGreaterThanOrEqual(1);
      expect(m.text.length).toBeLessThanOrEqual(140);
    }
  });

  it("budget and unavailable link to contact; budget naps", () => {
    expect(COPY.errors.budget.text).toContain("napping");
    expect(COPY.errors.budget.link?.href).toBe("#contact");
    expect(COPY.errors.unavailable.link?.href).toBe("#contact");
  });
});

describe("COPY hygiene", () => {
  it("has no emoji anywhere (orchestrator note 2026-10-23)", () => {
    for (const s of all) expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("has no markup, URLs, emails or placeholders", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const s of all) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/[<>@]|http|TODO|TBD|lorem/i);
    }
  });

  it("passes the PII scanner", () => {
    expect(scanText(all.join("\n"), "copy.ts")).toEqual([]);
  });

  it("makes no first-person claims about Anderson", () => {
    const joined = all.join("\n");
    expect(joined).not.toMatch(
      /\bI am Anderson\b|\bmy (resume|projects|work)\b/i,
    );
  });
});
