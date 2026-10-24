// Text extraction for the PII guard (CLAUDE.md rule 7). PDFs exported from Google Docs
// encode glyphs, so raw bytes cannot be scanned: this reads the real text layer with pdfjs.
import { readFileSync, statSync } from "node:fs";

export interface PdfLimits {
  maxBytes: number;
  maxPages: number;
  timeoutMs: number;
}
export const PDF_LIMITS: PdfLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxPages: 20,
  timeoutMs: 30_000,
};

// Returns the text of every page, one line per text run that ends a line (single "\n").
// Throws when the file is not a readable PDF or exceeds a limit (callers fail closed).
export async function extractPdfText(
  file: string,
  limits: Partial<PdfLimits> = {},
): Promise<string> {
  const lim = { ...PDF_LIMITS, ...limits };
  const size = statSync(file).size;
  if (size > lim.maxBytes) throw new Error(`pdf over ${lim.maxBytes} bytes`);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(readFileSync(file)),
    useSystemFonts: false,
    verbosity: 0,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`pdf extraction over ${lim.timeoutMs} ms`)),
      lim.timeoutMs,
    );
  });
  const work = (async () => {
    const doc = await task.promise;
    if (doc.numPages > lim.maxPages) {
      throw new Error(`pdf over ${lim.maxPages} pages`);
    }
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : ""))
          .join(""),
      );
    }
    return pages.join("\n");
  })();
  work.catch(() => undefined); // a late rejection after the timeout wins is not unhandled
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}
