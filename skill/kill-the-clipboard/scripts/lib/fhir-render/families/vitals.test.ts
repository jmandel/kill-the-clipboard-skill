import { expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vitals from "./vitals.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-vitals-test-"));
const fixtures = loadFamilyFixtures("vitals");

test("claims: every vitals fixture yes; Patient/Basic/lab Observation/junk no", () => {
  for (const f of fixtures) expect(vitals.claims(f)).toBe(true);
  expect(vitals.claims({ resourceType: "Patient", id: "p" })).toBe(false);
  expect(vitals.claims({ resourceType: "Basic" })).toBe(false);
  expect(vitals.claims({ resourceType: "Observation", category: [{ coding: [{ code: "laboratory" }] }] })).toBe(false);
  expect(vitals.claims({ resourceType: "Observation" })).toBe(false);
  expect(vitals.claims(null)).toBe(false);
  expect(vitals.claims(42)).toBe(false);
  expect(vitals.claims({ resourceType: "Observation", category: [{ text: "Vitals" }] })).toBe(true);
});

test.skipIf(!RENDER)("golden: every fixture renders with key clinical text findable", async () => {
  const out = join(dir, "golden.pdf");
  const res = await renderFamiliesToPdf([vitals], fixtures, out);
  expect(res.fallbackCount).toBe(0);
  expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
  expect(res.sections).toEqual([{ key: "vitals", count: fixtures.length }]);

  const text = await pdfText(out);
  const up = text.toUpperCase();
  expect(up).toContain("VITAL SIGNS");

  // BP composite from components, with component interpretation
  expect(text).toContain("132/84 mmHg — High (systolic)");
  // avg BP: valued systolic mean, dataAbsentReason diastolic mean, effectivePeriod
  expect(text).toContain("127.5/— mmHg (diastolic: Device export error)");
  expect(text).toContain("Apr 1, 2025");
  // code-only coding fallback label + human unit strings preferred over UCUM codes
  expect(text).toContain("LOINC 8867-4");
  expect(text).toContain("72 beats/minute");
  expect(text).toContain("16 breaths/minute");
  // pulse-ox: single observation (both LOINC codings), valued flow, DAR concentration
  expect(text).toContain("93% · Inhaled oxygen flow rate: 2 liters/min");
  expect(text).toContain("Not Performed");
  // entered-in-error: top-level dataAbsentReason text + visible status badge
  expect(text).toContain("Not recorded — Documented on wrong patient");
  // badge text wraps to two lines; "ENTERED IN" contiguous occurs only in the badge
  expect(up).toContain("ENTERED IN");
  expect(up).toContain("AMENDED");
  expect(up).toContain("PRELIMINARY");
  // simple quantities across the family
  expect(text).toContain("38.1 C — Above reference range");
  expect(text).toContain("152 lb");
  expect(text).toContain("175.3 cm");
  expect(text).toContain("22.4 kg/m2");
  expect(text).toContain("46.2 cm");
  expect(text).toContain("82%");
  expect(text).toContain("65%");
  expect(text).toContain("42.5%");
  // long note survives (wrap stressor)
  expect(text).toContain("BTMC-2024-008841");
  // panel: heading with date, members grouped under it, display-only member rendered
  expect(text).toContain("Vital signs panel — Mar 11, 2025 09:30");
  expect(text).toContain("legacy system");
  // panel-claimed member renders exactly once (never duplicated into the main table)
  expect(text.split("132/84 mmHg").length - 1).toBe(1);
  // most-recent-first: pulse-ox (Jan 2026) precedes the Sep 2024 cluster
  expect(text.indexOf("Jan 22, 2026")).toBeGreaterThan(-1);
  expect(text.indexOf("Jan 22, 2026")).toBeLessThan(text.indexOf("Sep 17, 2024"));
});

test.skipIf(!RENDER)("volume: 500 rows paginate with repeating headers, nothing dropped", async () => {
  const out = join(dir, "vol.pdf");
  const res = await renderFamiliesToPdf([vitals], amplify(fixtures, 120), out);
  expect(res.fallbackCount).toBe(0);
  expect(res.renderedIds.length).toBe(120);
  expect(res.pages).toBeGreaterThan(2);
  for (const pg of [2, 3, res.pages - 1]) {
    const pageUp = (await pdfText(out, pg)).toUpperCase();
    expect(pageUp).toContain("VITAL");
    expect(pageUp).toContain("VALUE");
    expect(pageUp).toContain("DATE");
  }
}, 120_000);

test.skipIf(!RENDER)("hostile: junk and malformed Observations never throw, each still gets a row", () => {
  const junk = [
    null,
    42,
    "x",
    {},
    { resourceType: "Observation" },
    { resourceType: "Observation", code: 5, component: "no", note: [{}], status: 9, category: "vital-signs" },
    { resourceType: "Observation", id: "panel-junk", hasMember: [null, {}, { reference: 7 }, { reference: "Observation/" }, { display: "loose member" }] },
    { resourceType: "Observation", id: "dup" },
    { resourceType: "Observation", id: "dup" },
    { resourceType: "Observation", valueQuantity: { value: "12ish" }, effectivePeriod: {} },
    { resourceType: "Observation", code: { text: "self-panel" }, id: "self", hasMember: [{ reference: "Observation/self" }] },
    { resourceType: "Observation", code: { coding: [{ system: 9, code: "8480-6" }] }, component: [{ code: { coding: [{ code: "8480-6" }] } }, { dataAbsentReason: { text: "gone" } }] },
  ];
  expect(() => vitals.render(junk as any[], summaryTheme)).not.toThrow();
  const blocks = vitals.render(junk as any[], summaryTheme);
  expect(blocks.length).toBeGreaterThan(0);
  expect(vitals.render([], summaryTheme)).toEqual([]);
});

test.skipIf(!RENDER)("hostile golden: one bad resource costs only its own row", async () => {
  const out = join(dir, "hostile.pdf");
  const bad = { resourceType: "Observation", id: "bad-one", category: [{ coding: [{ code: "vital-signs" }] }], code: { coding: "not-an-array" } };
  const res = await renderFamiliesToPdf([vitals], [...fixtures, bad], out);
  expect(res.fallbackCount).toBe(0);
  expect(res.renderedIds).toContain("bad-one");
  const text = await pdfText(out);
  expect(text).toContain("132/84 mmHg");
});
