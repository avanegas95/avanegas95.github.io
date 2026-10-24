// Focus helpers for the chat panel's modal behaviour.
const CANDIDATES =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(
    (el) => {
      if (el.matches(":disabled") || el.closest("[hidden]")) return false;
      if (el instanceof HTMLInputElement && el.type === "hidden") return false;
      return el.getAttribute("tabindex") !== "-1";
    },
  );
}

// Keeps Tab / Shift+Tab inside `root`: wraps at both ends and pulls stray focus back in.
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = focusables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
