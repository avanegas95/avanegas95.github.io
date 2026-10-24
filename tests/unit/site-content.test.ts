import { beforeEach, describe, expect, it, vi } from "vitest";
import { KB_ROOT, loadKbSources, parseKbSource } from "../../src/lib/kb.ts";

const getCollection = vi.fn();
const getEntry = vi.fn();
vi.mock("astro:content", () => ({ getCollection, getEntry }));

const { getBio, getContact, getPublicProjects, getRoles, getSkillGroups } =
  await import("../../src/lib/site-content.ts");

// Collection-shaped entries built from the real KB through kb.ts (the parity
// test proves kb.ts and the collection loader yield equal data).
const files = loadKbSources(KB_ROOT).map(parseKbSource);
const id = (path: string) =>
  path.replace(/^projects\//, "").replace(/\.md$/, "");
const entry = (path: string) => {
  const f = files.find((x) => x.path === path);
  return f && { id: id(path), data: f.data, body: f.body };
};

const project = (slug: string, order: number, pub: boolean) => ({
  id: slug,
  data: { topic: "project", title: slug, order, public: pub },
  body: "",
});

beforeEach(() => {
  getEntry.mockReset();
  getCollection.mockReset();
  getEntry.mockImplementation(async (_c: string, topic: string) =>
    entry(`${topic}.md`),
  );
});

describe("site-content", () => {
  it("excludes public: false projects and sorts by order", async () => {
    getCollection.mockResolvedValue([
      project("c", 3, true),
      project("hidden", 1, false),
      project("a", 2, true),
    ]);
    const ids = (await getPublicProjects()).map((p) => p.id);
    expect(ids).toEqual(["a", "c"]);
    expect(getCollection).toHaveBeenCalledWith("projects");
  });

  it("roles keep KB order and drop showOnSite: false", async () => {
    const roles = await getRoles();
    expect(roles.map((r) => `${r.company}|${r.title}|${r.start}`)).toEqual([
      "Boston Dynamics|Staff SQA Engineer|2026-03",
      "Boston Dynamics|Senior SQA Engineer|2023-09",
      "SharkNinja|SQA Engineer II|2022-04",
      "SharkNinja|SQA Engineer|2019-11",
    ]);
    expect(roles[0]?.end).toBeNull();
  });

  it("returns skill groups, contact and bio from the KB", async () => {
    const groups = await getSkillGroups();
    expect(groups[0]?.name).toBe("Testing and automation");
    expect(groups.flatMap((g) => g.items)).toContain("TestRail");
    const contact = await getContact();
    expect(contact?.links.linkedin).toBe(
      "https://www.linkedin.com/in/avanegas95",
    );
    expect(contact?.location).toBe("Boston area, MA");
    const bio = await getBio();
    expect(bio?.title).toBe("Anderson Vanegas");
    expect(bio?.body).toContain("### Who he is");
  });

  it("returns nothing for a non-public entry", async () => {
    getEntry.mockImplementation(async (_c: string, topic: string) => {
      const e = entry(`${topic}.md`);
      return e && { ...e, data: { ...e.data, public: false } };
    });
    expect(await getRoles()).toEqual([]);
    expect(await getSkillGroups()).toEqual([]);
    expect(await getContact()).toBeNull();
    expect(await getBio()).toBeNull();
  });
});
