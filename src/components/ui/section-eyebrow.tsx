import type { FC, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";

interface SectionEyebrowProps {
  children: ReactNode;
  className?: string;
}

export const SectionEyebrow: FC<SectionEyebrowProps> = ({
  children,
  className,
}) => (
  <AnimatedShinyText
    shimmerWidth={140}
    className={cn(
      "mx-0 block max-w-none font-mono text-base md:text-lg text-[var(--sec)]",
      className,
    )}
  >
    {children}
  </AnimatedShinyText>
);
