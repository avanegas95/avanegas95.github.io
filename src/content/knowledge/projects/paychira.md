---
topic: project
title: Paychira
summary: "Sales forecasting, realized revenue and profitability for agencies, in production at Datalily: deal pipeline, PandaDoc sync, P&L by project, and an AI ask bar."
updated: 2026-11-5
public: true
firstPerson: true
order: 1
status: "Live"
role: "Solo designer and builder, for Datalily"
tech:
  - " React 18"
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

Paychira is a sales forecasting, revenue and profitability app built for agencies. I used AI tools to design, build and deploy it, working for Datalily, a Boston based content marketing agency It turns a deal pipeline into a visual probability-weighted forecast, realized revenue by month, and a margin for every project.

::shot[dashboard.png]

### The problem

Datalily tracked deals in Google Sheets, which needed manual updates every month. It was a wall of numbers, so seeing how they were trending month to month meant interpreting the data by hand.

### My role

I began work on this by myself from start to finish (and it's never really finished as I continue to update it!). I started by converting the spreadsheet into a Python script that would take the data and calculate the value correctly.

Once that was set, I had to figure out next steps. I had no prior experience with front ends, databases or hosting, so I used AI-assisted development to learn each step as I went. In the end, I put the front end on Vercel, the back end on Render (since retired; it now lives on Vercel too) and the database on Supabase.

As I implemented, I learned new workflows, new terminology, and how to design and build directly for a client. 

### Features

**Pipeline and forecast.** Deals carry A to D probability grades that weight the forecast, and deals that haven't moved get a stale flag. This helps the team estimate where the weak months are and where more sales are needed, and the stale flags prompt follow-ups with clients.

::shot[sales-forecast.png wins.png]{pair}

**Realized revenue.** Using PandaDoc APIs, signed contracts and their line items sync automatically with their status, so won work becomes revenue by month. Line items can be individually tracked to closely monitor realized revenue. 

::shot[revenue.png]

**Profitability.** A monthly P&L shows margin by project and deliverable. Freelancer and subscription costs can be allocated to projects or to overhead.

::shot[profit-and-loss.png costs.png]{pair}

**Ask bar.** An AI ask bar answers questions about pipeline, costs and margins, and asks for confirmation before it changes any data.

::shot[ask-bar.png]

It also has org and team roles, CSV import and goal-pace insights.

### How it was built

The front end is React 18, TypeScript, Vite and Tailwind. The back end is a FastAPI and Pydantic REST API. Both are hosted on one Vercel project, with Vercel Cron running the PandaDoc sync. Supabase handles the database and auth.

::shot[integrations.png]

### Key decisions

Datalily set the requirements; most of the key decisions were in the implementation.

- Consolidation: the initial workflow of Vercel, Render and Supabase meant more time waiting for builds on several platforms. Consolidating allowed the process to move quicker, and every PR gets a Vercel preview to test before it merges to production. 
- Testing infrastructure: from the get-go, every major change was built to be testable, and I reviewed and approved each one. A consistent seed of data allowed for both demoing and explaining product features to Datalily, and confirming nothing was broken as new features were added. 

### Quality and testing

- More than 700 API tests run against fake database connections, alongside Vitest unit tests and Playwright end-to-end tests on desktop and mobile.
- A seeded demo organization with hand-computed totals is verified on every seed.
- Every pull request gets reviews from Gemini Code Assist and CodeRabbit. GitHub Actions runs lint, typecheck, unit, API and end-to-end tests, and the Vercel preview deployment is checked before merging.

### Outcome

While developing, Datalily used Google Sheets and Paychira to verify things were correct. Once the numbers matched, they retired the sheet. 

Since moving into Paychira they save time by no longer needing to manually track, import, and keep an eye on signed deals in PandaDoc.

They can quickly and visually see where they need to improve in sales, and they can balance their workload and make strategic choices on when to work with freelancers, where their money is going, and have financial awareness. 

::shot[insights.png]
