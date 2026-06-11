import { describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import labs from "./labs.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-labs-test-"));
const fixtures = loadFamilyFixtures("labs");

describe("claims", () => {
  test("claims every labs fixture", () => {
    for (const f of fixtures) expect(labs.claims(f)).toBe(true);
  });

  test("claims the Epic system-less 'Lab' category quirk on its own", () => {
    expect(labs.claims({ resourceType: "Observation", category: [{ coding: [{ code: "Lab" }], text: "Lab" }] })).toBe(true);
    expect(labs.claims({ resourceType: "DiagnosticReport", category: [{ coding: [{ code: "Lab" }] }] })).toBe(true);
    expect(labs.claims({ resourceType: "Observation", category: [{ text: "clinical-test" }] })).toBe(true);
  });

  test("rejects out-of-scope resources without throwing", () => {
    expect(labs.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(labs.claims({ resourceType: "Basic" })).toBe(false);
    expect(labs.claims({ resourceType: "Observation", category: [{ coding: [{ code: "vital-signs" }] }] })).toBe(false);
    expect(labs.claims({ resourceType: "Observation" })).toBe(false);
    expect(labs.claims({ resourceType: "DiagnosticReport", category: [{ coding: [{ code: "RAD" }] }] })).toBe(false);
    expect(labs.claims(null)).toBe(false);
    expect(labs.claims(42)).toBe(false);
    expect(labs.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the labs section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([labs], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "labs", count: fixtures.length }]);

    const text = await pdfText(out);
    // diagnosticreport-cbc-panel: group header, contained-org performer, display-only result, conclusion
    expect(text).toContain("Blood Count");
    expect(text).toContain("Breadth Test"); // performer (cell-wrapped, so not the full org name)
    expect(text).toContain("Platelet count");
    expect(text).toContain("Mild anemia");
    // diagnosticreport-urinalysis: PRELIM badge + effectivePeriod date
    expect(text).toContain("Urinalysis");
    expect(text).toContain("PRELIM");
    expect(text).toContain("2025-09-02");
    // observation-hemoglobin-low: value, reference range, LOW flag
    expect(text).toContain("Hemoglobin");
    expect(text).toContain("10.8 g/dL");
    expect(text).toContain("12.0 - 15.5 g/dL");
    expect(text).toContain("LOW");
    // observation-potassium-high: value, range from low/high quantities, HIGH flag, status
    expect(text).toContain("Potassium");
    expect(text).toContain("5.9 mmol/L");
    expect(text).toContain("3.5 mmol/L");
    expect(text).toContain("HIGH");
    expect(text).toContain("preliminary");
    // observation-ana-titer: valueRatio as 1:160, text-only range + interpretation
    expect(text).toContain("ANA Titer");
    expect(text).toContain("1:160");
    expect(text).toContain("< 1:80");
    expect(text).toContain("POSITIVE");
    // observation-blood-type: valueCodeableConcept
    expect(text).toContain("Blood Type");
    expect(text).toContain("A Positive");
    // observation-clinical-ef (imaging clinical result): valueQuantity %
    expect(text).toContain("Ejection Fraction");
    expect(text).toContain("55 %");
    // observation-hba1c-cancelled: dataAbsentReason text, no value
    expect(text).toContain("Hemoglobin A1c");
    expect(text).toContain("cancelled");
    expect(text).toContain("hemolyzed");
    // observation-urine-color: valueString + long unicode note survives
    expect(text).toContain("Urine Color");
    expect(text).toContain("Dark amber");
    // observation-urine-dipstick: component rows incl. text-only CC, valueString, component DAR
    expect(text).toContain("Glucose, Urine");
    expect(text).toContain("100 mg/dL");
    expect(text).toContain("2+");
    expect(text).toContain("Trace");
    expect(text).toContain("Reagent pad"); // component dataAbsentReason (wraps mid-phrase)
    expect(text).toContain("corrected");
    // observation-urine-nitrite: valueBoolean true never prints bare "true"
    expect(text).toContain("Nitrite");
    expect(text).not.toMatch(/\btrue\b/);
    // specimens folded compactly with accessions and collection details
    expect(text).toContain("Venous blood");
    expect(text).toContain("ACC-77-1234");
    expect(text).toContain("ACC-77-5678");
    expect(text).toContain("Venipuncture");
    expect(text).toContain("median cubital vein");
    expect(text).toContain("Clean catch, midstream");
    expect(text).toContain("EDTA tube");
  });

  test("report groups own each member Observation exactly once", async () => {
    const out = join(dir, "grouping.pdf");
    await renderFamiliesToPdf([labs], fixtures, out);
    const text = await pdfText(out);
    expect((text.match(/Dark amber/g) ?? []).length).toBe(1);
    expect((text.match(/1:160/g) ?? []).length).toBe(1);
  });
});

test.skipIf(!RENDER)("volume: 500 rows paginate with repeating headers, nothing dropped", async () => {
  const out = join(dir, "volume.pdf");
  const res = await renderFamiliesToPdf([labs], amplify(fixtures, 120), out);
  expect(res.fallbackCount).toBe(0);
  expect(res.renderedIds.length).toBe(120);
  expect(new Set(res.renderedIds).size).toBe(120);
  expect(res.pages).toBeGreaterThan(2);
  for (const p of [2, Math.floor(res.pages / 2), res.pages - 1]) {
    const pg = await pdfText(out, p);
    expect(pg).toMatch(/TEST|SPECIMEN/);
    expect(pg).toMatch(/RESULT|COLLECTED/);
  }
}, 120_000);

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() => labs.render([null, 42, {}, { resourceType: "X" }], summaryTheme)).not.toThrow();
    expect(() => labs.render(null as any, summaryTheme)).not.toThrow();
    expect(() => labs.render([], summaryTheme)).not.toThrow();
  });

  test("malformed lab resources degrade to a row, never sink the section", async () => {
    const hostile = [
      { resourceType: "Observation", id: "obs-codeonly", category: [{ coding: [{ code: "Lab" }] }], code: { coding: [{ code: "12345-6" }] }, valueQuantity: { value: 7 } },
      { resourceType: "Observation", id: "obs-textcc", category: [{ text: "laboratory" }], code: { text: "Mystery test" }, valueCodeableConcept: { text: "indeterminate" }, interpretation: [{ text: "Equivocal" }] },
      { resourceType: "Observation", id: "obs-empty", category: [{ coding: [{ code: "laboratory" }] }] },
      { resourceType: "DiagnosticReport", id: "dr-bare", category: [{ text: "Lab" }], result: [{ display: "Result on paper" }, {}] },
      { resourceType: "Specimen", id: "spec-bare" },
      { resourceType: "Specimen", id: "spec-weird", type: 9, collection: "nope", identifier: "x" },
    ];
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf([labs], hostile, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(hostile.map((r) => r.id)));
    const text = await pdfText(out);
    expect(text).toContain("12345-6");
    expect(text).toContain("Mystery test");
    expect(text).toContain("indeterminate");
    expect(text).toContain("Result on paper");
  });
});
