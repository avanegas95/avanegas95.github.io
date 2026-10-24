// Text extraction for the PII guard (CLAUDE.md rule 7). PDFs exported from Google Docs
// encode glyphs, so raw bytes cannot be scanned: this reads the real text layer with pdfjs.
import { readFileSync } from "node:fs";

// Returns the text of every page, one line per text run that ends a line.
// Throws when the file is not a readable PDF (callers fail closed).
export async function extractPdfText(file: string): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(readFileSync(file)),
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          // Blank line between lines: the email rule glues single line breaks, which would
          // fuse the allowed address onto the "https://avanegas.com" line above it.
          .map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n\n" : "") : ""))
          .join(""),
      );
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}
