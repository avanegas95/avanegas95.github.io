import { describe, expect, it } from "vitest";
import {
  checkShotMarkers,
  parseShotMarker,
  splitHtmlAtShots,
  stripShotMarkers,
} from "../../src/lib/project-shots.ts";

const GALLERY = ["a.png", "b.png", "c.png"];

describe("parseShotMarker", () => {
  it("reads one file with the default full layout", () => {
    expect(parseShotMarker("::shot[a.png]")).toEqual({
      files: ["a.png"],
      layout: "full",
    });
  });

  it("reads left, right and pair layouts", () => {
    expect(parseShotMarker("::shot[a.png]{left}")?.layout).toBe("left");
    expect(parseShotMarker("::shot[a.png]{right}")?.layout).toBe("right");
    expect(parseShotMarker("::shot[a.png b.png]{pair}")).toEqual({
      files: ["a.png", "b.png"],
      layout: "pair",
    });
  });

  it("tolerates surrounding spaces", () => {
    expect(parseShotMarker("  ::shot[ a.png ]{right}  ")?.files).toEqual([
      "a.png",
    ]);
  });

  it("returns null for ordinary text", () => {
    expect(parseShotMarker("A paragraph about ::shot[a.png]")).toBeNull();
    expect(parseShotMarker("")).toBeNull();
  });
});

describe("checkShotMarkers", () => {
  const ok = (body: string) => checkShotMarkers(body, GALLERY);

  it("accepts markers on their own paragraph that name gallery files", () => {
    expect(
      ok("Intro.\n\n::shot[a.png]\n\nMore.\n\n::shot[b.png c.png]{pair}"),
    ).toEqual([]);
  });

  it("rejects a file that is not in the gallery", () => {
    expect(ok("::shot[nope.png]")[0]).toMatch(/not in gallery: nope\.png/);
  });

  it("rejects an unknown layout", () => {
    expect(ok("::shot[a.png]{center}")[0]).toMatch(/unknown layout/);
  });

  it("needs exactly two files for pair and one otherwise", () => {
    expect(ok("::shot[a.png]{pair}")[0]).toMatch(/exactly 2/);
    expect(ok("::shot[a.png b.png]")[0]).toMatch(/exactly 1/);
  });

  it("rejects a malformed marker instead of showing it as text", () => {
    expect(ok("::shot a.png")[0]).toMatch(/malformed/);
    expect(ok("::shot[a.png")[0]).toMatch(/malformed/);
  });

  it("needs a blank line before and after the marker", () => {
    expect(ok("Text\n::shot[a.png]\n\nMore")[0]).toMatch(/blank line/);
    expect(ok("Text\n\n::shot[a.png]\nMore")[0]).toMatch(/blank line/);
  });

  it("ignores markers inside code fences", () => {
    expect(ok("```\n::shot[nope.png]\n```")).toEqual([]);
  });

  it("reports line numbers", () => {
    expect(ok("One\n\n::shot[x.png]")[0]).toMatch(/^line 3:/);
  });
});

describe("stripShotMarkers", () => {
  it("removes marker paragraphs and leaves the prose byte-identical", () => {
    const prose = "### What it does\n\nIntro.\n\nMore.";
    const withShots =
      "### What it does\n\n::shot[a.png]\n\nIntro.\n\n::shot[b.png]{right}\n\nMore.\n\n::shot[a.png b.png]{pair}";
    expect(stripShotMarkers(withShots)).toBe(prose);
    expect(stripShotMarkers(prose)).toBe(prose);
  });

  it("keeps markers inside code fences", () => {
    const fenced = "```\n::shot[a.png]\n```";
    expect(stripShotMarkers(fenced)).toBe(fenced);
  });
});

describe("splitHtmlAtShots", () => {
  it("splits rendered HTML into prose and shot segments in order", () => {
    const html =
      "<h3>What</h3>\n<p>::shot[a.png]{right}</p>\n<p>Intro.</p>\n<p>::shot[b.png c.png]{pair}</p>";
    expect(splitHtmlAtShots(html)).toEqual([
      { kind: "html", html: "<h3>What</h3>\n" },
      { kind: "shot", files: ["a.png"], layout: "right" },
      { kind: "html", html: "\n<p>Intro.</p>\n" },
      { kind: "shot", files: ["b.png", "c.png"], layout: "pair" },
    ]);
  });

  it("returns the HTML as one segment when there are no markers", () => {
    expect(splitHtmlAtShots("<p>Hi</p>")).toEqual([
      { kind: "html", html: "<p>Hi</p>" },
    ]);
  });

  it("leaves a marker inside a code block alone", () => {
    const html = "<pre><code>::shot[a.png]\n</code></pre>";
    expect(splitHtmlAtShots(html)).toEqual([{ kind: "html", html }]);
  });
});
