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
| D-06 | Old public resume PDF | `public/Anderson_Vanegas_Resume.pdf` on v1 and v2a is stale (2025, Senior title) **and exposes a phone number**. | v3 serves a new PDF exported from V5.0 without address and phone. Anderson supplies it. | open |
| D-07 | Staff role start | v1 says "2026", V5.0 says "March 2026". | March 2026 | resolved by V5.0 |
| D-08 | Employer details OK to share | BD metrics (700+ cases, 16→33 Appium tests, product refresh) and client names (HubSpot, Datalily, PandaDoc). | OK, they're on the resume. | **resolved 2026-10-12** (Anderson) |
| D-09 | "TestRails" spelling | V5.0 says "TestRails"; the product is "TestRail". | "TestRail" | open (fix in resume) |
| D-10 | Senior-role tense | V5.0 uses "Serve as a project lead…" in present tense for a role that ended Mar 2026. | Past tense | open (fix in resume) |
| D-11 | Tools not in V5.0 | v1/v2 list Jenkins/Buildkite, Node-RED, Zephyr, Bash/Linux and Raspberry Pi hobbies that V5.0 omits. | Keep CI and tools only if Anderson confirms. Hobbies come from the v2b `known-issues.ts` pending approval. | open |
| D-12 | Projects beyond the resume | Orbit Hop (v1 `/orbithop`), QA Pulse, these portfolio versions, and other side projects. | Anderson will supply details via `docs/content-intake/`. Until then, include only Orbit Hop facts from v1's public pages. **Orbit Hop role resolved 2026-10-23 (Anderson): "I built it."** So the KB may say Anderson built Orbit Hop. Its status and build stack stay "to be confirmed". | open (Orbit Hop role resolved 2026-10-23; the other projects are still open) |
| D-13 | Contact form | `src/content/knowledge/faq.md` says there is no contact form yet; the system prompt (`src/lib/prompt.ts`, Contact and links) lists "the contact form on this site" as a way to reach Anderson. Found by P4-12: the injection-04, privacy-01 and privacy-09 replies mention a "contact form" (the last two passed their checks). | Blob never mentions a contact form until Anderson confirms one exists. The contact section (`#contact`) exists and may still be pointed to; email, LinkedIn and GitHub remain the ways to reach him. | open |
