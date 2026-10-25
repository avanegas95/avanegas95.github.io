# Anderson's to-do for P5.5 (in order)

> **Status (orchestrator, 2026-10-24):**
> - H1 done: only "What this blog is about" is published (merged in P5.5-08a).
> - H2 done: D-14 is Staff SQA Engineer; D-11 follows the resume (drop "Linux").
> - H3 done: every prose field is voice-locked unless Anderson says otherwise.
> - H5 done: Anderson keeps his hand-made PDF, served and indexed at `/Anderson_Vanegas_Resume.pdf` (P5-17). Option (i) is not being built.
> - Blob questionnaire done; all answers are in the KB.
> - H4 changed (decision log): Anderson edits copy where it renders. Hero/About done (P5.5-04). Still open: **projects copy** in `src/data/projects.ts` (unblocks P5.5-13b), and the "to be confirmed" markers in KB `paychira.md` / `orbit-hop.md`.
> - Ongoing: run `npm run voice:accept` after any KB prose change and commit `voice.lock.json`.


Agents never write your prose. They only move your words verbatim, wire them up and check them. Each item says what's waiting on it.

This repo is **public**. Draft privately in `docs/content-intake/private/` (gitignored) if you like, but agents can't read that folder, so final text has to land in the public file named below.

| # | What | Where | Unblocks |
|---|---|---|---|
| **H1** | Name the blog post(s) to publish. On `origin/blog-posts` today, every post is `draft: true` except **"Lessons from wiring CI for mobile tests"**, which has no flag. "What this blog is about" is marked draft. Also confirm the published post is OK publicly: it mentions Appium/CI work, and has a cover alt that says "Placeholder". | Reply to the orchestrator | P5.5-08a |
| **H2** | Resolve **D-14** (Staff vs Senior title) and confirm or cut the **D-11** tools (Jenkins/Buildkite, Zephyr/X-Ray, Bash/Linux). | `docs/DISCREPANCIES.md` rows, or reply | P5.5-04, P5.5-05 (P5-10 uses the interim rule until then) |
| **H3** | Confirm which fields are "yours" and get voice-locked. The default is every KB body, `summary`, `headline`, `lede`, role bullets and project descriptions. | Reply | P5.5-13c |
| **H4** | After P5.5-13a merges, fill in **`docs/content-intake/site-copy.md`**: <br>• hero headline and lede ("since 2019", no year count) <br>• About paragraphs (fix "is makes" and "TestRails" yourself) <br>• a summary and description for each project card you want in the KB, including a fix for the Orbit Hop fragment and the AI Digest "Private repo" + repo-link mismatch <br>• whether each repo link is public <br>• optional cover images in `src/assets/images/projects/` | That file | P5.5-04, P5.5-13b |
| **H5** | Resume: pick **(i)** a `/resume/` page built from the KB, with the PDF URL redirecting to it (recommended), or **(ii)** keep it hand-made and check it against the KB. If (i), update CLAUDE.md rule 7 and D-06, and say whether `/resume/` should be indexed. | CLAUDE.md, DISCREPANCIES, reply | P5.5-13d |
| ongoing | Review each content PR's diff, then run **`npm run voice:accept`** locally. It shows old → new and whether each change is verbatim from your intake. Only you can run it (it refuses non-interactive shells). | Your terminal | Merge of 13b, 04, and any KB prose change |
| check | Look at the OG image in the P5-10 report and say if it's stale. | Reply | P5-10 sign-off |
| optional | Answer the Blob questionnaire (moved into the backlog) | `docs/content-intake/about-me-questions.md` | Blob "about Anderson" KB |

Already decided, so nothing to do: hero years ("since 2019"), resume content may go on the site, project cards and links approved, `feature/projects-section` pushed, Spotify player dropped, D-15 (Paychira) resolved.
