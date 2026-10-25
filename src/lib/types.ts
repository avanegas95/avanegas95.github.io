export interface NavItem {
  label: string;
  href: string;
  number: string;
  icon?: string;
}

export interface SocialLink {
  href: string;
  icon: string;
  label: string;
}

export interface FooterTech {
  desc: string;
  name: string;
  icon: string;
  alt: string;
}

export type TechnologyKey =
  | "selenium"
  | "appium"
  | "python"
  | "nodejs"
  | "HTML5"
  | "css"
  | "astro"
  | "react"
  | "tailwindcss"
  | "git"
  | "supabase"
  | "vercel"
  | "render"
  | "bash"
  | "claudecode";
