import { describe, expect, it } from "vitest";
import { extractPdfText } from "../../scripts/pdf-text.ts";

// Proves the extractor reads the real (glyph-encoded) Google Docs text layer, which regex over raw
// bytes cannot.
describe("extractPdfText", () => {
  it("extracts readable text from the real resume PDF", async () => {
    const text = await extractPdfText("public/Anderson_Vanegas_Resume.pdf");
    expect(text).toContain("Boston Dynamics");
    expect(text).toContain("Paychira");
    expect(text).toContain("avanegas95@gmail.com");
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(
      extractPdfText("docs/content-intake/resume.md"),
    ).rejects.toThrow();
  });
});
