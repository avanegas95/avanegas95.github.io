import { z } from "astro/zod";
import type { ChatEvent, ErrorBody, ErrorCode } from "../chat-events";
import { MODEL_MOODS } from "../moods";

const errorCode = z.enum([
  "rate_limited",
  "budget",
  "bot",
  "upstream",
  "invalid",
  "unavailable",
]);

export const ChatEventSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("mood"),
    data: z.strictObject({ mood: z.enum(MODEL_MOODS) }),
  }),
  z.strictObject({
    event: z.literal("delta"),
    data: z.strictObject({ text: z.string() }),
  }),
  z.strictObject({ event: z.literal("reset"), data: z.strictObject({}) }),
  z.strictObject({
    event: z.literal("done"),
    data: z.strictObject({ usageBucket: z.enum(["ok", "warm", "hot"]) }),
  }),
  z.strictObject({
    event: z.literal("error"),
    data: z.strictObject({ code: errorCode }),
  }),
]);

export const ErrorBodySchema = z.strictObject({
  error: z.strictObject({ code: errorCode }),
});

// Compile-time guard: the schemas' output types must equal the contract types.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
export const schemaMatchesContract: [
  Equal<z.output<typeof ChatEventSchema>, ChatEvent>,
  Equal<z.output<typeof ErrorBodySchema>, ErrorBody>,
] = [true, true];

// Validates, then frames. JSON.stringify keeps `data:` on a single line.
export function encodeEvent(e: ChatEvent): string {
  const parsed = ChatEventSchema.parse(e);
  return `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
}

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
};

export function errorResponse(
  code: ErrorCode,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ErrorBody = ErrorBodySchema.parse({ error: { code } });
  const fixed = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  // Header names are case-insensitive: drop any extra that collides with a fixed one.
  const headers = new Headers();
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (!(k.toLowerCase() in fixed)) headers.set(k, v);
  }
  for (const [k, v] of Object.entries(fixed)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}
