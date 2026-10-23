# P5.5 proposal: portfolio improvement pass

Status: **proposal for Anderson** (architect, 2026-10-23). No briefs yet. Once Anderson picks a set, the architect writes the briefs and the orchestrator adds the rows to `docs/PLAN.md`.

Audited: `origin/feat/blob` at `4a1005d`. The unmerged local branch `feature/projects-section` (3 commits) was read with `git diff`. Placement A is decided (`_blob-placement.md`): Blob goes beside the intro and About moves to `#about`, built by P5-04c.

## 1. Findings

### 1.1 Lighthouse (built `dist/` served with `serve`, Lighthouse 12.6.1, headless Chrome)
| Page | Mobile P / A / BP / SEO | Desktop P / A / BP / SEO | Notes |
|---|---|---|---|
| `/` | 100 / 100 / 100 / 100 | 100 / 100 / **78** / 100 | mobile LCP 1.1 s, CLS 0, TBT 0 |
| `/orbithop/` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | |
| `/privacy/` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | |
| `/blog/` | 100 / 100 / 100 / 100 | not captured (run failed) | |

Top failing audits:
- **Desktop Best Practices 78 on `/`**: `third-party-cookies` (2 cookies) and `inspector-issues`, both from the Spotify album `<iframe>` in `Footer.astro`. Mobile scored 100 only because the lazy iframe never entered the viewport. This is the only result below the 0.95 gate (rule 8). The P5-04c gate (Lighthouse ≥ 0.95 on `/`) will hit it.
- **`uses-responsive-images` / `image-delivery-insight`** (about 68–129 KiB): the experience photos ship at 1024 px wide with no `sizes`/`srcset`. The same BD photo is used twice.
- **`unused-javascript`** (about 40 KiB): the React `client.*.js` runtime loads only for decoration (`DotPattern`, `SectionEyebrow`, `animated-shiny-text`).
- `uses-long-cache-ttl` / `cache-insight` / `render-blocking`: these come from the local `serve` and don't apply on Vercel, which caches `/_astro/*` as immutable. The CSS is about 11 KiB.

Not caught by Lighthouse locally, because `serve` doesn't apply `vercel.json`:
- The CSP (`default-src 'self'`, no `frame-src`) will **block the Spotify iframe on the Vercel Preview**, leaving an empty 152 px box. Inferred from `vercel.json`; verify on the Preview.
- **`og:image` 404s.** `Layout.astro` points to `https://avanegas.com/images/og.image.png`, but `public/images/` doesn't exist; the file is at `src/assets/images/og.image.png`.

### 1.2 Copy
- **Hero lede** (`Home.astro`): "Senior SQA Engineer with 7 years of experience in manual testing and 3 years in automation".
  - The title is outdated: he has been Staff since March 2026 (D-07).
  - "7 years" breaks D-03's interim rule ("since 2019", no number).
  - "manual vs automation" years undersell the Staff level.
- **Meta description**: "SQA Engineer | Automation Engineer". It's stale and never says Staff or Boston Dynamics. The `<title>` is the name only.
- **About**:
  - Typo: "software that is makes sense".
  - "TestRails" should be TestRail (D-09).
  - The tool list includes Jenkins/Buildkite and Zephyr, which are D-11 (pending Anderson's confirmation).
  - The tool list and the `LogoWall` overlap but disagree: the list says "day-to-day" Jenkins/Zephyr, while the wall shows Supabase/Render/HTML5.
- **Experience** (`Experiences.astro`):
  - The Staff card has **no bullets** (a `TODO` comment).
  - Its dates read "2026 – Present" and should be March 2026 (D-07). The Senior card reads "September 2023 – 2026".
  - None of the cleared BD metrics are used (D-08: 700+ cases, 16→33 Appium tests).
  - The internship is absent (D-02, title and dates only, if wanted).
  - The heading is "Experiences"; "Experience" is the usual form, and the Blob scrubber allows `#experience` while the page uses `#experiences` (P5-03b owns the allowlist; flag only).
- **Projects on `feat/blob`**: the page shows **"Place Holder Project"**, with an empty tech tag, a placeholder image and "In Development", plus a "More Coming Soon" box. This is also what's live today.
- **Projects on `feature/projects-section`** has real cards (Paychira, State of Ecosystems 2026, AI Digest, Orbit Hop, avanegas.com), but:
  - All five share the placeholder cover.
  - The HubSpot link carries tracking query params (`wfuid`, `wfsid`).
  - Paychira links to `/dashboard`, which is probably behind a login.
  - AI Digest is labelled "Private repo" but links a GitHub repo.
  - The Orbit Hop description is a fragment and its repo slug doesn't match the name.
  - Most of these projects aren't in the KB (D-12), so Blob can't answer about cards the page shows.
- **Contact**:
  - "Location: Boston, MA" should be "Boston area, MA" (D-05).
  - The fields have placeholders only (no visible labels).
  - The submit button sits at 60% opacity and reads as disabled.
  - The section doesn't offer a direct email link (the hero's email icon opens a Gmail compose URL).
