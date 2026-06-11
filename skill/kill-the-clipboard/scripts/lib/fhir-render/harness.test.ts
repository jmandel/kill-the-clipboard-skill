import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FamilyRenderer } from "./types.ts";
import { para } from "./engine.ts";
import { amplify, countPages, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "./harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-harness-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!RENDER)("loadFamilyFixtures", () => {
  test("reads instances, excludes coverage.json, errors on unknown dir", () => {
    const labs = loadFamilyFixtures("labs");
    expect(labs.length).toBeGreaterThanOrEqual(3);
    for (const r of labs) expect(typeof r.resourceType).toBe("string");
    expect(labs.some((r) => r.family === "labs" && r.uscoreVersion)).toBe(false);
    expect(() => loadFamilyFixtures("no-such-family")).toThrow("fixture directory not found");
  });
});

describe.skipIf(!RENDER)("renderFamiliesToPdf", () => {
  test("round-trip: 3 corpus instances all render with findable text and complete renderedIds", async () => {
    const picks = [
      loadFamilyFixtures("problems").find((r) => r.id === "condition-hypertension-active"),
      loadFamilyFixtures("vitals").find((r) => r.id === "observation-bp"),
      loadFamilyFixtures("immunizations")[0],
    ];
    for (const p of picks) expect(p).toBeDefined();

    const out = join(dir, "roundtrip.pdf");
    const res = await renderFamiliesToPdf([], picks, out, {
      title: "Harness Round-Trip",
      meta: [{ label: "Patient", value: "Casey Breadth-Tester" }],
      callout: { title: "How this document was shared", body: ["Shared by the patient via SMART Health Link."] },
    });

    expect(new Set(res.renderedIds)).toEqual(new Set(picks.map((p) => String(p.id))));
    expect(res.pages).toBeGreaterThanOrEqual(1);
    const text = await pdfText(out);
    expect(text).toContain("Harness Round-Trip");
    // callout/section titles render with textTransform:uppercase
    expect(text.toUpperCase()).toContain("HOW THIS DOCUMENT WAS SHARED");
    for (const p of picks) expect(text).toContain(String(p.id)); // fallback prints instance ids
    expect(text).toContain("Shared by the patient via SMART Health Link"); // provenance footer
  });

  test("a family whose render() throws forfeits its resources to fallback — completeness survives", async () => {
    const bomb: FamilyRenderer = {
      key: "bomb",
      title: "Bomb Section",
      order: 1,
      claims: (r) => r?.resourceType === "Condition",
      render: () => {
        throw new Error("family exploded");
      },
    };
    const ok: FamilyRenderer = {
      key: "ok",
      title: "OK Section",
      order: 2,
      claims: (r) => r?.resourceType === "Immunization",
      render: (resources, t) => [para(t, `rendered ${resources.length} immunization(s) fine`)],
    };
    const condition = loadFamilyFixtures("problems").find((r) => r.id === "condition-hypertension-active");
    const imm = loadFamilyFixtures("immunizations")[0];

    const out = join(dir, "bomb.pdf");
    const res = await renderFamiliesToPdf([bomb, ok], [condition, imm], out);

    expect(new Set(res.renderedIds)).toEqual(new Set([String(condition.id), String(imm.id)]));
    expect(res.fallbackCount).toBe(1);
    expect(res.sections).toEqual([
      { key: "ok", count: 1 },
      { key: "fallback", count: 1 },
    ]);
    const text = await pdfText(out);
    expect(text).toContain("rendered 1 immunization(s) fine");
    expect(text).toContain("condition-hypertension-active");
    expect(text.toUpperCase()).not.toContain("BOMB SECTION");
  });

  test(
    "countPages agrees with multi-page output",
    async () => {
      const out = join(dir, "volume.pdf");
      const labsObs = loadFamilyFixtures("labs").filter((r) => r.resourceType === "Observation");
      const res = await renderFamiliesToPdf([], amplify(labsObs, 40), out);
      expect(res.fallbackCount).toBe(40);
      expect(res.pages).toBeGreaterThan(2);
      expect(await countPages(out)).toBe(res.pages);
      // last page still extractable at exactly the reported count
      expect((await pdfText(out, res.pages)).length).toBeGreaterThan(0);
    },
    60_000,
  );
});

describe.skipIf(!RENDER)("amplify", () => {
  test("produces exactly n resources with n unique ids and synthetic date spread", () => {
    const labsObs = loadFamilyFixtures("labs").filter((r) => r.resourceType === "Observation");
    const seed = labsObs.slice(0, 3);
    const amp = amplify(seed, 50);
    expect(amp.length).toBe(50);
    expect(new Set(amp.map((r) => r.id)).size).toBe(50);
    const dates = new Set(
      amp.map((r) => r.effectiveDateTime ?? r.issued ?? r.authoredOn ?? r.date).filter(Boolean),
    );
    expect(dates.size).toBeGreaterThan(20);
    // originals come through untouched
    for (const s of seed) expect(amp.some((r) => r.id === s.id)).toBe(true);
  });

  test("truncates when n < input, tolerates empty input", () => {
    const seed = loadFamilyFixtures("vitals").slice(0, 5);
    expect(amplify(seed, 2).length).toBe(2);
    expect(amplify([], 10)).toEqual([]);
  });
});
