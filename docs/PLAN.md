# avanegas.com + Blob: Implementation Plan & Status

> The live plan for porting Blob into this repo. Only the orchestrator edits this file. Product decisions are in `docs/SCOPE.md` (carried over from portfolio-v3; read it as applying to this repo). Agent rules are in `CLAUDE.md`. Briefs go in `docs/tasks/<phase>/<task-id>.md`.
> History for P0–P4 (all PASSED) and the private review material (security review, red-team checklist, eval reports, research) are in the **private** sibling repo `../portfolio-v3` (local path `/Users/anderson/Github Projects/portfolio-v3`). Read them there and never copy them into this public repo.

## ▶ Current phase: **P5: Port Blob into avanegas95.github.io, on Vercel** · Status: `in progress` (2026-10-23). P5-00 done (Vercel project, env, Upstash, BotID, spend alert). P5-01 audit + briefs merged; batch 1 (P5-02) dispatched. Placement A + teal Blob decided; resume-PDF fix on main in flight.

**Status legend:** `todo` · `brief` · `wip` · `review` · `changes` · `merged` · `blocked`

## Repo visibility (decided 2026-10-23, Anderson)
This repo is **public** until avanegas.com points at Vercel (P6). Anderson is on the GitHub Free plan, and Pages stops serving private repos there. Make it **private right after the cutover**. Until then, commit nothing sensitive: no security findings, red-team notes, eval transcripts, infra IDs or env values.

## P5: Port Blob into avanegas95.github.io, on Vercel (breakdown at phase start; replaces the old v3-standalone P5)
Decided 2026-10-23 (Anderson): Blob and the chat backend move into the existing v1 repo `avanegas95/avanegas95.github.io` (Astro 7 + Tailwind 4 + React, live on avanegas.com via GitHub Pages). That whole site moves to Vercel. `portfolio-v3` becomes a private, read-only reference once P4-13a–c merge. **G5 is dropped**: no `/quality` page, no published report or footer link, no committed `evals.json` in the target repo. Tests and the eval suite carry over as internal dev gates only.

**Approach**
- Work happens on a long-lived integration branch `feat/blob` in the v1 repo, cut from v1 `main` and regularly rebased. Vercel builds Previews from it. v1 `main` keeps deploying avanegas.com through GitHub Pages, untouched, until P6.
- Orchestration moves with the code. P5-00 copies an adapted `CLAUDE.md`, the relevant SCOPE sections, `.claude/agents/` and the orchestrate-build skill into the v1 repo, and `/orchestrate-build` then runs from there.
- The port is mostly copy-and-adapt. Blob stays a framework-free `<blob-agent>` island (≤ 25 KB gzip). v1 keeps React for its own sections; rule 8's "no React" applies to Blob only.

**Tasks** (architect, 2026-10-23; briefs in `docs/tasks/P5/`, audit in `P5-01-port-audit.md`, placement options in `_blob-placement.md`)
| ID | Task | Role | Model | Reviewer | Depends on | Batch | Status |
|---|---|---|---|---|---|---|---|
| P5-01 | Port audit | architect | opus | — | P5-00 | — | merged |
| P5-02 | Vercel adapter, `vercel.json` (CSP, resume 302, BotID), Node 24, all deps/scripts, test configs | developer | sonnet | opus | P5-00 | 1 | merged |
| P5-08 | `/blob-privacy/` note page | copywriter | sonnet | sonnet | P5-02 | 2 | merged |
| P5-03a | Shared lib, KB, content collections, PII guard | developer | opus | opus | P5-02 | 2 | merged |
| P5-03b | Chat server, controls, v1 anchors in allowlist, N-2 `waitUntil` | developer | opus | opus | P5-03a | 3 | merged |
| P5-04a | Blob island port + v1 restyle on `/dev/blob` | designer | sonnet | opus | P5-03a | 3 | wip |
| P5-05 | CI workflow, Blob bundle gate, legacy E2E, Lighthouse | test-engineer | sonnet | sonnet | P5-02, P5-03a | 3 | wip |
| P5-07 | KB ↔ v1 site consistency, DISCREPANCIES, `site.md` | researcher | sonnet | sonnet | P5-03a | 3 | merged |
| P5-04b | Speech-bubble replies replace the panel | designer | sonnet | opus | P5-04a | 4 | brief |
| P5-06 | Internal evals port (no publishing) | developer | sonnet | opus | P5-03b | 4 | brief |
| P5-09 | RUNBOOK (public-safe) + header check (N-3) | developer | sonnet | opus | P5-03b, P5-05 | 4 | brief |
| P5-11 | Footer: drop Spotify iframe, legacy/policy links, computed year, `/orbithop` email-spacing fix | designer | sonnet | sonnet | P5-02, P5-08 | 4 | wip |
| P5-10 | Meta: real `og:image`, KB title/description, Person JSON-LD | developer | sonnet | sonnet | P5-05, P5-07 | 4 | brief |
| P5-04c | Mount Blob on `/` in the chosen placement | designer | sonnet | opus | P5-04b, P5-10, P5-11, placement A (decided) | 5 | brief |

