import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import encounters from "./encounters.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-encounters-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("encounters");

describe("claims", () => {
  test("true for every fixture in the family dir", () => {
    for (const f of fixtures) expect(encounters.claims(f)).toBe(true);
  });

  test("false for Patient, Basic, and junk", () => {
    expect(encounters.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(encounters.claims({ resourceType: "Basic" })).toBe(false);
    expect(encounters.claims(null)).toBe(false);
    expect(encounters.claims(42)).toBe(false);
    expect(encounters.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the Encounters section with key content findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([encounters], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "encounters", count: fixtures.length }]);

    // pdftotext -layout wraps cells; assert tokens short enough to stay on one line.
    const text = await pdfText(out);
    // encounter-amb-office
    expect(text).toContain("Office visit, established patient");
    expect(text).toContain("Sep 12, 2024");
    expect(text).toContain("Dr. Sample");
    expect(text).toContain("(primary performer)");
    expect(text).toContain("Hypertension follow-up");
    // encounter-cancelled-minimal: code-only type, bare-date period, class without display
    expect(text).toContain("99395");
    expect(text).toContain("Nov 3, 2024");
    expect(text.toUpperCase()).toContain("CANCELLED");
    // encounter-emer-discharge: text-only reasonCode, display-only refs, disposition
    expect(text).toContain("Emergency department visit");
    expect(text).toContain("Chest pain, rule out ACS");
    expect(text).toContain("Discharge: Discharged to home");
    expect(text).toContain("Dr. Edge Casey");
    // encounter-epic-quirk-telehealth: VR class humanized, unicode participant
    expect(text).toContain("Telemedicine — Video Visit");
    expect(text).toContain("Virtual");
    expect(text).toContain("Sánchez-Müller");
    expect(text).toContain("Medication refill request");
    // encounter-imp-hospitalization: multi-day period, disposition, two participants
    expect(text).toContain("Inpatient admission");
    expect(text).toContain("Jun 14, 2025");
    expect(text).toContain("Jun 19, 2025");
    expect(text).toContain("Dr. Inpatient");
    expect(text).toContain("(Hospital Medicine)");
    expect(text).toContain("Dr. Consult");
    expect(text).toContain("(Infectious Disease)");
    expect(text).toContain("skilled nursing facility");
    // encounter-in-progress-no-end: open period, long reason wraps
    expect(text).toContain("Jan 30, 2026");
    expect(text).toContain("ongoing");
    expect(text).toContain("Acute ischemic stroke");
    // locations as compact rows
    expect(text.toUpperCase()).toContain("FACILITIES & LOCATIONS");
    expect(text).toContain("Breadth Test Family Medicine");
    expect(text).toContain("Outpatient clinic");
    expect(text).toContain("100 Renderer Way");
    expect(text).toContain("555-555-0188");
    expect(text).toContain("Breadth Test General Hospital");
    expect(text).toContain("98109-4321");
    expect(text).toContain("BTGH");
  });

  test("encounters sort most-recent-first", async () => {
    const out = join(dir, "sort.pdf");
    await renderFamiliesToPdf([encounters], fixtures, out);
    const text = await pdfText(out);
    const order = [
      "Jan 30, 2026", // in-progress
      "Oct 2, 2025", // telehealth
      "Jun 14, 2025", // hospitalization
      "Mar 8, 2025", // emergency
      "Nov 3, 2024", // cancelled
      "Sep 12, 2024", // office
    ].map((d) => text.indexOf(d));
    for (const idx of order) expect(idx).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("120 instances paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const amplified = amplify(fixtures, 120);
    const res = await renderFamiliesToPdf([encounters], amplified, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    const page2 = await pdfText(out, 2);
    expect(page2.toUpperCase()).toMatch(/WHEN|FACILITY/);
    const lastPage = await pdfText(out, res.pages);
    expect(lastPage).toContain(`Page ${res.pages} of ${res.pages}`);
  }, 120_000);
});

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() =>
      encounters.render([null, 42, {}, { resourceType: "X" }, { resourceType: "Encounter", class: 7, period: "no" }], summaryTheme),
    ).not.toThrow();
    expect(() => encounters.render(null as any, summaryTheme)).not.toThrow();
    expect(() => encounters.render([], summaryTheme)).not.toThrow();
  });

  test("a malformed instance still yields a row alongside good ones", async () => {
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf(
      [encounters],
      [
        { resourceType: "Encounter", id: "enc-bad", class: 99, period: { start: 12 }, type: "wat" },
        { resourceType: "Location", id: "loc-bad", name: 5, telecom: "x", type: {} },
        ...fixtures,
      ],
      out,
    );
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("enc-bad");
    expect(res.renderedIds).toContain("loc-bad");
    expect(res.renderedIds.length).toBe(fixtures.length + 2);
  });
});
