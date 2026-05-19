export interface FadeInObserverOptions {
  threshold?: number;
  rootMargin?: string;
  delayMultiplier?: number;
}

export function initFadeInObserver(options: FadeInObserverOptions = {}): void {
  const {
    threshold = 0.05,
    rootMargin = "100px",
    delayMultiplier = 0.05,
  } = options;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    },
    { threshold, rootMargin },
  );

  function observeFadeElements() {
    const fadeElements = document.querySelectorAll(".fade-in:not(.visible)");
    fadeElements.forEach((element, index) => {
      (element as HTMLElement).style.transitionDelay =
        `${index * delayMultiplier}s`;
      observer.observe(element);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeFadeElements, {
      once: true,
    });
  } else {
    observeFadeElements();
  }

  document.addEventListener("astro:page-load", observeFadeElements);
}