- **Blog**: the nav has a "Blog" item on desktop and as the 5th mobile tab, but `/blog/` says "No posts yet".
- **Resume**: on `feat/blob` the PDF URL 302s to LinkedIn (D-06). Anderson wants a new resume version, and V5.0 itself still carries D-01/D-09/D-10.

### 1.3 Design
- **Hierarchy**: the hero holds greeting, h1, h2 tagline, lede, CTA, socials and the whole About block (`min-h-[90vh]`). On a 390 px phone the fold ends mid-lede. Placement A (P5-04c) fixes the structure. What remains:
  - The h2 tagline at `text-5xl` competes with the h1.
  - The lede is long.
- **Consistency**:
  - Sections use three different containers: `container` in Experiences, `max-w-7xl` in Projects and Contact, and Home's own grid. Their left edges don't line up.
  - Projects and Contact have a teal eyebrow ("Selected work", "Let's talk"); Experiences doesn't.
  - Card backgrounds use hard-coded hex values instead of tokens: `#112240` for Experience, `#0c0c0c` (near-black, off-palette) for Projects, `#1414149c` for inputs. There are 11 hard-coded colours across 4 components.
  - Teal (`--sec`) is now Blob's colour. Today it also tints eyebrows, bullets, company names, the CTA and the active nav item, so Blob won't stand out as "the" accent unless that use is rationed.
- **Motion**:
  - Three decorative motions compete with Blob: the logo marquee, the dot pattern and the shiny text.
  - SCOPE §9 reserves motion for Blob.
  - Reduced-motion is respected (the fade-ins and the marquee are guarded).
- **Nav**: Experiences and Projects use the **same folder icon** in the mobile bar.
- **SCOPE §9 gaps**: no Skills section, no footer links to `/orbithop/` or `/privacy/`, and no link at all to the new `/blob-privacy/` (P5-08). The "light/dark + one sans typeface" items are deliberately not proposed: the 2026-10-23 decision keeps v1's palette and mono look.

