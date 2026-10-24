# avanegas.com + Blob: Implementation Plan & Status

> The live plan for porting Blob into this repo. Only the orchestrator edits this file. Product decisions are in `docs/SCOPE.md` (carried over from portfolio-v3; read it as applying to this repo). Agent rules are in `CLAUDE.md`. Briefs go in `docs/tasks/<phase>/<task-id>.md`.
> History for P0–P4 (all PASSED) and the private review material (security review, red-team checklist, eval reports, research) are in the **private** sibling repo `../portfolio-v3` (local path `/Users/anderson/Github Projects/portfolio-v3`). Read them there and never copy them into this public repo.

## ▶ Current phase: **P5.5: Portfolio improvement** · Status: `in progress` (2026-10-24). P5 PASSED its gate on 2026-10-24 (Preview of feat/blob @ e79dbc5). P6 waits on Anderson's explicit approval.

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
| P5-04b | Speech-bubble replies replace the panel | designer | sonnet | opus | P5-04a | 4 | merged |
| P5-06 | Internal evals port (no publishing) | developer | sonnet | opus | P5-03b | 4 | merged |
| P5-09 | RUNBOOK (public-safe) + header check (N-3) | developer | sonnet | opus | P5-03b, P5-05 | 4 | merged |
| P5-11 | Footer: drop Spotify iframe, legacy/policy links, computed year, `/orbithop` email-spacing fix | designer | sonnet | sonnet | P5-02, P5-08 | 4 | merged |
| P5-10 | Meta: real `og:image`, KB title/description, Person JSON-LD | developer | sonnet | sonnet | P5-05, P5-07 | 4 | merged |
| P5-12 | Fix super-linear `scrub()` on stray `<` + split PII (DoS risk on chat path); harden load-sensitive test timeouts | developer | opus | opus | P5-03b | 4 | merged |
| P5-13 | Test follow-ups: scrubber test pinning digit-free obfuscated `tel:` removal (`t<b>e</b>l:abc`, `tel：abc`); decide/handle U+A789 as a colon (pre-existing gap); evals `spendAllowed` "ci" reason tests (CI=true/1 → ci, false/0 → ok); `markdown.test.ts` "linear-ish time" ratio test flakes under load: time CPU (process.cpuUsage) like scrub-perf | developer | sonnet | opus | P5-12 | 4 | merged |
| P5-14 | New OG preview image from the current site (replaces the inspiration-site leftover), reproducible `og:render` script, leftover scan | designer | sonnet | sonnet | P5-10 (branched from it) | 4 | merged |
| P5-15 | Blob favicon (SVG + PNG/ICO fallbacks, reproducible render) | designer | sonnet | sonnet | P5-14 (branched from it) | 4 | merged |
| P5-16 | Project-card tag contrast (#8892b0 on card bg 4.33:1 < 4.5:1; a11y-home axe red) | designer | sonnet | sonnet | P5.5-03 | 4 | merged |
| P5-17 | Serve the new public-safe resume PDF at the resume URL; guard:pii scans PDF text; amend rule 7 / D-06; update resume E2E | developer | sonnet | opus | Anderson's final PDF ✓ | 4 | merged |
| P5-18 | Gate fixes: check-headers handles the proxied BotID path (only HSTS applies there); stop docs-only pushes cancelling CI runs | developer | sonnet | sonnet | P5-09 | 4 | merged |
| P5-04c | Mount Blob on `/` in the chosen placement | designer | sonnet | opus | P5-04b, P5-10, P5-11, P5-16, placement A (decided) | 5 | merged |

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
| P5.5-08a | Land `origin/blog-posts` (only "What this blog is about" published) | sonnet | sonnet | H1 ✓ | 0 | merged |
| P5.5-15 | Rename Finance Forecast → Paychira | haiku | sonnet | P5-06, P5-07 | 1 | merged |
| P5.5-13a | Shared KB schema, per-file golden prompt, `site-copy.md` template | opus | opus | P5 gate, 08a, 15 | 2 | merged |
| P5.5-16 | Import about-me answers (hybrid, see decision log): short answers become fact lists in Anderson's words, narrative answers are flagged for him to rewrite, `(private)` items skipped; Anderson approves the KB diff | sonnet | opus | 13a, Anderson's answers | 3 | wip |
| P5.5-13c | Voice lock, `facts:check`, drift ratchet | sonnet | opus | 13a, H3 ✓ | 3 | wip |
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
| 2026-10-24 | About-me answers (P5.5-16) use a hybrid: short factual answers (favorites, hobbies, quick facts) become tidy fact lists built only from Anderson's own words, with no new phrasing. Longer narrative answers (career story, working with you, about Blob) are not imported; they are flagged by question number with what's unclear, for Anderson to rewrite. Anderson approves the KB diff. This is a scoped exception to the voice lock, limited to fact lists in Blob's KB. | Anderson |
| 2026-10-24 | D-14 confirmed: title is Staff SQA Engineer. Hero/KB tool list follows the resume: drop "Linux" (Bash stays, under languages). H3 reaffirmed: every prose field is Anderson's and voice-locked unless he says otherwise for a specific field. | Anderson |
| 2026-10-24 | The resume PDF stays indexable by search engines (no noindex / X-Robots-Tag). | Anderson |
| 2026-10-24 | Serve Anderson's updated, public-safe resume PDF at the existing resume URL instead of the LinkedIn 302, once he supplies the final export. Amend CLAUDE.md rule 7 and D-06, and extend guard:pii to extract and scan PDF text so no phone or street address can ship (task P5-17). | Anderson |
| 2026-10-24 | Anderson's updated resume (kept outside the repo) now has no street address or phone, says Paychira and Staff, and lists Zephyr, Buildkite, Jenkins and Bash. That settles D-11: the hero's tool list matches the resume. | Anderson |
| 2026-10-24 | Phase gate may run the chat smoke test against the Vercel Preview with `--spend` (a few messages, under $0.01). Anderson provides the Preview bypass token via the shell as `VERCEL_AUTOMATION_BYPASS_SECRET`; it is never written to the repo or chat. | Anderson |
| 2026-10-24 | Favicon: replace the gradient orb (unknown origin) with a small teal Blob favicon (P5-15). | Anderson |
| 2026-10-24 | New OG image approved (with the site's monospace font bundled). LICENSE stays MIT with the holder changed to Anderson Vanegas; remove every reference to Oscar Hernandez (the inspiration site) from the repo and site (P5-14 round 2). | Anderson |
| 2026-10-24 | The existing `og.image.png` is a leftover from the inspiration site (shows another person's name) and must never ship. Build a new 1200×630 preview image from the current site's look (P5-14), text limited to name, title and domain. Live `main` is unaffected (its og:image URL 404s today). | Anderson |
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
2026-10-23 · P5-12 · opened: test-timeout investigation found scrub() is at least quadratic on adversarial input (16 KB ≈ 0.85 s, 32 KB ≈ minutes). Same code ported byte-identical from v3. P5-11 approved, merge held until unit suite is reliably green.
2026-10-24 · P5-04a, P5-05, P5-11 · merged together (opus/sonnet/sonnet APPROVE). Lint, build, bundle gate, guard:pii green; unit 1998/2001, the 3 failures are timeouts only in scrub.test/pii-guard-cli.test, also failing on the base and owned by open P5-12 (load avg 65–110). Exception to the green-suite rule approved by Anderson; P5-12 must restore green.
2026-10-24 · P5-12 · merged (opus APPROVE round 2; output byte-identical on 30k fuzz; scrubber now near-linear). Full unit suite green again: 2,078/2,078; closes the green-suite exception. v3 has the same bug (note for portfolio-v3 if it is ever redeployed). Follow-ups → P5-13.
2026-10-24 · P5-06 · merged (opus APPROVE; 2,448 tests; eval:dry 52 cases, no API calls; PROMPT_VERSION p5-v1). P5-10 approved, held for P5-14.
2026-10-24 · P5-10 + P5-14 · merged together (sonnet APPROVE each). New OG image, LICENSE holder Anderson Vanegas, inspiration-site leftovers removed. Unit 2,459/2,459 on rerun; first run had one load flake in markdown.test (→ P5-13). PR #144 fixes LICENSE on main.
2026-10-24 · P5-15 · merged (sonnet APPROVE; 2,463 tests).
2026-10-24 · P5-04b · merged (opus APPROVE). Unit 2,465/2,465; chromium E2E 83 pass, 2 fail: a11y-home axe color-contrast on project-card tags, which came in with P5.5-03 (not 04b) → P5-16. Review a11y follow-ups added to the P5-04c brief.
2026-10-24 · P5-16 · merged (one class; verified by the full suite: unit 2,465/2,465, chromium E2E 85/85 incl. a11y-home). P5-04c dispatched.
2026-10-24 · P5-13 · merged (opus APPROVE; U+A789 left as-is, sound: tel: links never render). Minor: markdown fence-path unit sits on the CPU floor; comment/reps tweak optional.
2026-10-24 · P5-09 · merged (opus APPROVE round 2; RUNBOOK error table verified against code). Still to do at the gate: run check-headers against the Preview (needs the Preview bypass token in the shell).
2026-10-24 · P5-04c · merged (opus APPROVE round 2; unit 2,495, chromium E2E 94/94; Blob island 8.5 KB gz; LCP +0.13 s accepted). All P5 tasks merged → phase gate.
2026-10-24 · P5 GATE run 1 (opus test-engineer, feat/blob @ 02f5959): 7/8 PASS. Preview Ready and serves the full site with Blob; legacy URLs 200; live chat smoke 200 SSE (~$0.0013); CI green on 4f8a2cb (unit 2,495, E2E 282 across 3 browsers, Lighthouse asserts); local Lighthouse mobile ≥0.98, desktop 1.0; island 8.5 KB gz; RUNBOOK + spend alert in place. FAIL: check-headers on the BotID path (proxied to Vercel, only HSTS applied) → P5-18. Re-run criteria 2–3 after P5-17 and P5-18. Notes: Preview Lighthouse BP 0.93 from Vercel toolbar vs CSP (Preview-only); Preview shares the prod Upstash DB (P6).
2026-10-24 · P5-17 · merged (opus APPROVE round 2): resume PDF served at /Anderson_Vanegas_Resume.pdf; guard:pii scans PDF text (split-line, size/page/time caps). Unit 2,510, chromium E2E 94/94.
2026-10-24 · P5-18 · merged (round 2 verified by orchestrator: paths-ignore removed, per-SHA push concurrency). Unit 2,512. Next: re-run gate criteria 2–3 on the new Preview.
2026-10-24 · P5 GATE run 2 (criteria 2, 3, 5 on Preview @ e79dbc5): all PASS. Resume PDF 200 application/pdf, byte-identical, full security headers; check-headers passes; CI run 40105362997 green (unit 2,512; E2E 282 across 3 browsers; bundle 8.5 KB; guard:pii incl. PDF; Lighthouse asserts). With run 1 (criteria 1, 4, 6, 7, 8) → **P5 PASSED**. Notes: guard:pii warns on unresolved "to be confirmed" markers in KB finance-forecast.md and orbit-hop.md (Anderson content, P5.5); Preview adds x-robots-tag noindex (Vercel default; confirm absent on production in P6); Preview shares the prod Upstash DB (P6).
2026-10-24 · P5.5-15 · merged (sonnet APPROVE; voice check: only the name changed; 2,514 tests; eval:dry no API calls).
2026-10-24 · P5.5-08a · merged (sonnet APPROVE round 2): only "What this blog is about" published; covers via astro:assets (AVIF/WebP); no draft content or images shipped; blog Lighthouse mobile 1.0. Unit 2,520, chromium E2E 102/102. P5.5-13a dispatched.
2026-10-24 · P5-14 · Anderson approved the merged OG image (public/images/og.image.png).
2026-10-24 · P5.5-13a · merged (opus APPROVE; system prompt byte-identical on base vs branch, sha edf0b9e4…; 2,559 tests). Review follow-ups added to the 13b and 13c briefs. 13c and P5.5-16 dispatched.
