---
topic: project
title: Paychira
summary: "Sales forecasting, realized revenue and profitability for agencies, in production at Datalily: deal pipeline, PandaDoc sync, P&L by project, and an AI ask bar."
updated: 2026-10-24
public: true
order: 1
status: "Live"
role: "Designer and builder (developed for Datalily)"
tech:
  - "React 18"
  - "TypeScript"
  - "Vite 7"
  - "Tailwind"
  - "Radix UI"
  - "Recharts"
  - "Python"
  - "FastAPI"
  - "Pydantic"
  - "Supabase"
  - "Vercel"
  - "OpenAI API"
  - "PandaDoc API"
cardTech:
  - "React"
  - "FastAPI"
  - "Supabase"
  - "Vercel"
  - "Python"
links:
  repo: "https://github.com/avanegas95/paychira"
  live: "https://www.paychira.com/"
featured: true
cover: cover.jpg
gallery:
  - file: dashboard.png
    alt: "Paychira dashboard with secured, weighted and total forecast revenue cards above a monthly forecast chart and goal line"
  - file: sales-forecast.png
    alt: "Sales Forecast table of open deals with A to D probability grades, tags and a stale-deal flag"
  - file: wins.png
    alt: "Wins page listing won projects with total and prorated revenue"
  - file: insights.png
    alt: "Insights page with secured revenue to date, projected year-end and goal-pace cards"
  - file: revenue.png
    alt: "Revenue page comparing realized line-item revenue with the weighted forecast by month"
  - file: profit-and-loss.png
    alt: "Profit and Loss page with revenue against goal, project costs, gross and net margin, and a monthly cost chart"
  - file: costs.png
    alt: "Costs ledger of freelancer and subscription costs allocated to projects or overhead"
  - file: integrations.png
    alt: "Integrations page with the PandaDoc connection and three revenue-exclusion rules"
  - file: ask-bar.png
    alt: "The AI ask bar open over the dashboard with suggested questions"
---

### What it does

Paychira is a sales forecasting, revenue and profitability app for agencies. Anderson used AI tools to design, build and deploy it for Datalily, which runs on it in production. It turns the deal pipeline and signed PandaDoc contracts into a probability-weighted forecast, realized revenue by month, and a margin for every project.

### Highlights

- Leveraged AI tools to design, build, and deploy it: a deal pipeline with probability-weighted forecasts and stale-deal flags, PandaDoc contract and line-item sync, realized revenue by month, revenue-exclusion rules, a monthly P&L with margin by project and deliverable, org/team roles, CSV import, and an AI ask bar that answers about pipeline, costs and margins and asks for confirmation before changing data.
- Front end: React 18, TypeScript, Vite, Tailwind. Back end: FastAPI and Pydantic REST API. Both are hosted on one Vercel project, with Vercel Cron for the PandaDoc sync. Database and auth: Supabase. The API moved from Render to Vercel in September 2026.
- Automated PR process: Gemini Code Assist and CodeRabbit review pull requests. GitHub Actions runs lint, typecheck, unit, API and end-to-end tests on every PR, and Vercel preview deployments are checked before merging.
- Testing: more than 700 API tests run against fake database connections, alongside Vitest unit tests and Playwright end-to-end tests on desktop and mobile. A seeded demo organization with hand-computed totals is verified on every seed.
