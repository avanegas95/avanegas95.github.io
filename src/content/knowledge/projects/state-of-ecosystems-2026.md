---
topic: project
title: The State of Ecosystems 2026
summary: An interactive React report experience for HubSpot's State of Ecosystems partner report, built with Figma MCP and handed off to HubSpot's web team.
updated: 2026-10-13
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

- Client-side filtering supports 17 content variants on specific pages. The URL hash holds the filter state, so a filtered view can be shared.
- Copy and stats come from a JSON content layer. Editors can update content without touching components.
- It met the vendor requirements: WCAG 2.1 AA, Lighthouse performance and SEO targets, and a main-JS budget of about 50 KB. Lazy-loading and code-splitting kept it there.

### QA angle

The requirements read like a QA checklist: accessibility, performance and a hard size budget. A clean handoff to the client's team was part of the job too.
