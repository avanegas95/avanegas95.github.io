import placeholder from "../assets/images/placeholder.jpg";
import type { Project } from "../lib/types";

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
    title: "Paychira",
    description:
      "Full-stack sales forecasting SaaS for small agencies: deal pipeline, probability-weighted forecasts, org roles, CSV import, PandaDoc sync, and AI chat on pipeline data.",
    tech: ["React", "FastAPI", "Supabase", "Vercel", "Python"],
    image: cover,
    status: "shipped",
    github: "https://github.com/avanegas95/paychira",
    external: "https://www.paychira.com/dashboard",
    featured: true,
  },
  {
    title: "State of Ecosystems 2026",
    description:
      "Interactive React report for HubSpot’s State of Ecosystems partner study: URL-hash filtering, 17 content variants, JSON-driven copy, WCAG 2.1 AA, and strict performance budgets. Handed off to HubSpot web dev.",
    tech: ["React", "Vite", "HTML", "CSS"],
    image: cover,
    status: "handed-off",
    external: "https://www.hubspot.com/state-of-ecosystems-2026",
    featured: true,
  },
  {
    title: "AI Digest",
    description:
      "Personal weekly AI news briefing: Claude-synthesized summaries, Serper search, automated deploy to Vercel.",
    tech: ["TypeScript", "Vercel", "AI Tools"],
    image: cover,
    status: "private-repo",
    github: "https://github.com/avanegas95/ai-digest",
    external: "https://ai-digest-eight-olive.vercel.app",
    featured: true,
  },
  {
    title: "Astro Andy: Orbit Hop",
    description:
      "One-tap iPhone arcade game",
    tech: ["Swift", "iOS", "AI Tools"],
    image: cover,
    status: "shipped",
    github: "https://github.com/avanegas95/I-Am-Rich",
    external: "https://avanegas.com/orbithop/",
    featured: true,
  },
  {
    title: "avanegas.com",
    description:
      "This site — Astro portfolio with AI Blob, blog, project index, and Orbit Hop support pages.",
    tech: ["Astro", "React", "Tailwind"],
    image: cover,
    status: "shipped",
    github: "https://github.com/avanegas95/avanegas95.github.io",
    external: "https://avanegas.com",
    featured: true,
  }
];
