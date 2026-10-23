# Where Blob lives on the v1 page (decision for Anderson)

PLAN P5-04 says "Home hero". This compares concrete options so Anderson can pick one. Only P5-04c (the mount) waits on the answer; every other P5 task, including Blob's UI port (P5-04a/b), is built and tested on the `/dev/blob` preview page and is placement-agnostic.

## The v1 home page today (`feat/blob` = `main` 9197cce)
`src/pages/index.astro` → `Layout.astro` (dark-only, mono font, body gutters `px-4…xl:px-24`, `pb-20` on mobile for the bottom nav).
1. **Nav** (`Nav.astro`): desktop is a fixed top bar (`--nav-height` 5.5rem, blurred); mobile is a **fixed bottom tab bar** (Home, Experiences, Projects, Contact, Blog). Items from `src/data/nav.ts`.
2. **`#home`** (`Home.astro`): `min-h-[90vh]` (80vh on lg), vertically centred, single column, max-w-7xl, with a React `DotPattern` background (`client:idle`). In order: "Hi, my name is" → h1 "Anderson Vanegas." → h2 tagline → lede paragraph → "Check out my work" CTA → social icons → **About Me** (3 paragraphs, 6-item tool list, `LogoWall`). Staggered fade-in. Probable LCP element: the h1 or the lede (text, no hero image).
3. **`#experiences`** (`Experiences.astro`, timeline).
4. **`#projects`** (`Projects.astro`, card grid).
5. **`#contact`** (`Contact.astro`: details + Formspree form).
6. **Footer**.

The hero is long on mobile: About Me lives inside `#home`, so on a phone the fold shows only the greeting, h1 and part of the tagline.

## `feature/projects-section` (local, 3 commits ahead of `main`)
`git log --stat main..feature/projects-section` touches only `src/components/sections/Projects.astro`, `src/data/projects.ts` and `src/lib/types.ts` (adds `status`, optional links, five real project cards: Paychira, State of Ecosystems 2026, AI Digest, Orbit Hop, avanegas.com; the last commit removes a sub-section). It does **not** touch `index.astro`, `Home.astro`, `Nav.astro` or `Layout.astro`, and it branches from the current `main` tip, so **it does not affect placement** and will merge cleanly beside any option. It does matter to P5-07: those projects are not all in the KB (D-12), so Blob would not know about cards the page shows. Only option D sits next to Projects, and even there the files are disjoint.

## Options
Common to all: Blob's SVG and stage are server-rendered with fixed dimensions (no CLS from hydration); the island hydrates on idle/visible; the speech bubble (SCOPE §4.3) shows the latest answer in full up to a max height, the question briefly above it, earlier turns behind "previous", input directly under Blob; bubble region `aria-live="polite"`, `Esc` and focus as §4.4. Streaming text that pushes content down more than 500 ms after the click **counts toward CLS**, so each option says where the bubble's growth goes.

### A. Hero, side by side (Blob in a right column) ★ recommended
- **What moves**: `#home` becomes two columns on ≥ lg: intro (greeting, h1, tagline, lede, CTA, socials) left, Blob stage + chips + input + bubble right. **About Me moves out of the hero into its own `#about` section** right after it (it's already a separate block; this also matches the scrubber's `#about` anchor and SCOPE §9's order).
- **Mobile**: one column; Blob (≈ 120 px) + chips + input come right after the lede, CTA and socials follow. The bubble opens full width under the input.
- **Bubble growth**: desktop: grows downward inside the right column, which is top-aligned (`items-start`, not centred) so the left column never moves. Mobile: grows in flow and pushes the CTA/socials; mitigate with a reserved `min-height` and `max-height` + "show more" so the shift is bounded and mostly within 500 ms of input.
- **LCP/CLS/a11y**: LCP stays the h1 text (Blob SVG is small inline markup, not an image). CLS ≈ 0 at load (fixed stage size). Reading order intro → Blob is natural; the hero gets a little denser, but less than today once About moves out.
- **Effort**: M (hero grid + a new `About.astro` extracted from `Home.astro`, plus nav item if wanted).

### B. Hero, Blob replaces the CTA row
- **What moves**: the "Check out my work" button is replaced by Blob's row: a small Blob (≈ 96 px) with the greeting bubble beside it, chips and the input under it. Everything else stays in its single column, About Me included.
- **Mobile**: same column; the stage is in roughly the same place the CTA was, so it lands just under the fold on most phones.
- **Bubble growth**: in flow, pushes socials and About Me down on every answer (largest CLS exposure of the hero options); needs the same min/max-height bounds as A.
- **LCP/CLS/a11y**: LCP unchanged. Loses the primary "see projects" CTA (could become a chip: "Show me his projects"). Smallest visual change.
- **Effort**: S–M.

### C. Floating dock (corner launcher)
- **What moves**: nothing in the page flow. A fixed launcher (Blob avatar, 56–64 px, idle wobble) in the bottom-right on the home page; click opens a popover with Blob hero-size, the bubble, chips and input. The hero could still show a short "Ask Blob" link to open it.
- **Mobile**: must sit **above the fixed bottom nav** (offset by its height + safe-area); the popover becomes a bottom sheet above the nav. Risk of covering content and the nav's touch targets.
- **Bubble growth**: inside the popover, zero page CLS.
- **LCP/CLS/a11y**: best for LCP/CLS. Needs a real dialog pattern (`aria-expanded`, focus moves in and returns, `Esc`), and conflicts with SCOPE §4.3 ("sits in the hero") and the 2026-10-12 "Blob front and centre" intent; it's closer to the backlog's "roaming Blob" (b) and less discoverable on first view.
- **Effort**: M–L (popover/sheet behaviour, nav collision tests in 3 browsers).

### D. Dedicated "Ask Blob" section
- **What moves**: hero unchanged. A new `#ask` section after the hero (before Experiences), with Blob, the greeting, chips, input and bubble given room; a nav item "Ask Blob" (desktop and mobile bar; the mobile bar already has 5 items, so this would be 6 or replace "Home").
- **Mobile**: full-width section; the bubble has the whole width.
- **Bubble growth**: pushes the sections below, but they're off-screen while you read; CLS only matters if in view, so low impact.
- **LCP/CLS/a11y**: zero LCP impact (below the fold, hydrate on visible). Least discoverable: recruiters skimming the hero may never see Blob, which undercuts "Blob is the headline feature" (SCOPE §1).
- **Effort**: S.

## Recommendation
**A**, with About Me extracted to `#about`. It keeps Blob first-view on desktop (the headline feature), keeps v1's intro intact, removes the long About block from the hero, and the top-aligned column contains the bubble's growth without layout shifts on desktop. If Anderson wants the smallest change to v1, pick **B**; if he wants Blob present while scrolling, pick **C** and record it in the decision log, since it departs from SCOPE §4.3.

**Answer needed (PENDING ANDERSON)**: A / B / C / D, and whether "Check out my work" survives (A keeps it, B drops it).
