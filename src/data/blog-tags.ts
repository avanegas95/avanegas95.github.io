/**
 * Reference tag list for blog posts. Not enforced at build time —
 * reuse these slugs before inventing new ones.
 */
export const suggestedBlogTags = [
  {
    slug: "qa",
    label: "QA",
    description: "Quality assurance practices and mindset",
  },
  {
    slug: "automation",
    label: "Automation",
    description: "Test automation and tooling",
  },
  {
    slug: "python",
    label: "Python",
    description: "Python scripts, CLIs, and test helpers",
  },
  {
    slug: "ci-cd",
    label: "CI/CD",
    description: "Pipelines, builds, and continuous integration",
  },
  {
    slug: "appium",
    label: "Appium",
    description: "Mobile test automation",
  },
  {
    slug: "photo",
    label: "Photo",
    description: "Photography and editing",
  },
  {
    slug: "video",
    label: "Video",
    description: "Videography and post-production",
  },
  {
    slug: "creative",
    label: "Creative",
    description: "Creative projects and craft",
  },
  {
    slug: "personal",
    label: "Personal",
    description: "Reflections outside of work",
  },
  {
    slug: "life",
    label: "Life",
    description: "Life updates and broader topics",
  },
  {
    slug: "meta",
    label: "Meta",
    description: "Site and blog announcements",
  },
] as const;
