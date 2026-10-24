// Legacy-URL guard for the resume (CLAUDE.md rule 7, SCOPE §2 G6). Request API only: no page JS.
// The static E2E server (`serve`) cannot apply Vercel routes, so the live 302 is re-checked on the
// Vercel Preview. Here we guard what can break locally: no PDF is ever served from the static
// output, and the redirect Vercel merges at deploy time is configured.
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "./fixtures/guard";

const RESUME = "/Anderson_Vanegas_Resume.pdf";
const LINKEDIN = "https://www.linkedin.com/in/avanegas95";

test("the resume path never serves a PDF from the static build", async ({
  request,
}) => {
  const res = await request.get(RESUME, { maxRedirects: 0 });
  expect(res.headers()["content-type"] ?? "").not.toMatch(/application\/pdf/i);
  const body = await res.body();
  expect(body.subarray(0, 4).toString("latin1")).not.toBe("%PDF");
});

test("the 302 to LinkedIn is configured and no static file shadows it", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    redirects: { source: string; destination: string; statusCode?: number }[];
  };
  expect(config.redirects.filter((r) => r.source === RESUME)).toEqual([
    { source: RESUME, destination: LINKEDIN, statusCode: 302 },
  ]);
  expect(existsSync(`.vercel/output/static${RESUME}`)).toBe(false);
});
