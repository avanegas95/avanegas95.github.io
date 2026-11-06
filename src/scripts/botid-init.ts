// Client half of BotID (SCOPE §6.2): attaches the challenge header to POST /api/chat.
// Docs: https://vercel.com/docs/botid/get-started ("other" frameworks use botid/client/core).
// The challenge script loads lazily, same-origin, through the vercel.json rewrites, so the
// CSP's `script-src 'self'` and `connect-src 'self'` cover it.
import { initBotId } from "botid/client/core";

// checkLevel must equal the server's (src/lib/server/botid.ts):
// https://vercel.com/docs/botid/advanced-configuration
export const BOTID_PROTECT: readonly {
  path: string;
  method: "POST";
  advancedOptions: { checkLevel: "basic" };
}[] = Object.freeze([
  {
    path: "/api/chat",
    method: "POST",
    advancedOptions: { checkLevel: "basic" },
  },
]);

// Skipped under `astro dev`: the rewrites only exist on Vercel, so the challenge script would
// 404 and every chat request would fail. The server check is unaffected (botid itself returns
// "human" in development: https://vercel.com/docs/botid/local-development-behavior).
if (typeof window !== "undefined" && !import.meta.env.DEV) {
  initBotId({ protect: BOTID_PROTECT.map((p) => ({ ...p })) });
}
