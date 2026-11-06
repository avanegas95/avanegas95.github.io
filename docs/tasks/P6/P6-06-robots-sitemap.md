# P6-06: robots.txt and a sitemap
Role: developer · Model: sonnet · Depends on: —

## Goal
avanegas.com has neither `robots.txt` nor a sitemap (the old Pages site didn't either). After this task the build ships both, so Anderson can submit the sitemap in Search Console.

## Read first
- CLAUDE.md (rules 7, 8, 12)
- `astro.config.mjs` (`site` is set; output is static with the Vercel adapter)
- `src/pages/` (note `src/pages/dev/[page].astro`: preview-only, never built on production; `src/pages/api/chat.ts`: the on-demand route)
- `tests/e2e/legacy-urls*.spec.ts` or whichever E2E spec checks legacy URLs, for the style

## Files you own
- `astro.config.mjs`, `package.json`, `package-lock.json` (add `@astrojs/sitemap`, exact version pinned like `@astrojs/vercel`)
- `src/pages/robots.txt.ts` (or `public/robots.txt` if a static file is enough; a route lets the Sitemap line use `site`)
- `src/layouts/Layout.astro` (only to add `<link rel="sitemap" href="/sitemap-index.xml">`)
- A new E2E spec `tests/e2e/seo-files.spec.ts`, and unit tests if useful

## Behaviour / rules
1. `robots.txt`: allow everything except `/api/` and `/dev/`; include `Sitemap: https://avanegas.com/sitemap-index.xml`. Must pass Lighthouse's "robots.txt is valid".
2. Sitemap via `@astrojs/sitemap`: every public page (home, blog index, posts, tag pages, `/projects/*`, `/orbithop/`, `/privacy/`, `/blob-privacy/`), never `/dev/*` or `/api/*`. URLs use the canonical form the site serves (check `trailingSlash` / build format so sitemap URLs don't 308).
3. Pages that are `public: false` (Orbit Hop and SoE project pages, if they are built at all) must not appear. If they're built but unlisted, filter them; report what you found.
4. Legacy URLs (rule 7) keep returning 200; `app-ads.txt` is unchanged.
5. No change to `vercel.json` headers unless the sitemap needs a content type there (it shouldn't).

## Tests required (write first)
- [ ] `/robots.txt` → 200, `text/plain`, contains `Disallow: /api/`, `Disallow: /dev/` and the Sitemap line.
- [ ] `/sitemap-index.xml` → 200 XML, links a sitemap file that lists `/`, `/blog/`, `/orbithop/` and at least one post, and lists no `/dev/` or `/api/` URL.
- [ ] Every URL in the sitemap returns 200 (not a redirect) on the preview server.
- [ ] The home page head has the sitemap link.

## Done when
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` green; new E2E spec green on chromium.
- [ ] Branch `task/P6-06-robots-sitemap` pushed (cut from `feat/blob`).

## Out of scope
Submitting to Search Console (Anderson), any noindex logic, changing page URLs.
