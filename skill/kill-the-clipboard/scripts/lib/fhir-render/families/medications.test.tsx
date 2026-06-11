import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import medications from "./medications.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-medications-test-"));
const fixtures = loadFamilyFixtures("medications");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("claims", () => {
  test("true for every medications fixture", () => {
    for (const f of fixtures) expect(medications.claims(f)).toBe(true);
  });
  test("false for Patient, Basic, and junk", () => {
    expect(medications.claims({ resourceType: "Patient" })).toBe(false);
    expect(medications.claims({ resourceType: "Basic" })).toBe(false);
    expect(medications.claims(null)).toBe(false);
    expect(medications.claims(42)).toBe(false);
    expect(medications.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the Medications section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([medications], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));

    const text = await pdfText(out);
    // One identifying string per instance (medication name resolved per fixture quirk).
    expect(text).toContain("lisinopril"); // active-coded CC + completed dispense
    expect(text).toContain("AMOXIL"); // stopped: contained Medication resolved
    expect(text).toContain("GLUCOPHAGE"); // on-hold + in-progress: external Medication fixture resolved
    expect(text).toContain("Magic Mouthwash"); // completed-longsig: text-only CC
    expect(text).toContain("metFORMIN"); // medication-metformin-er folded into referrers

    // Statuses render as badges (uppercase chips).
    for (const s of ["ACTIVE", "STOPPED", "ON-HOLD", "COMPLETED", "IN-PROGRESS"]) expect(text).toContain(s);

    // Structured sig rendered compactly; free-text-only sig rendered verbatim.
    expect(text).toContain("1 tablet");
    expect(text).toContain("twice daily");
    expect(text).toContain("15 mL–30 mL");
    expect(text).toContain("mouth pain"); // asNeededCodeableConcept (phrase may wrap mid-cell)
    expect(text).toContain("three times daily"); // stopped-contained free-text sig
    expect(text).not.toContain("26643006"); // code-only route coding omitted from sig, not shown bare
    expect(text).toContain("3 refills");
    expect(text).toContain("cephalexin"); // statusReason surfaced

    // Dates + requester displays.
    expect(text).toContain("2025-03-15");
    expect(text).toContain("2024-11-02");
    expect(text).toContain("2026-01-20");
    expect(text).toContain("Renderer, MD"); // "Dr. Sample Renderer, MD" wraps in the prescriber column
    expect(text).toContain("Fixture Q."); // Epic-style unresolvable requester rendered from display

    // Dispense table specifics.
    expect(text).toContain("First Fill");
    expect(text).toContain("RF"); // code-only type coding
    expect(text).toContain("2025-03-16"); // whenHandedOver wins over whenPrepared
    expect(text).toContain("Pharmacy"); // performer.actor displays
  });

  test("standalone Medication folds into referrers — no third table when all are referenced", async () => {
    const out = join(dir, "fold.pdf");
    await renderFamiliesToPdf([medications], fixtures, out);
    const text = await pdfText(out);
    expect(text).not.toContain("Medication Records");
    // ...but an unreferenced Medication still gets its own row.
    const orphan = { resourceType: "Medication", id: "med-orphan", code: { text: "orphan-drug 5 mg capsule" } };
    const out2 = join(dir, "orphan.pdf");
    const res2 = await renderFamiliesToPdf([medications], [...fixtures, orphan], out2);
    expect(res2.renderedIds).toContain("med-orphan");
    const text2 = await pdfText(out2);
    expect(text2).toContain("Medication Records");
    expect(text2).toContain("orphan-drug");
  });

  test("requests sort most-recent-first", async () => {
    const out = join(dir, "sort.pdf");
    await renderFamiliesToPdf([medications], fixtures, out);
    const text = await pdfText(out);
    const onHold = text.indexOf("2026-01-20");
    const active = text.indexOf("2025-03-15");
    const stopped = text.indexOf("2024-11-02");
    const longsig = text.indexOf("2024-06-08");
    expect(onHold).toBeGreaterThan(-1);
    expect(onHold).toBeLessThan(active);
    expect(active).toBeLessThan(stopped);
    expect(stopped).toBeLessThan(longsig);
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 rows paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const amped = amplify(fixtures, 120);
    const res = await renderFamiliesToPdf([medications], amped, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    const midPage = await pdfText(out, 3);
    expect(midPage.toUpperCase()).toContain("MEDICATION");
    expect(midPage.toUpperCase()).toContain("DOSE & INSTRUCTIONS");
    const latePage = await pdfText(out, res.pages - 1);
    expect(latePage.toUpperCase()).toContain("MEDICATION");
  }, 120_000);
});

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() =>
      medications.render(
        [
          null,
          42,
          {},
          { resourceType: "X" },
          { resourceType: "MedicationRequest" },
          { resourceType: "MedicationRequest", status: 7, medicationReference: { reference: 12 }, dosageInstruction: "no" },
          { resourceType: "MedicationDispense", quantity: "bad", performer: {} },
          { resourceType: "MedicationStatement", dosage: [{ timing: { repeat: { frequency: "x" } } }] },
          { resourceType: "Medication", code: { coding: [{}] } },
        ],
        summaryTheme,
      ),
    ).not.toThrow();
    expect(() => medications.render(null as any, summaryTheme)).not.toThrow();
  });

  test("a defeated resource degrades to its own row, the rest survive", async () => {
    const hostile = [
      ...fixtures,
      { resourceType: "MedicationRequest", id: "medreq-hostile", medicationCodeableConcept: { coding: [{ code: "999999" }] } },
    ];
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf([medications], hostile, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("medreq-hostile");
    const text = await pdfText(out);
    expect(text).toContain("999999"); // code-only coding renders the bare code
    expect(text).toContain("lisinopril");
  });

  test("claims never throws", () => {
    for (const v of [null, undefined, 42, "x", [], { resourceType: 9 }]) {
      expect(() => medications.claims(v)).not.toThrow();
    }
  });
});