Task branches merge into `feat/blob` (the integration branch), not `main`.

**Vercel environment migration (P5-00 checklist; names only, never values)**
Source: project `portfolio-v3`, checked with `vercel env ls` on 2026-10-23. Sensitive values can't be read back from Vercel, and `vercel env pull` only returns placeholders. So Anderson re-enters each secret from its original source in the new project's dashboard. Don't copy them through files or chat.

| Variable | Type | Environments | How to set it in the new project |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Sensitive | Production, Preview | Re-enter from the Anthropic console, ideally a new key in a dedicated workspace with its own monthly limit (S-06) |
| `IP_HASH_SALT` | Sensitive | Production, Preview | Generate a fresh random value (≥ 32 bytes). A new salt only resets rate-limit buckets. Use different values for Production and Preview |
| `CHAT_MODEL` | Plain | Production, Preview | Copy (`claude-haiku-5-5` unless P4-14 says otherwise) |
| `CHAT_EFFORT` | Plain | Production, Preview | Copy (`low` unless P4-14 says otherwise) |
| `DAILY_BUDGET_USD` | Plain | Production, Preview | Copy the Production/Preview value. **Do not** copy the branch-scoped Preview override for `task/P2-11-live-smoke` (the temporary $0.01 kill-switch test) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Sensitive | Production, Preview | Don't copy by hand: connect the Upstash resource to the new project through the Vercel Marketplace integration, which injects them. Prefer a separate Preview database with eviction off (N-1) |
| `KV_REST_API_READ_ONLY_TOKEN`, `KV_REDIS_URL`, `KV_URL` | Sensitive | Production, Preview | Injected by the same integration; the code doesn't use them |

Not environment variables, but they must move too:
- Enable BotID on the new project, and keep the BotID rewrites in `vercel.json`.
- Set a spend alert and spend management on the team.
- Keep the Node version setting (24.x).
- Turn on Deployment Protection for Previews.
- Don't add `EVAL_ALLOW_SPEND` to Vercel; it stays a local, per-run shell flag.

After setting them, verify on the Preview: `/api/chat` streams, the rate limit triggers, and a temporary low `DAILY_BUDGET_USD` (branch-scoped, deleted right after) returns 503. Retire the old `portfolio-v3` project's variables only once P6 is done.

**Open risk, for Anderson:** v1 currently serves a committed `public/Anderson_Vanegas_Resume.pdf`. Rule 7 says the resume URL must never serve the old PII-bearing PDF. On `feat/blob` it becomes the 302 to LinkedIn (D-06). Whether to also fix live avanegas.com before P6 is Anderson's call.

**Gate:** the Vercel Preview of `feat/blob` serves the full v1 site with Blob. All legacy URLs return 200 and the resume rule holds. The chat works end to end. CI runs unit + E2E + axe green with no real API calls. Lighthouse ≥ 0.95 in all categories. The island is ≤ 25 KB gzip. RUNBOOK and spend alert are in place.

## P5.5: Portfolio improvement (approved 2026-10-23)
Scope: `docs/tasks/P5.5/_proposal.md`; table: `_proposed-plan.md`; Anderson's to-do (H1–H5): `ANDERSON-TODO.md`. Voice rule: agents never write Anderson's prose; content PRs merge only after he runs `npm run voice:accept`.

