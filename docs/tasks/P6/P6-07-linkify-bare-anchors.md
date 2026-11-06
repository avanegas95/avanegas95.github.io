# P6-07: Blob links bare section anchors
Role: developer · Model: opus · Depends on: —

## Goal
Blob sometimes writes a bare `#experience` in plain text instead of the markdown link the prompt asks for. After this task the client renderer turns a bare token that exactly matches an allowed `#` anchor into a same-site link, the same way it already links bare `https://` URLs.

## Read first
- CLAUDE.md (rules 4, 8)
- docs/SCOPE.md §6.6 (output scrubbing / link allowlist)
- `src/scripts/blob/markdown.ts` (see how bare `https://` URLs are found, including the streaming rule about unfinished tokens)
- `src/scripts/blob/links.ts` (`SITE_PATHS`, `safeHref`)
- `tests/unit/markdown.test.ts`

## Files you own
- `src/scripts/blob/markdown.ts`
- `tests/unit/markdown.test.ts` (and an E2E assertion in `tests/e2e/blob-chat.spec.ts` only if the existing fixture setup makes it a few lines)

## Behaviour / rules
1. Only `#` entries of `SITE_PATHS` are linkified (`#home`, `#about`, `#experience`, `#skills`, `#projects`, `#contact`). Never `/`, `/blog/` or other bare paths, and never an unlisted anchor (`#education` stays text).
2. Match is exact and case-sensitive on a token boundary: preceded by start, whitespace or `(`; followed by end, whitespace or one of `.,;:!?)`. `#experiences`, `foo#skills`, `#skills-x` and `##skills` stay text.
3. Link text is the token as written (`#experience`); the href comes from `safeHref`. Same element, attributes and classes as an existing same-site link (no `target=_blank`).
4. Not inside inline code or anywhere else the renderer already treats as literal; not inside an existing `[label](url)`.
5. Streaming: a token at the very end of a partial chunk is not linked until a boundary character or the final render arrives (so `#skill` → `#skills` doesn't flash a wrong state). The final render must equal a one-shot render of the full text (keep whatever invariant the file already tests between incremental and full rendering).
6. No change to the server scrubber, the prompt or PROMPT_VERSION. Bundle stays ≤ 25 KB gzip (`npm run check:bundle` or the bundle test).
7. Keep the renderer linear-time (there's a perf test for adversarial input; add `#` floods to it).

## Tests required (write first)
- [ ] `See #experience.` → link `#experience` then `.`
- [ ] `(#skills)` → parens kept, link inside
- [ ] `#education`, `#experiences`, `a#skills`, `` `#skills` ``, `##skills` → no link
- [ ] `[his work](#experience)` still renders as one link with label "his work"
- [ ] streaming: chunks `"see #skil"`, `"see #skills"`, `"see #skills and more"` → link only appears once the boundary arrives; final equals one-shot
- [ ] perf: 50k chars of `#` and `#skill` repeats render within the existing perf budget

## Done when
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` green, bundle gate green.
- [ ] Branch `task/P6-07-linkify-bare-anchors` pushed (cut from `feat/blob`).

## Out of scope
The server scrubber, the prompt, new allowed paths, styling.
