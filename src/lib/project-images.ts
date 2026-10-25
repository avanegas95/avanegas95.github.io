// Project art (cover and gallery) from src/assets/images/projects/<slug>/<file>.
// astro:assets processes these, so pages get AVIF/WebP with explicit dimensions.
import type { ImageMetadata } from "astro";

const modules = import.meta.glob<{ default: ImageMetadata }>(
  "/src/assets/images/projects/*/*.{avif,gif,jpeg,jpg,png,webp}",
  { eager: true },
);

/** The image for `file` in a project's folder, or undefined when it is not there. */
export function projectImage(
  slug: string,
  file: string,
): ImageMetadata | undefined {
  return modules[`/src/assets/images/projects/${slug}/${file}`]?.default;
}
