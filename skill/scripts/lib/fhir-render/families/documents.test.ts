import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import documents from "./documents.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-documents-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("documents");

// Shape the assembler produces (DESIGN §5) — must be claimed and listed compactly,
// its (potentially huge) base64 body never decoded into the output.
const patientSharedDocRef = {
  resourceType: "DocumentReference",
  id: "docref-patient-summary-pdf",
  status: "current",
  type: { coding: [{ system: "http://loinc.org", code: "60591-5", display: "Patient summary Document" }] },
  category: [
    {
      coding: [
        { system: "https://cms.gov/fhir/CodeSystem/patient-shared-category", code: "patient-shared", display: "Patient Shared" },
      ],
    },
  ],
  subject: { reference: "urn:uuid:00000000-b4ea-4d01-9871-000000000001" },
  author: [{ reference: "urn:uuid:00000000-b4ea-4d01-9871-000000000001", display: "Casey Breadth-Tester" }],
  date: "2026-06-10T12:00:00Z",
  content: [{ attachment: { contentType: "application/pdf", data: "A".repeat(80_000) } }],
};

describe("claims", () => {
  test("true for every fixture in the family dir", () => {
    for (const f of fixtures) expect(documents.claims(f)).toBe(true);
  });

  test("true for assembler-built PatientShared DocumentReferences", () => {
    expect(documents.claims(patientSharedDocRef)).toBe(true);
  });

  test("false for Patient, Basic, and junk", () => {
    expect(documents.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(documents.claims({ resourceType: "Basic" })).toBe(false);
    expect(documents.claims(null)).toBe(false);
    expect(documents.claims(42)).toBe(false);
    expect(documents.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in Reports & Notes with key content findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([documents], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "documents", count: fixtures.length }]);

    const text = await pdfText(out);
    const upper = text.toUpperCase();

    // diagnosticreport-note-cardiology: LOINC display, date, interpreter, text excerpt
    expect(text).toContain("Cardiology Note");
    expect(text).toContain("Nov 5, 2024");
    expect(text).toContain("Dr. Sample");
    expect(text).toContain("palpitations");
    expect(upper).toContain("FINAL");

    // diagnosticreport-note-radiology-amended: code.text, period start, display-only
    // result/performer, dual presentedForm (PDF size summary + plain-text impression)
    expect(text).toContain("XR CHEST 2 VW");
    expect(text).toContain("Mar 12, 2025");
    expect(text).toContain("Imaging");
    expect(text).toContain("Finding: Right lower lobe");
    expect(text).toContain("Dr. Fictitious");
    expect(text).toContain("attached document");
    expect(text).toContain("effusion");
    expect(upper).toContain("AMENDED");

    // documentreference-adi-living-will: ADI category slice, patient-authored
    expect(text).toContain("Living will");
    expect(text).toContain("Sep 4, 2025");
    expect(text).toContain("directives");
    expect(text).toContain("(patient-authored)");

    // documentreference-consult-note: unicode title/excerpt, preliminary docStatus,
    // display-only author, coding-only category
    expect(text).toContain("Cardiology consultation");
    expect(text).toContain("présyncope");
    expect(text).toContain("café");
    expect(text).toContain("[Preliminary]");
    expect(text).toContain("Clinical Note");

    // documentreference-discharge-summary-pdf: long description wraps un-truncated,
    // PDF attachment summarized by size
    expect(text).toContain("Discharge Summary");
    expect(text).toContain("Mar 15, 2025");
    expect(text).toContain("community-acquired");
    expect(text).toContain("ceftriaxone");
    expect(text).toContain("contingency");
    expect(text).toContain("1 KB)");

    // documentreference-superseded-minimal: code-only type, text-only category,
    // relatesTo display, decoded short excerpt
    expect(text).toContain("34117-2");
    expect(text).toContain("physical");
    expect(text).toContain("Replaces:");
    expect(text).toContain("corrected version");
    expect(upper).toContain("SUPERSEDED");

    // base64 bodies never reach the page
    expect(text).not.toContain("JVBERi");
    expect(text).not.toContain("UFJPR1JFU1M");
  });

  test("rows sort most-recent-first, undated last", async () => {
    const out = join(dir, "sort.pdf");
    await renderFamiliesToPdf([documents], fixtures, out);
    const text = await pdfText(out);
    const order = [
      "Living will", // 2025-09-04
      "Discharge Summary", // 2025-03-15
      "Progress note", // 2025-03-14
      "XR CHEST 2 VW", // 2025-03-12
      "Cardiology consultation", // 2024-11-05T18:02
      "Cardiology Note", // 2024-11-05T17:30
      "34117-2", // no date — last
    ].map((s) => text.indexOf(s));
    for (const idx of order) expect(idx).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
  });

  test("PatientShared DocRef renders compactly without decoding its payload", async () => {
    const out = join(dir, "patient-shared.pdf");
    const res = await renderFamiliesToPdf([documents], [...fixtures, patientSharedDocRef], out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("docref-patient-summary-pdf");
    const text = await pdfText(out);
    expect(text).toContain("Patient summary");
    expect(text).toContain("Patient Shared");
    const kb = Math.ceil((80_000 * 3) / 4 / 1024);
    expect(text).toContain(`${kb} KB)`);
    expect(text).not.toMatch(/A{20}/);
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("120 instances paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const res = await renderFamiliesToPdf([documents], amplify(fixtures, 120), out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    const page2 = (await pdfText(out, 2)).toUpperCase();
    expect(page2).toContain("CATEGORY");
    expect(page2).toContain("AUTHOR");
    const lastPage = await pdfText(out, res.pages);
    expect(lastPage).toContain(`Page ${res.pages} of ${res.pages}`);
  }, 120_000);
});

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() =>
      documents.render(
        [
          null,
          42,
          {},
          { resourceType: "X" },
          { resourceType: "DocumentReference", type: 7, category: "wat", author: 3, content: "x", relatesTo: {}, date: {} },
          { resourceType: "DiagnosticReport", code: 5, presentedForm: {}, result: "x", effectivePeriod: "z", performer: 1 },
        ],
        summaryTheme,
      ),
    ).not.toThrow();
    expect(() => documents.render(null as any, summaryTheme)).not.toThrow();
    expect(() => documents.render([], summaryTheme)).not.toThrow();
  });

  test("malformed instances still yield rows alongside good ones", async () => {
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf(
      [documents],
      [
        {
          resourceType: "DocumentReference",
          id: "doc-bad",
          type: { coding: "x" },
          content: [{ attachment: { contentType: "text/plain", data: 12345 } }, { attachment: { contentType: "application/pdf" } }],
        },
        { resourceType: "DiagnosticReport", id: "dr-bad", code: {}, presentedForm: [{ data: "!!!notbase64!!!" }] },
        ...fixtures,
      ],
      out,
    );
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("doc-bad");
    expect(res.renderedIds).toContain("dr-bad");
    expect(res.renderedIds.length).toBe(fixtures.length + 2);
  });
});
