# P6-09: Blog post page layout
Role: designer · Model: sonnet · Depends on: —

## Goal
On `/blog/<slug>/` the cover image spans the full widened container (max-w-7xl), so at 1440×900 it fills the whole screen under the header and the article starts far below the fold; the monospace prose also runs at full width, so lines are very long. Anderson isn't happy with it. After this task the post page reads like an article: a readable column, a cover that doesn't swallow the screen, and the first lines of the article close to the fold. The blog index (P6-04, `PostCard.astro`) is approved as is: don't change it.

## Read first
- CLAUDE.md (rule 8: Lighthouse ≥ 0.95, axe clean)
- `src/pages/blog/[...slug].astro`, `src/components/blog/BlogCoverImage.astro`, `src/layouts/BlogLayout.astro`, the `.blog-prose` rules in `src/styles/global.css`
- `tests/e2e/blog.spec.ts` (P6-04's above-the-fold tests are the pattern)

## Files you own
- `src/pages/blog/[...slug].astro`, `src/components/blog/BlogCoverImage.astro`
- `.blog-prose` rules in `src/styles/global.css` (only those)
- `tests/e2e/blog.spec.ts`
- `BlogLayout.astro` only if the post page truly can't narrow its own column (the index uses the same layout and must not change)

## Behaviour / rules
1. The post's header, cover and prose sit in one centred reading column (around `max-w-3xl`; prose line length roughly 65–80 characters at the monospace font). Pick what looks right; say why in the report.
2. The cover is a wide band inside that column (e.g. `aspect-[2/1]` or a capped height with `object-cover`), still `eager` + `fetchpriority="high"` (it's the LCP image), with `sizes` matching the column width actually rendered (no overstated value; P6-04's review caught that).
3. At 1440×900 and 1280×720: the title, summary and at least the top of the cover are in the first viewport, and the first paragraph of the article starts no lower than about 1.3 viewport heights. On a 390-wide phone everything stacks with no horizontal scroll.
4. Remove the hard-coded placeholder caption "Cover image — sits between the post header and article body." (it's dev text shown to visitors). Keep the `caption` prop for real captions.
5. "← Back to blog", the date, tags and the header divider stay; match the site's existing colours and type.
6. Reduced motion, a11y and Lighthouse budgets unchanged or better.

## Tests required (write first)
- [ ] 1440×900 and 1280×720: h1 and summary bottom < viewport height; cover top < viewport height; first `.blog-prose p` top < 1.3 × viewport height.
- [ ] Prose column width ≤ 800 px at 1440 wide.
- [ ] 390×844: no horizontal overflow (`scrollWidth <= clientWidth`), cover full column width.
- [ ] The placeholder caption text is not on the page.
- [ ] axe clean on the post page (if a blog axe test exists, keep it green).

## Done when
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` green; blog E2E green on chromium.
- [ ] Screenshots at 1440×900 and 390×844 described in the report (save them under the scratch dir, not in the repo).
- [ ] Branch `task/P6-09-blog-post-layout` pushed (cut from `feat/blob`).

## Out of scope
The blog index and PostCard, post content, new fonts, BlogLayout's width for other pages.