| ID | Task | Model | Reviewer | Depends on | Batch | Status |
|---|---|---|---|---|---|---|
| P5.5-03 | Land `origin/feature/projects-section` | sonnet | sonnet | — | 0 | merged |
| P5.5-08a | Land `origin/blog-posts` (only "What this blog is about" published) | sonnet | sonnet | H1 ✓ | 0 | brief |
| P5.5-15 | Rename Finance Forecast → Paychira | haiku | sonnet | P5-06, P5-07 | 1 | brief |
| P5.5-13a | Shared KB schema, per-file golden prompt, `site-copy.md` template | opus | opus | P5 gate, 08a, 15 | 2 | brief |
| P5.5-13c | Voice lock, `facts:check`, drift ratchet | sonnet | opus | 13a, H3 | 3 | brief |
| P5.5-05 | Experience from KB roles | sonnet | sonnet | 13a, 13c, H2 | 4 | brief |
| P5.5-06 | Contact polish + Formspree E2E | sonnet | sonnet | 13a, 13c | 4 | brief |
| P5.5-13b | Projects render from KB | sonnet | sonnet | 03, 13a, 13c, H4 | 4 | brief |
| P5.5-04 | Hero + About from intake | sonnet | sonnet | 13a, 13c, H2, H4 | 4 | brief |
| P5.5-08b | Nav fix | haiku | sonnet | 05, 08a | 5 | brief |
| P5.5-13d | Resume facts check vs KB (hand-made PDF; re-brief) | sonnet | opus | 05, 13a, 13c, P5-05, H5 | 5 | brief |

## P6: Production on Vercel and domain cutover (NOT planned; only on Anderson's explicit final approval)
Nothing in this phase starts, and no agent touches avanegas.com DNS, the v1 `CNAME`, the Pages workflow or Vercel domain settings, until Anderson approves in a message. Then:
- write and review `docs/CUTOVER.md` (Vercel domain + DNS steps, pre/post checks, rollback to GitHub Pages);
- merge `feat/blob` into v1 `main`;
- assign avanegas.com on Vercel and update DNS;
- verify `/orbithop`, `/privacy`, `/app-ads.txt` (AdMob crawler), the resume URL and Search Console;
- keep GitHub Pages as the fallback for a while, then retire `deploy.yml` and `CNAME`;
- enable the nightly eval cron (internal results only), behind a human gate.

## Backlog (needs Anderson's decision before planning)
- **Updated resume (Anderson, 2026-10-23).** The resume needs a new version. Anderson has also updated site copy, so where the site, KB and Resume V5.0 disagree, P5-07 flags it in DISCREPANCIES for Anderson rather than picking a winner.
- **Portfolio improvement pass (Anderson, 2026-10-23).** Use the port to improve the portfolio overall, not just add Blob. Scope to be agreed with Anderson (candidates: Lighthouse gaps from P5-01, copy, sections, design polish). Plan as its own phase after P5 or fold items into P5 tasks.
- **Blob "about Anderson" content.** Questionnaire moved to `docs/content-intake/about-me-questions.md` (private drafts in gitignored `docs/content-intake/private/`). Answers become KB edits (`interests.md` etc.) after Anderson approves the diff. No PII beyond email, LinkedIn and GitHub.
- **Blob 3D / roaming.** Not in any plan today: Blob is a 2D SVG in the hero only, and "Blob on other pages" is a v3.0 non-goal. Options:
  - (a) fake-3D in SVG/CSS (shading, squash and stretch, parallax), which fits the 25 KB budget;
  - (b) Blob wanders the page or follows the scroll, which needs a motion and a11y spec (reduced motion, no covering content);
  - (c) real 3D (three.js/WebGL), which blows the 25 KB budget by about 6× and needs a Decision-log entry plus a Lighthouse check.
  Recommend (a)+(b) after P5.

