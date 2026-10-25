---
topic: project
title: The State of Ecosystems 2026
summary: "Interactive, eight-page React report for HubSpot's State of Ecosystems partner study, hosted on HubSpot CMS: 17 shareable filter views, JSON-driven copy, partner audio and video, built to WCAG 2.1 AA and handed off to HubSpot's web team."
updated: 2026-10-24
public: true
order: 2
status: "Handed off"
role: "Front-end builder and handoff coordinator (external agency developer for HubSpot)"
tech:
  - "React 19"
  - "Vite 8"
  - "CSS Modules"
  - "HubSpot CMS (HubL)"
  - "HubSpot CLI"
  - "GitHub Actions"
  - "Figma MCP"
  - "JSON content layer"
cardTech:
  - "React"
  - "Vite"
  - "HubSpot CMS"
  - "CSS"
links:
  live: "https://www.hubspot.com/state-of-ecosystems"
featured: true
cover: cover.jpg
---

### What it does

The State of Ecosystems is HubSpot's annual report on its partner ecosystem, delivered as an interactive web experience instead of a PDF. Readers move through eight slide-style pages: a cover, table of contents, a foreword from Zack Kass, data, partner quotes, and growth strategy. They can filter the report by partner type, segment and region. Anderson built the front end from the Figma designs, wired it into HubSpot's CMS, and handed it off to HubSpot's web development team.

### Highlights

- Built the report as a React 19 + Vite app from Figma designs, using Figma MCP to turn frames into components, design tokens and responsive layouts.
- Hierarchical filtering: partner type (Technology or Solutions), then segment and region for Solutions partners. That gives 17 content variants on the By the Numbers and Short Takes pages. The active filter and slide live in the URL hash, so any filtered view can be shared or bookmarked.
- Copy, stats, quotes and media references come from a JSON content layer, so HubSpot's team can update content without touching components.
- Rich media: a horizontal slide deck with hash-linked navigation, video heroes, and audio players for more than 20 partner and expert quotes.
- Built to WCAG 2.1 AA: skip link, keyboard-operable tabs, dropdowns and filter modal, ARIA labels and live regions, and `prefers-reduced-motion` support on animations.
- Shipped to HubSpot CMS as a single IIFE bundle with fixed filenames, loaded by a HubL page template. Asset URLs resolve at runtime from the CMS, and GitHub Actions deploys to QA on merge and to production on tagged releases.

### Handoff

The repo was set up for another team to own: HubSpot Web Team ESLint and Prettier rules, a README covering setup, CMS deployment and secrets, and a content guide that shows editors how to update each page and add media.
