import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import allergies from "./allergies.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-allergies-test-"));
const fixtures = loadFamilyFixtures("allergies");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("claims", () => {
  test("claims every fixture, rejects other types and junk", () => {
    for (const f of fixtures) expect(allergies.claims(f)).toBe(true);
    expect(allergies.claims({ resourceType: "Patient" })).toBe(false);
    expect(allergies.claims({ resourceType: "Basic" })).toBe(false);
    expect(allergies.claims(null)).toBe(false);
    expect(allergies.claims(42)).toBe(false);
    expect(allergies.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the Allergies section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([allergies], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    const text = await pdfText(out);

    expect(text.toUpperCase()).toContain("ALLERGIES");

    // penicillin-active-high: substance, 3 manifestations, severity, criticality badge, recorded
    expect(text).toContain("Penicillin");
    expect(text).toContain("Anaphylaxis");
    expect(text).toContain("Hives");
    expect(text).toContain("Shortness of breath");
    expect(text).toContain("Severe");
    expect(text).toContain("HIGH");
    expect(text).toContain("2024-03-15");

    // peanut-active-low: onsetAge, lastOccurrence, LOW badge, recorder display
    expect(text).toContain("Peanut allergy");
    expect(text).toContain("age 4");
    expect(text).toContain("2025-07-04");
    expect(text).toContain("LOW");
    // Recorder display lands in the RECORDED column. pdftotext reads in visual line
    // order, so a name wrapped inside a narrow column gets other columns' text
    // interleaved between its halves ("Dr. Sample <other cell text> Renderer") at a
    // wrap point that varies with font-store warm-up — assert the halves, not the phrase.
    expect(text).toContain("Dr. Sample");
    expect(text).toContain("Renderer");

    // latex: code-only coding degrades to system+code; unable-to-assess badge
    expect(text).toContain("SNOMED 111088007");
    expect(text.toUpperCase()).toContain("UNABLE");
    expect(text).toContain("itchy hands");

    // egg-resolved: text-over-display preference, onsetString, resolved status
    expect(text).toContain("Egg allergy (childhood,"); // code.text preferred over coding display; wraps mid-cell
    expect(text).toContain("onset childhood");
    expect(text).toContain("Resolved");
    expect(text).toContain("Eczema flare");

    // shellfish-refuted: verificationStatus free-text elaboration wins over coding display
    expect(text).toContain("Shellfish allergy");
    expect(text).toContain("Refuted by oral"); // free-text wraps inside the narrow status column
    expect(text).toContain("food challenge");

    // sulfa-entered-in-error: no clinicalStatus, text-only code
    expect(text).toContain("Sulfa antibiotics");
    expect(text).toContain("Entered in Error");

    // no-known-allergies: statement line, not a substance row
    expect(text).toContain("No Known Allergies");
    expect(text).toContain("Sample Intake Nurse, RN");
  });

  test("most-recent-first: 2025-recorded rows precede 2024-recorded rows", async () => {
    const out = join(dir, "order.pdf");
    await renderFamiliesToPdf([allergies], fixtures, out);
    const text = await pdfText(out);
    expect(text.indexOf("Sulfa antibiotics")).toBeLessThan(text.indexOf("Shellfish allergy"));
    expect(text.indexOf("Shellfish allergy")).toBeLessThan(text.indexOf("Egg allergy"));
    expect(text.indexOf("Egg allergy")).toBeLessThan(text.indexOf("Peanut allergy"));
  });

  test("no-known-allergies alone renders a statement, not an empty table", async () => {
    const nka = fixtures.find((f) => f.id === "allergyintolerance-no-known-allergies");
    const out = join(dir, "nka.pdf");
    const res = await renderFamiliesToPdf([allergies], [nka], out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toEqual(["allergyintolerance-no-known-allergies"]);
    const text = await pdfText(out);
    expect(text).toContain("No Known Allergies");
    expect(text.toUpperCase()).not.toContain("SUBSTANCE");
    expect(text.toUpperCase()).not.toContain("CRITICALITY");
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 rows paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const res = await renderFamiliesToPdf([allergies], amplify(fixtures, 120), out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    const mid = Math.ceil(res.pages / 2);
    for (const p of [2, mid, res.pages]) {
      const pageText = (await pdfText(out, p)).toUpperCase();
      expect(pageText).toContain("SUBSTANCE");
      expect(pageText).toContain("REACTION");
      expect(pageText).toContain("STATUS");
    }
  }, 180_000);
});

describe("hostile", () => {
  test("render never throws on junk", () => {
    expect(() =>
      allergies.render([null, 42, {}, { resourceType: "X" }, { resourceType: "AllergyIntolerance" }], summaryTheme),
    ).not.toThrow();
    expect(() => allergies.render(null as any, summaryTheme)).not.toThrow();
    expect(() => allergies.render([], summaryTheme)).not.toThrow();
  });

  test("one malformed instance degrades to a row without sinking the section", async () => {
    const poison = {
      resourceType: "AllergyIntolerance",
      id: "allergy-poison",
      code: { coding: 17, text: { not: "a string" } },
      reaction: "wat",
      clinicalStatus: [],
      recordedDate: { bad: true },
      criticality: { weird: 1 },
    };
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf([allergies], [...fixtures, poison], out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("allergy-poison");
    const text = await pdfText(out);
    expect(text).toContain("Penicillin");
  });
});
