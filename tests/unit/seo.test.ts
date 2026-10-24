import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentRoleFromSummary,
  kbLink,
  personJsonLd,
  serializeJsonLd,
} from "../../src/lib/seo";

const contact = readFileSync("src/content/knowledge/contact.md", "utf8");
const bio = readFileSync("src/content/knowledge/bio.md", "utf8");

describe("serializeJsonLd", () => {
  it("escapes <, > and & and round-trips through JSON.parse", () => {
    const input = { a: "</script><b>&" };
    const out = serializeJsonLd(input);
    expect(out).not.toContain("</script");
    expect(out).not.toMatch(/[<>&]/);
    expect(JSON.parse(out)).toEqual(input);
  });
});

describe("personJsonLd", () => {
  const sameAs = [
    kbLink(contact, "LinkedIn"),
    kbLink(contact, "GitHub"),
  ].filter((v): v is string => !!v);
  const ld = personJsonLd({
    name: "Anderson Vanegas",
    jobTitle: "Staff SQA Engineer",
    worksFor: "Boston Dynamics",
    url: "https://avanegas.com/",
    email: "a@example.com",
    sameAs,
  });

  it("is a Person with an Organization employer", () => {
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Person");
    expect(ld["worksFor"]).toEqual({
      "@type": "Organization",
      name: "Boston Dynamics",
    });
  });

  it("carries no address, phone, birth date or image", () => {
    for (const k of ["address", "telephone", "birthDate", "image"])
      expect(ld).not.toHaveProperty(k);
  });

  it("sameAs equals the KB LinkedIn and GitHub links only", () => {
    expect(ld["sameAs"]).toEqual([
      "https://www.linkedin.com/in/avanegas95",
      "https://github.com/avanegas95",
    ]);
  });
});

describe("KB parsing", () => {
  it("reads the current title and employer from the bio summary", () => {
    const summary = /^summary: "(.*)"$/m.exec(bio)?.[1] ?? "";
    expect(currentRoleFromSummary(summary)).toEqual({
      title: "Staff SQA Engineer",
      employer: "Boston Dynamics",
    });
  });
  it("returns null when the summary has no 'X at Y' role", () => {
    expect(currentRoleFromSummary("Tests robots.")).toBeNull();
  });
  it("kbLink returns null for a missing label", () => {
    expect(kbLink(contact, "Fax")).toBeNull();
  });
});
