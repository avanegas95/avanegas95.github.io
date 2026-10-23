// Preview-only controls for /dev/blob. Not used on the real homepage.
import { MOODS, type Mood } from "../lib/moods";
import { createBlobMotion, type BlobMotion } from "./blob/motion";

// Only the static stage and grid: the live <blob-agent> drives its own figures.
const figures = Array.from(
  document.querySelectorAll<HTMLElement>(
    "#stage .blob-figure, #grid .blob-figure",
  ),
);
const stageEl = document.querySelector<HTMLElement>("#stage .blob-figure");
const motions: BlobMotion[] = figures.map((f) =>
  createBlobMotion(f, { track: f === stageEl }),
);
const stage = stageEl ? motions[figures.indexOf(stageEl)] : undefined;

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-fire]")) {
  btn.addEventListener("click", () => {
    const m = btn.dataset["fire"];
    if (m && (MOODS as readonly string[]).includes(m)) {
      stage?.setMood(m as Mood);
    }
  });
}

const talking = document.getElementById("talking-toggle");
talking?.addEventListener("click", () => {
  const on = talking.getAttribute("aria-pressed") !== "true";
  talking.setAttribute("aria-pressed", String(on));
  for (const m of motions) m.setTalking(on);
});

addEventListener("pagehide", () => {
  for (const m of motions) m.destroy();
});
