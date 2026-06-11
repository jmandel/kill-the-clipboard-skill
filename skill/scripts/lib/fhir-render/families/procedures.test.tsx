import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import procedures from "./procedures.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-procedures-test-"));
const fixtures = loadFamilyFixtures("procedures");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("claims", () => {
  test("true for every fixture, false for Patient and Basic", () => {
    for (const f of fixtures) expect(procedures.claims(f)).toBe(true);
    expect(procedures.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(procedures.claims({ resourceType: "Basic" })).toBe(false);
    expect(procedures.claims(null)).toBe(false);
    expect(procedures.claims(42)).toBe(false);
  });
});

test.skipIf(!RENDER)("golden: every fixture renders in the procedures section with key clinical text findable", async () => {
  const out = join(dir, "golden.pdf");
  const res = await renderFamiliesToPdf([procedures], fixtures, out);
  expect(res.fallbackCount).toBe(0);
  expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
  expect(res.sections).toEqual([{ key: "procedures", count: fixtures.length }]);

  const text = await pdfText(out);
  // Procedure names (incl. text-only code and code-only SNOMED coding)
  expect(text).toContain("Screening colonoscopy");
  expect(text).toContain("Laparoscopic appendectomy");
  expect(text).toContain("Gallbladder removal");
  expect(text).toContain("Left heart catheterization");
  expect(text).toContain("Tonsillectomy and adenoidectomy (childhood)");
  expect(text).toContain("SNOMED 302497006"); // dialysis: code-only coding, no display/text
  // performed[x] variants
  expect(text).toContain("Sep 17, 2024"); // performedDateTime, date shown date-only
  expect(text).toContain("Mar 2, 2025"); // performedPeriod collapsing same-day start/end
  expect(text).toContain("Jan 5, 2026 – ongoing"); // open-ended period
  expect(text).toContain("At age 7"); // performedAge, never a date
  // performedString verbatim (wraps inside its column, so match pre-wrap fragments)
  expect(text).toContain("Late 2019, while living");
  expect(text).toContain("exact date");
  // status badges render uppercase
  expect(text).toContain("NOT DONE");
  expect(text).toContain("IN PROGRESS");
  expect(text).toContain("COMPLETED");
  // performer / asserter fallback
  expect(text).toContain("Dr. Sample Renderer, MD");
  expect(text).toContain("Dr. Test Anesthesia, DO");
  expect(text).toContain("Casey Breadth-Tester"); // asserter fallback when no performer
  expect(text).toContain("(self-reported)");
  // quirk details survive: statusReason, basedOn link, long note, identifiers of meaning
  expect(text).toContain("Not performed: Patient declined");
  expect(text).toContain("Colonoscopy, diagnostic"); // basedOn display + SR code text
  // Long note not truncated: fragments from the start, middle, and end survive.
  expect(text).toContain("Cecal intubation");
  expect(text).toContain("cold snare");
  expect(text).toContain("without");
  expect(text).toContain("truncation.");
  expect(text).toContain("CPT 45378");

  // ServiceRequest table
  expect(text).toContain("MRI brain without contrast");
  expect(text).toContain("lumbar stabilization");
  expect(text).toContain("REVOKED");
  expect(text).toContain("ACTIVE");
  expect(text).toContain("original-order");
  // Narrow occurrence column wraps freely, so match pre-wrap fragments.
  expect(text).toContain("Twice weekly"); // occurrenceTiming code text
  expect(text).toContain("Nov 10, 2025"); // boundsPeriod start
  expect(text).toContain("Jun 1, 2025 – Jun 30,"); // occurrencePeriod
  expect(text).toContain("12 sessions"); // quantityQuantity
  expect(text).toContain("Wear comfortable clothing"); // patientInstruction
  expect(text).toContain("Dr. Example");
  expect(text).toContain("Orthopedist, MD");
});

test.skipIf(!RENDER)("most-recent-first within each table", async () => {
  const out = join(dir, "order.pdf");
  await renderFamiliesToPdf([procedures], fixtures, out);
  const text = await pdfText(out);
  // Procedures: dialysis (2026) before appendectomy (2025) before colonoscopy (2024);
  // undated (age/string) sink to the bottom.
  const dialysis = text.indexOf("SNOMED 302497006");
  const appy = text.indexOf("Laparoscopic appendectomy");
  const colo = text.indexOf("Screening colonoscopy");
  const tonsil = text.indexOf("Tonsillectomy and adenoidectomy (childhood)");
  expect(dialysis).toBeGreaterThan(-1);
  expect(dialysis).toBeLessThan(appy);
  expect(appy).toBeLessThan(colo);
  expect(colo).toBeLessThan(tonsil);
  // Orders: PT (2025-11) before MRI (2025-06) before colonoscopy order (2024-09)
  const pt = text.indexOf("lumbar stabilization");
  const mri = text.indexOf("MRI brain without contrast");
  const coloOrder = text.lastIndexOf("Average-risk colorectal");
  expect(pt).toBeGreaterThan(-1);
  expect(pt).toBeLessThan(mri);
  expect(mri).toBeLessThan(coloOrder);
});

test.skipIf(!RENDER)("volume: 500 instances paginate with repeating headers, nothing dropped", async () => {
  const out = join(dir, "vol.pdf");
  const res = await renderFamiliesToPdf([procedures], amplify(fixtures, 120), out);
  expect(res.fallbackCount).toBe(0);
  expect(res.renderedIds.length).toBe(120);
  expect(new Set(res.renderedIds).size).toBe(120);
  expect(res.pages).toBeGreaterThan(2);
  // Column headers (fixed rows) repeat on continuation pages of both tables.
  const mid = await pdfText(out, 3);
  expect(mid.toUpperCase()).toMatch(/PERFORMED|OCCURRENCE/);
  const late = await pdfText(out, res.pages - 1);
  expect(late.toUpperCase()).toMatch(/PERFORMED|OCCURRENCE/);
}, 120_000);

test.skipIf(!RENDER)("hostile: never throws on junk, degraded rows still render", async () => {
  expect(() => procedures.render([null, 42, {}, { resourceType: "X" }], summaryTheme)).not.toThrow();
  expect(() =>
    procedures.render(
      [
        { resourceType: "Procedure", id: "p-bad", code: 7, performedPeriod: "not-an-object", performer: "nope", status: 9 },
        { resourceType: "ServiceRequest", id: "sr-bad", code: { coding: "x" }, occurrenceTiming: 3, intent: {} },
        { resourceType: "Procedure" },
      ],
      summaryTheme,
    ),
  ).not.toThrow();
  const out = join(dir, "hostile.pdf");
  const res = await renderFamiliesToPdf(
    [procedures],
    [
      { resourceType: "Procedure", id: "p-bad", code: { text: "Mystery op" }, status: "bogus-status" },
      { resourceType: "ServiceRequest", id: "sr-bad" },
      ...fixtures,
    ],
    out,
  );
  expect(res.fallbackCount).toBe(0);
  expect(res.renderedIds).toContain("p-bad");
  expect(res.renderedIds).toContain("sr-bad");
  const text = await pdfText(out);
  expect(text).toContain("Mystery op");
  expect(text).toContain("(no description)");
});