### 1.4 Sections
- **Order**: Home, Experiences, Projects, Contact, Footer. After P5-04c it becomes Home+Blob, About, Experiences, Projects, Contact. SCOPE §9 suggests About → Experience → Projects → **Skills** → Contact.
- **Redundancy**: the socials appear in the hero, the footer, and Contact (by implication). The tool list and the LogoWall overlap.
- **Missing**:
  - Staff-role content.
  - Real projects (the branch exists but is unmerged).
  - A Skills anchor (`#skills` is already in Blob's link allowlist but has no target).
  - Footer legal/legacy links.
  - A working OG image and structured data (Person JSON-LD with `sameAs` LinkedIn/GitHub).

## 2. Improvement options

"In-flight conflict" is checked against the P5 task table and the "Files you own" lists. Most notably, P5-04c owns `Home.astro`, the new `About.astro`, `index.astro`, and `nav.ts` (option D only, not chosen).

| # | Option | Impact | Effort | Role / model (reviewer) | P5 deps / file conflicts | Fits |
|---|---|---|---|---|---|---|
| **O1** ★ | **Meta and share fixes**: serve the OG image from a real path, Staff-accurate `<title>` and description, Person JSON-LD (email/LinkedIn/GitHub only) | High (every share and search snippet) | S | developer / sonnet (sonnet) | `Layout.astro`, `public/images/`; no owner in P5. JSON-LD adds an inline script, so its CSP hash must be added in `vercel.json` (P5-02 merged; coordinate with P5-05 `csp.spec`) | **P5** (batch 3, alongside) |
| **O2** ★ | **Footer cleanup**: replace the Spotify iframe with a static "on repeat" link card (fixes BP 78, the CSP block and third-party cookies); add `/orbithop/`, `/privacy/`, `/blob-privacy/` links; computed copyright year | High (unblocks the ≥ 0.95 gate on `/`) | S | designer / sonnet (sonnet) | `Footer.astro` only. Needed before P5-04c's Lighthouse check; links to P5-08's page | **P5** (before P5-04c) |
| **O3** ★ | **Land Projects**: rebase `feature/projects-section` onto `feat/blob`, fix the link/status issues in §1.2, add per-project cover art or an image-less card variant, drop "More Coming Soon", add a unit test on `projects.ts` (no tracking params, status ↔ link consistency) | High (removes the live placeholder) | M | designer / sonnet (sonnet) | `Projects.astro`, `projects.ts`, `types.ts`; no P5 owner. P5-07 reads the branch, so the KB facts for new projects still need Anderson's intake (D-12) | **P5** (batch 3) |
| **O4** ★ | **Hero + About copy refresh**: Staff title, "since 2019" (D-03), shorter lede, typo, TestRail, D-11 tools only if confirmed, and a smaller tagline size so the h1 wins | High (first thing recruiters read) | S | copywriter / sonnet (sonnet) | **Conflicts with P5-04c** (`Home.astro`, `About.astro`), so run it after 04c merges. Needs Anderson's recent text and DISCREPANCIES calls | **P5.5** |
| **O5** ★ | **Experience as data + Staff content**: move the cards to `src/data/experience.ts`, add Staff bullets from the resume (Anderson approves), March 2026 dates, D-08 metrics, optional intern line (D-02), tokens instead of hex, responsive `sizes`/`widths` on the photos (about 70–130 KiB saved), and rename the heading to "Experience" | High | M | developer / sonnet (sonnet) | `Experiences.astro`, new data file. P5-07's `kb-site-consistency` test may read this file, so run after P5-07 merges and keep that test green | **P5.5** |
| **O6** ★ | **Contact polish**: visible labels, a full-opacity submit button, a direct email/LinkedIn line, "Boston area, MA" (D-05), and an E2E test with Formspree intercepted (success and error states) | Medium | S | designer / sonnet (sonnet) | `Contact.astro`, new `tests/e2e/contact.spec.ts`; no P5 owner | P5 or **P5.5** |
| O7 | **Skills section** (`#skills`): merge the About tool list and the LogoWall into one grouped list (Testing / Automation / CI / Web), and make the marquee static or opt-in so motion is reserved for Blob | Medium (SCOPE §9 order; fills the scrubber anchor) | M | designer / sonnet (sonnet) | Edits `About.astro` (P5-04c), so run it after 04c; D-11 open | P5.5 |
| O8 ★ | **Nav and Blog honesty**: hide "Blog" from the nav until there is a post (or flag-gate it), give Experience/Projects distinct icons, add `#about` if Anderson wants it | Medium | S | developer-lite / haiku (sonnet) | `nav.ts`, `Nav.astro`. P5-04c touches `nav.ts` only under option D (not chosen), so low risk; sequence after 04c anyway | P5.5 |
| O9 | **Visual consistency pass**: one section container and heading pattern (eyebrow + h2) everywhere, colour tokens for the card/input surfaces, teal rationed to Blob + links + focus | Medium–High (the page reads as one system) | M | designer / sonnet (opus, cross-cutting) | Touches every section file, so it **must run last**, after O3–O7 | P5.5 (last) |
| O10 | **Drop React from `/`**: rewrite `DotPattern`, `SectionEyebrow` and `animated-shiny-text` as Astro/CSS (the React runtime, about 40 KiB unused, leaves the home page) | Low–Medium (perf is already 100; frees budget for Blob) | S–M | developer / sonnet (sonnet) | `src/components/ui/*`; P5-05's bundle check excludes React chunks, so no conflict | P5.5 |
| O11 | **Resume v6 PDF**: Anderson finalises the resume in the private repo (fixing D-01/D-09/D-10, no phone or address). The site then serves the clean PDF instead of the 302, and the E2E/unit tests are flipped | High for recruiters | M (mostly Anderson) | developer / sonnet (opus, rule 7) | Changes `vercel.json` and P5-05's `resume-redirect` tests, so it goes after P5-05. Needs a CLAUDE.md rule 7 / DISCREPANCIES D-06 update by Anderson | P5.5 |
| O12 | **First blog post**: "How I test an AI agent" (the Blob build story; public-safe, no red-team or eval details), which turns the Blog nav back on | Medium (shows Staff-level thinking) | M | copywriter / sonnet (sonnet) | `src/content/blog/` only. Must avoid private review material (rule 10) | P5.5 or later |

| **O13** ★ | **Single source of truth + voice-safe authoring** (§2.1): KB files become the one place Anderson's facts and prose live; site sections render from them, the resume is generated from or checked against them, and CI fails on drift or on non-Anderson prose edits | Very high (ends the site/KB/resume drift that DISCREPANCIES keeps catching; protects his voice) | **L** total, split into O13a–d | see §2.1 | Needs P5-03a (KB + collections) and P5-07 (consistency test) merged; reshapes O3/O4/O5 | **P5.5** (backbone) |

★ = **recommended set**, two steps:
- **Inside P5 now:** O1 and O2. Neither overlaps an in-flight task, and O2 unblocks the P5-04c Lighthouse gate.
- **P5.5:** O13 is the backbone. O3, O4 and O5 then become content work on top of it: projects, hero/About and experience are each authored once in the KB and rendered from there. Alongside them come O6 and O8.

If O13 is chosen, the placeholder project that is live today needs a stopgap: land O3 as a minimal "hide the placeholder" change in P5, and make the real cards part of O13b. O9 is a good closer if Anderson wants polish. O11 folds into O13d.

### Suggested P5.5 batching (with O13)
1. P5 now: O1 ∥ O2 (and an O3 stopgap if wanted). Files are disjoint: `Layout` / `Footer` / `Projects`.
2. After P5-03a, P5-07 and P5-04c merge, start O13a (schema and loaders). Anderson writes or dictates his content in parallel (§2.1, step 1).
3. O13b (sections render from the KB, which absorbs O3, O4 and O5) ∥ O13c (CI drift and voice lock) ∥ O6 ∥ O8.
4. O13d (resume from the KB, which absorbs O11), then O7 and O9 last.

### Batching without O13
1. P5 now: O1 ∥ O2 ∥ O3.
2. After P5-04c and P5-07: O4 ∥ O5 ∥ O6 ∥ O8.
3. Then O7, then O9.

## 2.1 O13 in detail: one source, Anderson's voice

**The direction of flow matters.** CLAUDE.md rule 1 says Blob's prompt is built *only* from `src/content/knowledge/*.md`, never from `src/data/*.ts`. So the source of truth has to be the KB, with everything else reading from it, not the other way round. SCOPE §5.2 already intends this: "the visible site sections render from the same content collections, so the site and Blob can't disagree." v1 never got there. Today its facts are hard-coded in five places:
- `Home.astro` (title, years, lede)
- `Experiences.astro` (roles, dates, bullets)
- `src/data/projects.ts` (placeholder)
- the About tool list
- `src/data/technologies.ts`

**What changes**

| Today | After O13 |
|---|---|
| `Home.astro` lede and About paragraphs typed into the component | `knowledge/bio.md` frontmatter holds `headline` and `lede`, which Anderson writes. The body holds the About prose (his words). `Home`/`About` render those fields. |
| `Experiences.astro` has three hand-built cards | `knowledge/experience.md` frontmatter holds `roles: [{company, title, start: YYYY-MM, end, bullets[], metrics[]}]`. The cards map over it. Dates are written once (D-01, D-07 fixed there). |
| `src/data/projects.ts` (+ `feature/projects-section` cards) | `knowledge/projects/<slug>.md`, one file per project as SCOPE §5.2 says, with card frontmatter `{title, status, tech[], links, cover, featured}` and Anderson's description as the body. `projects.ts` is deleted, and the branch's cards are converted into files. |
| `src/data/technologies.ts` + the About tool list | `knowledge/skills.md` frontmatter `groups[]` feeds the Skills/LogoWall (O7). `technologies.ts` keeps only icon/URL lookups (UI, not facts). |
| `nav.ts`, `social-links.ts`, `footer-tech.ts` | Unchanged: UI config, not claims. The social URLs are checked against the KB contact links in CI. |
| Resume V5.0 in the private repo, edited by hand | The **public facts** (titles, dates, employers, bullets, metrics, education) come from the KB. Two options: **(i)** a `/resume/` print page and a PDF built from the KB at build time, which replaces the LinkedIn 302 (rule 7 must be updated by Anderson); or **(ii)** keep the resume hand-made, with a script run *in the private repo* that diffs `resume-v5.md` against the KB facts and lists mismatches. Recommend (i): no PII ever enters it, because the KB already passes the PII guard. |

**KB-side changes**
- Add zod schemas for the new frontmatter in `content.config.ts`.
- Add a frontmatter rendering mode to `kb.ts` so the prompt still contains the facts as stable, sorted text.
- Keep the prompt **byte-deterministic**, and re-run the `kb-budget` (≤ 15k tokens) and prompt-caching tests.
- DISCREPANCIES rows get resolved *in one file* rather than three.

**Voice-safe authoring workflow**
1. **Anderson writes or dictates.** The prose fields are the KB bodies and `headline`/`lede`/bullets. He edits them directly or drops a dictation transcript in `docs/content-intake/`.
   - AI may *structure* that text, moving his sentences into the right fields and frontmatter shape, verbatim apart from obvious transcription fixes he approves.
   - AI may never paraphrase or "improve" it.
2. **`npm run facts:check`** (AI and script assisted, report only) lists:
   - conflicts with DISCREPANCIES rules and between files;
   - stale claims (dates, title, years);
   - PII hits;
   - typos as *suggestions*.
   It never writes prose.
3. **Voice lock in CI.** `voice.lock.json` stores a hash of each Anderson-owned prose field. A test fails if any locked field changed without a matching lock update. Only Anderson runs `npm run voice:accept`, after reviewing the diff. CLAUDE.md gets a rule: "agents never edit locked prose; propose in the PR description instead." Agents can still change frontmatter structure and code.
4. **Drift check in CI** builds on P5-07's `kb-site-consistency`. It fails if a section component contains a hard-coded fact pattern (a year range, "years of experience", a job title, a company name outside the KB render), and if the built HTML disagrees with the KB values.

**Split and effort** (L overall; Anderson's writing time is extra)

| Sub-task | What | Effort | Role / model (reviewer) |
|---|---|---|---|
| O13a | Frontmatter schemas, `kb.ts` rendering mode, migrate the current facts into the KB under the DISCREPANCIES interim rules, prompt determinism and budget tests | M | developer / **opus** (opus: prompt and caching architecture) |
| O13b | `Home`/`About`/`Experiences`/`Projects`(/Skills) render from collections; delete `projects.ts`; convert the `feature/projects-section` cards into KB project files | M | designer / sonnet (sonnet) |
| O13c | `facts:check` report script, voice lock + `voice:accept`, drift test, CLAUDE.md rule text for the orchestrator | M | test-engineer / sonnet (opus: guards the voice rule) |
| O13d | Resume option (i): `/resume/` print page + PDF from the KB, flip the rule-7 tests; or option (ii): the private-repo diff script | M | developer / sonnet (opus: rule 7, PII) |

**Conflicts**
- P5-03a owns `src/content/knowledge/**` and `content.config.ts`, and P5-07 owns `site.md` and the consistency test, so O13 starts after both merge.
- O13b touches `Home.astro` and `About.astro`, so it also starts after P5-04c.

## 3. Questions for Anderson
1. Hero numbers: keep "no number, since 2019" (D-03), or approve a specific claim such as "6+ years in QA"?
2. Staff role: which 3–4 bullets? Should the D-08 BD metrics go on the site?
3. Projects: which `feature/projects-section` cards ship, are the Paychira and HubSpot links OK to show publicly (the latter without the tracking params), and do you have cover images?
4. Keep the Spotify player in some form, or drop it?
5. Blog: hide the nav item until there's a post, or commit to a first post (O12)?
6. Tools: confirm or cut Jenkins/Buildkite, Zephyr/X-Ray and Bash/Linux (D-11). Add the internship line (D-02)?
7. New resume: when will the clean PDF exist, and should it replace the LinkedIn 302 before P6?
8. O13: should the resume be generated from the KB (option i, a public `/resume/` page + PDF), or stay hand-made and only be checked against the KB (option ii)?
9. O13 voice lock: which fields count as "yours" and get locked (all KB bodies + headline/lede/bullets, or prose only)? Do you prefer writing in the KB files directly or dictating into `docs/content-intake/`?
