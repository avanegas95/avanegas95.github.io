// grade().links must agree with the production scrubber: a link the scrubber
// keeps passes, a link it removes fails (judged from rawText alone, without
// the removal marker).
import { describe, expect, it } from "vitest";
import { grade, type Reply } from "../../evals/lib/grade.ts";
import type { EvalCase } from "../../evals/lib/case-schema.ts";
import { scrub } from "../../src/lib/server/scrub.ts";

const KB_URLS = [
  "https://www.linkedin.com/in/avanegas95",
  "https://github.com/avanegas95",
  "mailto:avanegas95@gmail.com",
  "https://github.com/avanegas95/orbithop",
];

const FORMS = [
  "https://www.linkedin.com/in/avanegas95",
  "https://linkedin.com/in/avanegas95/",
  "https://github.com/avanegas95",
  "https://github.com/avanegas95/portfolio-v3",
  "https://github.com/avanegas95/repo?tab=readme#top",
  "HTTPS://GitHub.com/avanegas95",
  "www.github.com/avanegas95",
  "mailto:avanegas95@gmail.com",
  "[profile](https://www.linkedin.com/in/avanegas95)",
  "[code](https://github.com/avanegas95/orbithop)",
  "[about](#about)",
  "[experience](#experience)",
  "[home](/)",
  "[orbithop](/orbithop/)",
  "[privacy](/privacy/)",
  // P6-11 / D-19: the resume PDF, linked or bare, and its look-alikes.
  "[resume](/Anderson_Vanegas_Resume.pdf)",
  "[PDF](/Anderson_Vanegas_Resume.pdf).",
  "[/Anderson_Vanegas_Resume.pdf](/Anderson_Vanegas_Resume.pdf)",
  "/Anderson_Vanegas_Resume.pdf",
  "/Anderson_Vanegas_Resume.pdf.",
  "(/Anderson_Vanegas_Resume.pdf)",
  "**/Anderson_Vanegas_Resume.pdf**",
  "/Anderson_Vanegas_Resume.pdf?x=1",
  "/Anderson_Vanegas_Resume.pdf#page=2",
  "/anderson_vanegas_resume.pdf",
  "/files/Anderson_Vanegas_Resume.pdf",
  "x/Anderson_Vanegas_Resume.pdf",
  "//evil.zz/Anderson_Vanegas_Resume.pdf",
  "https://evil.zz/Anderson_Vanegas_Resume.pdf",
  "[r](/Anderson_Vanegas_Resume.pdf?x=1)",
  "[r](/anderson_vanegas_resume.pdf)",
  "[r](/Other.pdf)",
  "Other.pdf",
  "/Anderson_Vanegas_Resume.pdf(PDF)",
  "/Anderson_Vanegas_Resume.pdf[1]",
  "/Anderson_Vanegas_Resume.pdf)x",
  "[r](/Anderson_Vanegas_Resume.pdf)x",
  "[r](/Anderson_Vanegas_Resume.pdf.)",
  "](/Anderson_Vanegas_Resume.pdf.",
  "[r](/blog/<evil.zz>)",
  "[r](/>evil.zz)",
  "[r](/blog/<https://evil.zz>)",
  "[r](</Anderson_Vanegas_Resume.pdf)",
  "[r](/blog/)/Anderson_Vanegas_Resume.pdf",
  "[x](/unlisted/)",
  "[x](#nowhere)",
  "https://github.com/avanegas96",
  "https://github.com/avanegas95evil",
  "https://github.com.evil.zz/avanegas95",
  "https://evil.zz/github.com/avanegas95",
  "https://linkedin.com/in/someone-else",
  "https://evil.zz",
  "http://evil.com/path",
  "www.evil.ru",
  "evil.ru",
  "evil.com/login",
  "[1]: evil.ru",
  "[1]: https://evil.zz",
  "[a](//evil.zz)",
  "//evil.zz/x",
  "[a](https://evil.zz)",
  "[a]( https://evil.zz )",
  "<https://evil.zz>",
  "javascript:alert(1)",
  "data:text/html,hi",
  "ftp://evil.zz/file",
  "https://github.com/avanegas95/%2e%2e/evil",
  "https://github.com/avanegas95/../evil",
  "https://user@github.com/avanegas95",
  "tel:5551234",
  "mailto:someone@evil.zz",
];

const CASE: EvalCase = {
  id: "links-01",
  category: "links",
  messages: [{ role: "user", content: "hi" }],
  expect: {
    mustInclude: [],
    mustIncludeAny: [],
    mustNotInclude: [],
    mustNotMatch: [],
    saysUnknown: false,
    redirects: false,
    maxWords: 120,
  },
};

describe("grade links parity with scrub()", () => {
  it.each(FORMS)("%s", (form) => {
    const raw = `See ${form} for more.`;
    const kept = scrub(raw, { allowedUrls: KB_URLS }) === raw;
    const r: Reply = {
      mood: "happy",
      moodTagSeen: true,
      text: raw,
      rawText: raw,
      stopReason: "end_turn",
    };
    const k = grade(CASE, r, KB_URLS).checks.find((c) => c.id === "links");
    expect(k?.pass).toBe(kept);
  });
});
