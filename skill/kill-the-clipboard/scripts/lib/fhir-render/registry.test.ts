// Structural invariants only — these tests must keep passing as family agents replace
// their stubs, so nothing here assumes stub behavior (claims:false) for real families.
import { describe, expect, test } from "bun:test";
import { fallback, partition, registry } from "./registry.ts";

const EXPECTED_KEYS = [
  "patient",
  "problems",
  "medications",
  "allergies",
  "immunizations",
  "vitals",
  "labs",
  "social",
  "procedures",
  "encounters",
  "care-coordination",
  "coverage-devices",
  "documents",
  "family-history",
  "supporting",
  "fallback",
];

describe("registry", () => {
  test("all family modules resolve, in the spec order, fallback last", () => {
    expect(registry.map((f) => f.key)).toEqual(EXPECTED_KEYS);
    expect(registry[registry.length - 1]).toBe(fallback);
  });

  test("every entry satisfies the FamilyRenderer shape with strictly ascending order", () => {
    for (let i = 0; i < registry.length; i++) {
      const f = registry[i]!;
      expect(typeof f.title).toBe("string");
      expect(f.title.length).toBeGreaterThan(0);
      expect(typeof f.claims).toBe("function");
      expect(typeof f.render).toBe("function");
      if (i > 0) expect(f.order).toBeGreaterThan(registry[i - 1]!.order);
    }
  });

  test("fallback claims absolutely anything", () => {
    expect(fallback.claims({ resourceType: "Basic" })).toBe(true);
    expect(fallback.claims({})).toBe(true);
    expect(fallback.claims(null)).toBe(true);
    expect(fallback.claims(42)).toBe(true);
  });

  test("partition: every resource lands in exactly one family; aliens always reach fallback", () => {
    const resources = [
      { resourceType: "TotallyMadeUpType", id: "alien-1" },
      { resourceType: "Basic", id: "alien-2" },
      null,
    ];
    const parts = partition(resources);
    const total = [...parts.values()].reduce((a, l) => a + l.length, 0);
    expect(total).toBe(3);
    const fb = parts.get(fallback) ?? [];
    expect(fb.some((r: any) => r?.id === "alien-1")).toBe(true);
  });

  test("partition treats a throwing claims() as false", () => {
    const bomb = {
      key: "bomb",
      title: "Bomb",
      order: 1,
      claims: () => {
        throw new Error("hostile");
      },
      render: () => [],
    };
    const parts = partition([{ resourceType: "Basic", id: "b1" }], [bomb, fallback]);
    expect(parts.get(fallback)!.length).toBe(1);
    expect(parts.has(bomb)).toBe(false);
  });
});
