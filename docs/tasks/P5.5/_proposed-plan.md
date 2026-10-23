# P5.5 proposed task table (architect, 2026-10-23)

This is the approved set from `_proposal.md` (decision log, 2026-10-23), adjusted for Anderson's later answers:
- Hero: "since 2019", no count.
- Resume content may go on the site.
- Project cards are approved and pushed.
- A blog post exists on `blog-posts`.
- D-15 is resolved: Finance Forecast is now Paychira.

Two new P5 rows go into the P5 table: **P5-10** (O1) and **P5-11** (O2). Briefs are in `docs/tasks/P5/`.

**Voice rule (every P5.5 brief):** agents never write or rewrite Anderson's prose. They move it verbatim, structure it, wire it, validate it and flag problems. Content PRs stay red on `voice:check` until Anderson runs `npm run voice:accept`; that is the human gate.

## P5 additions
| ID | Task | Role | Model | Reviewer | Depends on | Batch |
|---|---|---|---|---|---|---|
| P5-11 | Footer: drop the Spotify iframe, add legacy/policy links, computed year, `/orbithop` `Email{" "}<a` fix | designer | sonnet | sonnet | P5-02, P5-08 | 4 (now; before P5-04c) |
| P5-10 | Meta: real `og:image`, KB-sourced title and description, Person JSON-LD on `/`, CSP-hash test skips ld+json | developer | sonnet | sonnet | P5-05, P5-07 | 4 (merge before P5-04c) |

- **P5-04c now depends on P5-11**, for the Lighthouse BP gate on `/`.
- P5-10 edits only the `title=` line in `index.astro`, so dispatch 04c after P5-10 merges.
- P5-05's `guard:pii` CI step goes green once P5-11 merges.

## P5.5
| ID | Task | Role | Model | Reviewer | Depends on | Batch |
|---|---|---|---|---|---|---|
| P5.5-03 | Land `origin/feature/projects-section` (rebased), strip tracking params, data test | developer | sonnet | sonnet | — | 0 (may run during P5) |
| P5.5-08a | Land `origin/blog-posts`: published post(s) only, drafts filtered, no Layout regressions | developer | sonnet | sonnet | **H1** | 0 (may run during P5) |
| P5.5-15 | Rename Finance Forecast → Paychira in KB and eval fixtures; close D-15 | developer-lite | haiku | sonnet | P5-06, P5-07 | 1 |
| P5.5-13a | Shared KB schema, structured frontmatter (verbatim moves), per-file golden prompt, `site-content.ts`, `site-copy.md` template | developer | opus | opus | P5 gate, P5.5-08a, P5.5-15 | 2 |
| P5.5-13c | Voice lock (`voice:check/accept/init`), report-only `facts:check`, per-component drift ratchet | test-engineer | sonnet | opus | P5.5-13a, **H3** | 3 |
| P5.5-05 | Experience from KB roles (all resume bullets, intern line, `#experience` + alias), tokens, responsive photos | designer | sonnet | sonnet | 13a, 13c, **H2** | 4 |
| P5.5-06 | Contact: visible labels, solid button, KB email/LinkedIn line and location, Formspree E2E | designer | sonnet | sonnet | 13a, 13c | 4 |
| P5.5-13b | Projects render from KB files; delete `projects.ts` | designer | sonnet | sonnet | P5.5-03, 13a, 13c, **H4** | 4 |
| P5.5-04 | Hero + About from `bio.md` (headline, lede, About verbatim from intake), KB tool list, h1/h2 scale | designer | sonnet | sonnet | 13a, 13c, **H2**, **H4** | 4 |
| P5.5-08b | Nav: "Experience" → `#experience`, distinct briefcase icon | developer-lite | haiku | sonnet | P5.5-05, P5.5-08a | 5 |
| P5.5-13d | `/resume/` print page from KB; PDF URL 302 → `/resume/` | developer | sonnet | opus | P5.5-05, 13a, 13c, P5-05, **H5** | 5 |

Batch 4 has 4 tasks with disjoint files (`Experiences`+`global.css` / `Contact` / `Projects`+`types`+KB projects / `Home`+`About`+`bio.md`). Each deletes only its own drift allow file and its own golden.

## Changes vs `_proposal.md`
- **O13b is narrowed to Projects.** Hero/About wiring moves into P5.5-04 and Experience into P5.5-05, so that each section file has exactly one owner.
- **O3 is split.** P5.5-03 lands the branch as-is (removes the live placeholder early), and 13b moves the cards into the KB.
- **O8 is split.** 08a lands the blog instead of hiding the nav (Anderson, 2026-10-23); 08b does nav polish (haiku).
- **New: P5.5-15** (D-15 rename).
- **13d is option (i)** with no PDF binary: the PDF URL 302s to `/resume/`. If Anderson picks (ii), drop 13d and re-brief it in the private repo.
- **Shared-file exceptions** (merge order is the guard):
  - `content.config.ts`: 08a (blog block) → 13a (KB blocks).
  - `kb-schema.ts`: 13a → 04 (one line).
  - `tests/unit/vercel-config.test.ts`: P5-05 → P5-10 (regex) → 13d (resume expectation).
  - `package.json`: 13a (deps) → 13c (scripts).
- **Orchestrator follow-ups:**
  - wire `voice:check` and `facts:check` into `quality.yml`;
  - add the CLAUDE.md voice rule (13c drafts the text, Anderson approves);
  - add a decision-log row if Blob's allowlist gains `/resume/`.

Human gates: see `ANDERSON-TODO.md` (H1–H5, plus `voice:accept` on every content PR).
