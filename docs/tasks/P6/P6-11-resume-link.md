# P6-11: Blob can link the resume PDF (D-19, code side)
Role: developer · Model: opus · Depends on: —

## Goal
Anderson decided (2026-11-06, D-19) that Blob may offer the public-safe resume PDF, with no password. After this task, `/Anderson_Vanegas_Resume.pdf` is an allowed same-site link for both the server output scrubber and the client renderer, and PROMPT_VERSION is bumped. Anderson rewrites the `faq.md` resume answer himself (KB prose is voice-locked), so this branch is held until his KB edit lands on it.

## Read first
- CLAUDE.md (rules 1, 4, 6, 7, 9-11)
- docs/SCOPE.md §6.6
- `src/lib/prompt.ts` (ALLOWED_SITE_PATHS, PROMPT_VERSION), `src/scripts/blob/links.ts` (SITE_PATHS, safeHref), the server scrubber that uses ALLOWED_SITE_PATHS
- `tests/unit/scrub.test.ts`, `tests/unit/prompt.test.ts`, the lockstep test between the two lists, `tests/e2e/resume-pdf.spec.ts`

## Files you own
- `src/lib/prompt.ts`, `src/scripts/blob/links.ts`
- `tests/unit/scrub.test.ts`, `tests/unit/prompt.test.ts`, the links/lockstep tests, `tests/unit/markdown.test.ts` (only to add a case)
- **Never** `src/content/knowledge/*` or `voice.lock.json` (Anderson's).

## Behaviour / rules
1. Add `/Anderson_Vanegas_Resume.pdf` to ALLOWED_SITE_PATHS and SITE_PATHS (exact path, case-sensitive, same position in both lists). The lockstep test stays green.
2. `PROMPT_VERSION` becomes `p5-v9`; update the version test.
3. The server scrubber keeps `[his resume](/Anderson_Vanegas_Resume.pdf)` and still strips look-alikes: `/anderson_vanegas_resume.pdf`, `/Anderson_Vanegas_Resume.pdf?x=1`, `/Anderson_Vanegas_Resume.pdf#page=2`, `//evil.com/Anderson_Vanegas_Resume.pdf`, `/Anderson_Vanegas_Resume.pdf/..`, `/files/Anderson_Vanegas_Resume.pdf`, percent-encoded variants. The streaming invariant holds (`createScrubber` pieces equal `scrub()`).
4. The client renders it as a same-site link (no `target`); safeHref rejects the same look-alikes. Bare-path linkifying (P6-07) stays `#`-only: a bare `/Anderson_Vanegas_Resume.pdf` in text is not linked.
5. If the system prompt lists the allowed site paths to the model (it does via ALLOWED_SITE_PATHS), check the wording still reads correctly with a PDF in the list; adjust only the code-side template text in prompt.ts if needed, never KB prose. Keep the prefix byte-stable (no dates/IDs).
6. Rule 7 is untouched: the PDF route, its content type and `guard:pii` are unchanged.

## Tests required (write first)
- [ ] scrub keeps the exact resume link; strips each look-alike in rule 3
- [ ] streaming scrub equals one-shot for a reply containing the resume link split across chunk boundaries
- [ ] safeHref accepts the exact path, rejects the look-alikes
- [ ] markdown renders `[resume](/Anderson_Vanegas_Resume.pdf)` as a same-site link; a bare path stays text
- [ ] prompt version is p5-v9; lists stay in lockstep

## Done when
- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run guard:pii` green; chromium resume-pdf and blob-chat E2E green; bundle gate green.
- [ ] Branch `task/P6-11-resume-link` pushed (cut from `feat/blob`). Not merged until Anderson's faq.md edit and voice:accept are on it.

## Out of scope
KB text, the PDF itself, noindex headers, vercel.json, the spend eval (Anderson runs it).
