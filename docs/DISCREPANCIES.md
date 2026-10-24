# Content discrepancies tracker

Anderson will resolve these later (decision 2026-10-12). Until an item is resolved:
- **The KB uses the "Interim KB rule" column.**
- Blob must not assert anything listed as unresolved beyond what that rule allows.

Agents: add new rows when you find conflicts, and never resolve one yourself. Only Anderson resolves items. Record the resolution and the date.

**Precedence**, unless a row says otherwise:
1. Resume V5.0 (`docs/research/resume-v5.md`)
2. v2b branch `feat/gui-first-pytest-portfolio`
3. v2a
4. v1
5. The old PDF

| ID | Topic | Sources disagree | Interim KB rule | Status |
|---|---|---|---|---|
| D-01 | SharkNinja end dates | V5.0 lists SQA II "April 2022 – Present" and SQA "November 2019 – Present", even though he joined BD Sep 2023. Old PDF and v1: SQA II Apr 2022–Sep 2023, SQA Nov 2019–Apr 2022. | Use Nov 2019–Apr 2022 (SQA) and Apr 2022–Sep 2023 (SQA II). | open (fix in resume) |
| D-02 | Intern role | Only in V5.0 and v2b: "Product Development Intern, Apr–Nov 2019", with no bullets. | Mention the title and dates only. If asked for details, Blob says it doesn't know. | open |
| D-03 | Years of experience | Old PDF says 5+, v1/v2 say 6+, and a code TODO says about 7. The resume dates give about 6.5 years in SQA since Nov 2019, or about 7.5 including the internship. | Don't state a number. Say "since 2019". | open |
| D-04 | LinkedIn URL | `/in/avanegas95/` (V5.0, v1, v2a) vs `/in/andersonvanegas/` (v2b branch). | `/in/avanegas95` | **resolved 2026-10-12** (Anderson) |
| D-05 | Location detail | V5.0 header has a full street address (never publish). v2b says "Framingham / Boston, MA", elsewhere "Boston, MA". | "Boston area, MA" | open (SCOPE Q7) |
| D-06 | Old public resume PDF | `public/Anderson_Vanegas_Resume.pdf` on v1 and v2a is stale (2025, Senior title) **and exposes a phone number**. | The resume URL serves Anderson's current public-safe PDF (city, site, email and LinkedIn only; no phone, street address or other PII). `guard:pii` scans its extracted text. The Markdown copy is `docs/content-intake/resume.md`. | resolved 2026-10-24 (Anderson supplied the PDF) |
| D-07 | Staff role start | v1 says "2026", V5.0 says "March 2026". | March 2026 | resolved by V5.0 |
| D-08 | Employer details OK to share | BD metrics (700+ cases, 16→33 Appium tests, product refresh) and client names (HubSpot, Datalily, PandaDoc). | OK, they're on the resume. | **resolved 2026-10-12** (Anderson) |
| D-09 | "TestRails" spelling | V5.0 says "TestRails"; the product is "TestRail". | "TestRail" | open (fix in resume) |
| D-10 | Senior-role tense | V5.0 uses "Serve as a project lead…" in present tense for a role that ended Mar 2026. | Past tense | open (fix in resume) |
| D-11 | Tools not in V5.0 | v1/v2 list Jenkins/Buildkite, Node-RED, Zephyr, Bash/Linux and Raspberry Pi hobbies that V5.0 omits. | Keep CI and tools only if Anderson confirms. Hobbies come from the v2b `known-issues.ts` pending approval. | open |
| D-12 | Projects beyond the resume | Orbit Hop (v1 `/orbithop`), QA Pulse, these portfolio versions, and other side projects. | Anderson will supply details via `docs/content-intake/`. Until then, include only Orbit Hop facts from v1's public pages. **Orbit Hop role resolved 2026-10-23 (Anderson): "I built it."** So the KB may say Anderson built Orbit Hop. Its status and build stack stay "to be confirmed". | open (Orbit Hop role resolved by Anderson 2026-10-24; the other projects are still open) |
| D-13 | Contact form | `src/content/knowledge/faq.md` says there is no contact form yet; the system prompt (`src/lib/prompt.ts`, Contact and links) lists "the contact form on this site" as a way to reach Anderson. Found by P4-12: the injection-04, privacy-01 and privacy-09 replies mention a "contact form" (the last two passed their checks). | Blob never mentions a contact form until Anderson confirms one exists. The contact section (`#contact`) exists and may still be pointed to; email, LinkedIn and GitHub remain the ways to reach him. | resolved (Anderson, 2026-10-24) |
| D-14 | Hero title vs current role | v1 hero (`Home.astro`) says "Senior SQA Engineer with 7 years of experience in manual testing and 3 years in automation testing", while its own Experiences card, V5.0 and the KB say Staff SQA Engineer since March 2026. The "7 years" and "3 years" figures are also new evidence for D-03. Found by P5-07. | Staff SQA Engineer since March 2026. Don't state years of experience (D-03). | open (v1 copy is Anderson's call) |
| D-15 | Finance Forecast vs Paychira | KB project `finance-forecast.md` ("Finance Forecast", status "to be confirmed", developed for Datalily). Branch `feature/projects-section` lists the same description under "Paychira" with status "shipped" and links to a GitHub repo and `paychira.com`. It is unclear whether these are one product, and which name is public. Found by P5-07. | Resolved by Anderson 2026-10-23: Paychira is the current name of Finance Forecast. Use "Paychira"; the KB rename is a P5.5 task. | **resolved 2026-10-23** (Anderson: Paychira is the current name) |

## P5-07 evidence notes (v1 vs KB, 2026-10-23)

Added by P5-07 as evidence only. No row above was resolved or edited.

- **D-03:** v1 hero says "7 years ... manual testing and 3 years in automation testing" (see D-14).
- **D-05:** v1 Contact section shows "Location: Boston, MA". The KB uses "Boston area, MA".
- **D-09:** v1 hero lists "Zephyr / X-Ray / TestRails". The KB says "TestRail".
- **D-11:** v1 hero lists "Jenkins / Buildkite" and "Linux / Bash / Windows". The KB skills file lists none of Jenkins, Buildkite, Zephyr or Linux. v1's hero list does not include Pytest, Cursor or Selenium, which the KB does (Selenium appears in v1's tech icons).
- **D-12:** `feature/projects-section` (unmerged) adds project cards for Paychira, State of Ecosystems 2026, AI Digest, Astro Andy: Orbit Hop and avanegas.com. The KB has no AI Digest or avanegas.com project. On `feat/blob` the Projects section still shows one placeholder card. The branch card lists Orbit Hop tech as Swift / iOS / AI Tools, while the KB keeps the build stack "to be confirmed".
- **D-13:** v1 `Contact.astro` has a live contact form (posts to Formspree via `fetch`, with success and error messages). `faq.md` still says there is no contact form. Under the interim rule Blob does not mention one either way, so `site.md` is silent on it. Status stays open.
