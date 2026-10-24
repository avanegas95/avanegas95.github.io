---
topic: project
title: The State of Ecosystems 2026
summary: An interactive React report experience for HubSpot's State of Ecosystems partner report, built with Figma MCP and handed off to HubSpot's web team.
updated: 2026-10-24
public: true
order: 1
status: "handed off"
role: "Builder and handoff coordinator"
tech:
  - "React"
  - "Vite 6"
  - "Figma MCP"
  - "JSON content layer"
---

### What it does

This is an interactive website experience for HubSpot's State of Ecosystems partner report. Filtering on specific pages shows different content variants. Anderson built it with Figma MCP and then coordinated the handoff to HubSpot's web development team.

### Highlights

- Leveraged Figma MCP to build an interactive website experience for HubSpot’s State of Ecosystems partner report as a React + Vite 6 project
- Implemented client-side filtering; supports 17 content variants on specific pages, driven by URL-hash as the filter state. Copy and stats are served from a JSON content layer so content could be updated without modifying components
- Met vendor requirements including WCAG 2.1 AA, Lighthouse performance/SEO, and a ~50 KB main-JS budget via lazy-loading and code-splitting
- Coordinated a handoff to HubSpot's web development team.

### QA angle

The requirements read like a QA checklist: accessibility, performance and a hard size budget. A clean handoff to the client's team was part of the job too.
