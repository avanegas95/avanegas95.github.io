// Client-safe SSE contract types (types only; nothing imported at runtime).
// Runtime validation lives in the server SSE module.
import type { ModelMood } from "./moods";

export type ErrorCode =
  "rate_limited" | "budget" | "bot" | "upstream" | "invalid" | "unavailable";

export type UsageBucket = "ok" | "warm" | "hot";

export type ChatEvent =
  | { event: "mood"; data: { mood: ModelMood } }
  | { event: "delta"; data: { text: string } }
  | { event: "reset"; data: Record<string, never> }
  | { event: "done"; data: { usageBucket: UsageBucket } }
  | { event: "error"; data: { code: ErrorCode } };

// Non-2xx JSON bodies returned before the stream starts.
export type ErrorBody = { error: { code: ErrorCode } };
