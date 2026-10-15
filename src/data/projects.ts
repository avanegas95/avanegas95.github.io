import placeholder from "@/assets/images/placeholder.jpg";
import type { Project } from "@/lib/types";

/** Shared cover until per-project art is added. */
const cover = placeholder;

export const projectStatusLabels: Record<Project["status"], string> = {
  shipped: "Live",
  "handed-off": "Handed off",
  "in-development": "In development",
  internal: "Case study · WIP",
  "private-repo": "Private repo",
};

export const projects: Project[] = [
  {
    title: "State of Ecosystems 2026",
    description:
      "Interactive React report for HubSpot’s State of Ecosystems partner study: URL-hash filtering, 17 content variants, JSON-driven copy, WCAG 2.1 AA, and strict performance budgets. Handed off to HubSpot web dev.",
    tech: ["React", "Vite", "TypeScript", "Tailwind"],
    image: cover,
    status: "handed-off",
    external:
      "https://www.hubspot.com/state-of-ecosystems-2026?wfuid=2b5046b038.1776051442&wfsid=1781122707-a002-9b78-cb41b2b945cd",
    featured: true,
  },
  {
    title: "Finance Forecast",
    description:
      "Full-stack sales forecasting SaaS for small agencies (paychira): deal pipeline, probability-weighted forecasts, org roles, CSV import, PandaDoc sync, and AI chat on pipeline data.",
    tech: ["React", "FastAPI", "Supabase", "Vercel", "Render"],
    image: cover,
    status: "shipped",
    github: "https://github.com/avanegas95/paychira",
    external: "https://datalily-finance-app.vercel.app",
    featured: true,
  },
  {
    title: "AI Digest",
    description:
      "Personal weekly AI news briefing: Claude-synthesized summaries, Serper search, automated deploy to Vercel.",
    tech: ["TypeScript", "Vercel", "AI"],
    image: cover,
    status: "private-repo",
    github: "https://github.com/avanegas95/ai-digest",
    external: "https://ai-digest-eight-olive.vercel.app",
    featured: true,
  },
  {
    title: "avanegas.com",
    description:
      "This site — Astro portfolio with blog, project index, and Orbit Hop support pages.",
    tech: ["Astro", "React", "Tailwind"],
    image: cover,
    status: "shipped",
    github: "https://github.com/avanegas95/avanegas95.github.io",
    external: "https://avanegas.com",
    featured: true,
  },
  {
    title: "Astro Andy: Orbit Hop",
    description:
      "One-tap iPhone arcade game — support and product info on this domain.",
    tech: ["Swift", "iOS"],
    image: cover,
    status: "shipped",
    github: "https://github.com/avanegas95/I-Am-Rich",
    external: "https://avanegas.com/orbithop/",
    featured: true,
  },
];
