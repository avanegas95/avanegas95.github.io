import type { ImageMetadata } from "astro";

export interface NavItem {
  label: string;
  href: string;
  number: string;
  icon?: string;
}

export interface Project {
  title: string;
  description: string;
  tech: string[];
  image: ImageMetadata;
  github: string;
  external: string;
  featured: boolean;
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
  | "bash";
