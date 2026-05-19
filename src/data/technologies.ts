import type { TechnologyKey } from "@/lib/types";

export const technologies: TechnologyKey[] = [
  "selenium",
  "appium",
  "python",
  "nodejs",
  "HTML5",
  "css",
  "astro",
  "react",
  "tailwindcss",
  "git",
  "supabase",
  "vercel",
  "render",
  "bash",
];

export const techDisplayNames: Record<TechnologyKey, string> = {
  selenium: "Selenium",
  appium: "Appium",
  python: "Python",
  nodejs: "Node.js",
  HTML5: "HTML5",
  css: "CSS",
  astro: "Astro",
  react: "React",
  tailwindcss: "Tailwind",
  git: "Git",
  supabase: "Supabase",
  vercel: "Vercel",
  render: "Render",
  bash: "Bash",
};

export const techUrls: Record<TechnologyKey, string> = {
  python: "https://www.python.org",
  selenium: "https://www.selenium.dev",
  appium: "https://appium.io",
  nodejs: "https://nodejs.org",
  HTML5: "https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/HTML5",
  css: "https://developer.mozilla.org/en-US/docs/Web/CSS",
  astro: "https://astro.build",
  react: "https://react.dev",
  tailwindcss: "https://tailwindcss.com",
  git: "https://git-scm.com",
  supabase: "https://supabase.com",
  vercel: "https://vercel.com",
  render: "https://render.com",
  bash: "https://www.gnu.org/software/bash",
};
