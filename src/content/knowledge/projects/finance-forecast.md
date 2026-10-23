---
topic: project
title: Finance Forecast
summary: A full-stack sales-forecasting SaaS for small agencies, developed for Datalily with AI tools and deployed on Vercel, Render and Supabase.
updated: 2026-10-13
public: true
order: 2
---

**Status:** to be confirmed · **Role:** Designer and builder (developed for Datalily) · **Stack:** React 18, Vite, Tailwind, FastAPI, Pydantic, Supabase, Vercel, Render

### What it does

Finance Forecast is a sales-forecasting tool for small agencies. Anderson used AI tools to design, build and deploy it. It tracks deals and turns them into revenue forecasts, so agencies can see what the pipeline is likely to bring in.

### Highlights

- A deal pipeline with probability-weighted revenue forecasts.
- Org and team roles, and CSV import.
- PandaDoc contract synchronization.
- An AI chat over the pipeline data.
- The front end is React 18, Vite and Tailwind on Vercel. The back end is FastAPI with a Pydantic REST API on Render. The database is Supabase.

### QA angle

Anderson automated the pull request process with Gemini Code Review and CodeRabbit. Deployment status from Vercel and Render is pulled in as a required check before merging. Those required checks must pass before merging.
