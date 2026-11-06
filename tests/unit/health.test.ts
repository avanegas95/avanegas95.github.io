import { describe, expect, it } from "vitest";
import type { APIContext } from "astro";
import { GET, prerender } from "../../src/pages/api/health";

describe("health", () => {
  it("GET returns ok", async () => {
    const res = await Promise.resolve(GET({} as APIContext));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("is an on-demand route", () => {
    expect(prerender).toBe(false);
  });
});
