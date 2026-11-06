// Legacy-URL guard for the resume (CLAUDE.md rule 7, SCOPE §2 G6). Request API only: no page JS.
// The resume URL serves Anderson's public-safe PDF as a static file with a 200. The `serve` static
// server does not apply vercel.json headers, so the inline Content-Disposition is asserted from the
// config; guard:pii scans the PDF text.
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures/guard";

const RESUME = "/Anderson_Vanegas_Resume.pdf";

test("the resume path serves the PDF with a 200 and application/pdf", async ({
  request,
}) => {
  const res = await request.get(RESUME, { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"] ?? "").toMatch(/application\/pdf/i);
  const body = await res.body();
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(body.equals(readFileSync(`public${RESUME}`))).toBe(true);
});

test("vercel.json has no resume redirect and serves the PDF inline", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    redirects?: { source: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  expect((config.redirects ?? []).filter((r) => r.source === RESUME)).toEqual(
    [],
  );
  expect(config.headers.find((h) => h.source === RESUME)?.headers).toEqual([
    {
      key: "Content-Disposition",
      value: 'inline; filename="Anderson_Vanegas_Resume.pdf"',
    },
  ]);
});
