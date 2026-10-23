// Shared by server AND client (CLAUDE.md rule 9). No imports, no zod: island budget.
export const MOODS = [
  "idle",
  "listening",
  "thinking",
  "happy",
  "excited",
  "proud",
  "curious",
  "confused",
  "sleepy",
  "error",
] as const;
export type Mood = (typeof MOODS)[number];

// The moods the model may pick (SCOPE §4.2); the client owns the rest.
export const MODEL_MOODS = [
  "happy",
  "excited",
  "proud",
  "curious",
  "confused",
] as const;
export type ModelMood = (typeof MODEL_MOODS)[number];

export const DEFAULT_MOOD: ModelMood = "happy";

export function isModelMood(v: string): v is ModelMood {
  return (MODEL_MOODS as readonly string[]).includes(v);
}
