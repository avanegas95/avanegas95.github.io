import type { APIRoute } from "astro";
import { createChatHandler } from "../../lib/server/chat-handler.ts";
import { prodDeps } from "../../lib/server/deps.ts";

export const prerender = false;

export const POST: APIRoute = createChatHandler(prodDeps);

// Any other method is answered by the same handler, whose first check returns 405.
export const ALL: APIRoute = POST;