## Decision log
| Date | Decision | By |
|---|---|---|
| 2026-10-23 | **No emojis on Blob.** Remove the emoji reactions (the pop above his head and the badge on messages); moods show only through Blob's own expressions (eyes, body, motion). Amends SCOPE §2 G2 and §4 (emoji rows/reactions) and supersedes "emoji moods" in the 2026-10-12 row. Built in P5-04b. | Anderson |
| 2026-10-23 | H1: publish only "What this blog is about" (the one Anderson actually wrote); every other post on `blog-posts`, including "Lessons from wiring CI for mobile tests", stays draft/unpublished. | Anderson |
| 2026-10-23 | D-14: current title is **Staff** SQA Engineer; the hero changes from "Senior" (in Anderson's words, via intake). | Anderson |
| 2026-10-23 | H5: resume stays a **hand-made PDF** Anderson maintains (option ii). P5.5-13d becomes a facts check of the resume against the KB, not a generated `/resume/` page. Until Anderson supplies the new PDF, the resume URL keeps the 302 to LinkedIn (rule 7). | Anderson |
| 2026-10-23 | H3: **all prose** is voice-locked (every KB body, summary, headline, lede, role bullet, project description). AI may only review: flag grammar/spelling and whether it sounds like Anderson; it never writes or rewrites. | Anderson |
| 2026-10-23 | Blob reply-scrubber allowlist updated for v1 (P5-03b): `#home`, `#about`, `#experiences`, `#projects`, `#contact`, `/`, `/blog/`, `/orbithop/`, `/privacy/`, `/blob-privacy/`; `#experience`/`#skills` dropped. Supersedes the 2026-10-13 list. | orchestrator |
| 2026-10-23 | D-15 resolved: Paychira is the current name of the KB's "Finance Forecast"; the KB and site use "Paychira". D-15 closed; the KB rename is a P5.5 task. | Anderson |
| 2026-10-23 | Content answers: hero says "since 2019" (no year count); anything on the resume may go on the site; project cards from local branch `feature/projects-section` are approved to show (links OK publicly); a first blog post exists on `origin/blog-posts` and should be landed rather than hiding the Blog nav. | Anderson |
| 2026-10-23 | Improvement plan approved (`docs/tasks/P5.5/_proposal.md`): O1 (meta/OG/JSON-LD) and O2 (footer: drop the Spotify iframe, add legacy-page links) join P5; P5.5 = O13 single source of truth + voice lock (absorbs O3/O5/O11), plus O4 hero/About copy, O5 experience, O6 contact, O8 nav/blog. Copy stays in Anderson's own words; AI structures and checks only. | Anderson |
| 2026-10-23 | Blob placement: option A, hero side by side with About Me moved to `#about`; "Check out my work" CTA kept (P5-04c). | Anderson |
| 2026-10-23 | Blob recolours to **teal** (v1 `--sec` #64ffda); v1's palette stays. Supersedes the 2026-10-13 "blue" accent decision. | Anderson |
| 2026-10-23 | Fix the old resume PDF on live `main` now, ahead of P6 (separate PR to `main`). | Anderson |
| 2026-10-23 | Launch model: `claude-haiku-5-5` at `low` effort (P4 gate run: 50/52, privacy/injection/unknowns 100%, ≈$0.00026/question, total p50 ≈1.2 s). The P4-14 bake-off is deferred to the v1 repo, together with the MAX_TOKENS/effort question (tone-04 max_tokens). | Anderson |
| 2026-10-23 | Blob replies render as a speech bubble from Blob, not a separate scrolling chat panel (SCOPE §4.3); built in P5-04 | Anderson |
| 2026-10-23 | Blob ports into `avanegas95.github.io` (v1) and the whole site moves to Vercel; `portfolio-v3` becomes a read-only reference after P4-13a–c. Supersedes the 2026-10-12 "v3 is a new repo" decision for hosting purposes. | Anderson |
| 2026-10-23 | G5 dropped: no public quality page, published report, footer link or committed `evals.json`. Tests and evals stay as internal gates. | Anderson |
| 2026-10-12 | v3 is a new repo (`portfolio-v3`); v1 and both v2 repos stay untouched as references. | Anderson |
| 2026-10-12 | Homepage AI agent "Blob" (blob body, square eyes, emoji moods) powered by Claude; curated KB in prompt, no RAG. | Anderson / planning session |
| 2026-10-12 | Stack: Astro 6 + Vercel, framework-free `<blob-agent>` island, v2a's CI/quality pipeline reused. | planning session |
| 2026-10-12 | Visual: new minimalist, near single-page design. Not based on v2a/v2b; whether to continue those is a separate, undecided question. | Anderson |
| 2026-10-12 | Model: Claude Haiku 5.5 at low effort, confirmed by the P4 bake-off; Sonnet 5.5 low is the fallback choice (MODEL-COMPARISON.md). | Anderson |
| 2026-10-12 | Resume V5.0 is the primary source; work details and client names are OK to publish; LinkedIn is `/in/avanegas95`; other fact fixes are deferred and tracked in DISCREPANCIES.md. | Anderson |
| 2026-10-12 | Blob covers all projects and side projects; Anderson adds details via `docs/content-intake/`. | Anderson |
| 2026-10-12 | Stack moves to **Astro 7** (≥ 7.3.8) + `@astrojs/vercel` ≥ 11.0.14, superseding "Astro 6": every 6.x release carries a critical advisory (XSS, image RCE, base-path auth bypass) fixed only in 7.3.8. Found in the P0-01 review. | Anderson |
| 2026-10-13 | P2 API extras approved: SSE `reset` event plus `unavailable` error code; server-only `IP_HASH_SALT` secret (hashed IPs only in Upstash); 1,500-char cap on each prior assistant turn resent in history. | Anderson |
| 2026-10-13 | P2 defaults confirmed: Q5, no visitor question text logged (metrics only); Q9, $1/day kill switch and $10/month Anthropic workspace cap. | Anderson |
| 2026-10-13 | Blob's reply scrubber allows only the KB contact links (mailto, /in/avanegas95, github.com/avanegas95) plus fixed same-site paths (`#about`/`#experience`/`#projects`/`#skills`/`#contact`, `/`, `/orbithop/`, `/privacy/`). Bare avanegas.com and the resume PDF path aren't linked; the resume answer stays "see LinkedIn". | orchestrator |
| 2026-10-13 | Every Upstash key is prefixed `pv3:`, so the database can be shared safely (e.g. `pv3:blob:rl:*`, `pv3:blob:spend:*`). | orchestrator |
| 2026-10-12 | No avanegas.com DNS/`CNAME` change is planned. v3 launches on `*.vercel.app` (P5); the cutover is P6 and starts only on Anderson's explicit final approval. | Anderson |

| 2026-10-13 | Blob's colour, and so the single site accent, is **blue**, with a slightly more 3D look (the reference is Anki's Vector). Roaming around the page is deferred and gets scoped later (after P3 or in v3.1). | Anderson |
| 2026-10-14 | Blob's look (blue, soft 3D) approved. | Anderson || 2026-10-14 | The client validates SSE events with hand-written guards instead of zod (25 KB island budget), a documented exception to the zod-at-every-boundary convention. The no-JS fallback links LinkedIn directly. Closing the panel mid-reply keeps the stream running. | Anderson (defaults accepted) |

## Run log (orchestrator appends one line per merge or gate)
2026-10-23 · BOOTSTRAP · feat/blob created from main; agent docs copied from portfolio-v3 (public-safe subset). P0–P4 PASSED in portfolio-v3; launch model claude-haiku-5-5 low; G5 dropped.
2026-10-23 · P5-00 · done: Vercel project avanegas95-github-io set up by Anderson and verified (12 env vars by name, Node 24, no custom domain, Vercel auth on deployments). Anderson confirmed BotID and the spend alert are on. Open for P6: a separate Preview Upstash DB.
2026-10-23 · P5-01 · merged: port audit + P5 briefs (03 and 04 split into 03a/b, 04a/b/c). Placement options written; 04c pending Anderson.
2026-10-23 · P5-02 · merged into feat/blob (opus APPROVE; lint/typecheck/build green, 22 tests). Four minor follow-ups added to the P5-05 brief.
2026-10-23 · P5-08 · merged (sonnet APPROVE; round 2 fixed an axe flake from fade-in timing via reduced-motion emulation).
2026-10-23 · P5-03a · merged (opus APPROVE; 470 tests). Dropped server-importing tests reassigned to P5-03b; /orbithop guard:pii hit assigned to O2.
2026-10-23 · P5-07 · merged (sonnet APPROVE; 477 tests). New rows D-14 (title), D-15 (Paychira, resolved same day).

2026-10-23 · P5-03b · merged (opus APPROVE; 1,554 tests). Follow-ups: bump PROMPT_VERSION before next eval run (P5-06); #about anchor arrives with P5-04c.
2026-10-23 · P5.5-03 · merged (sonnet APPROVE, voice check pass; 1,560 tests). P5-05 approved but held: merges after P5-04a (its tsconfig change typechecks botid.test, which needs 04a's botid-init.ts). P5-04a and P5-11 in changes.
