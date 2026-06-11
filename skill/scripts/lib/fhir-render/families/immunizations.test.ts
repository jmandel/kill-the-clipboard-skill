import { afterAll, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import immunizations from "./immunizations.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-immunizations-test-"));
const fixtures = loadFamilyFixtures("immunizations");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("claims: every fixture yes; Patient/Basic/garbage no", () => {
  for (const f of fixtures) expect(immunizations.claims(f)).toBe(true);
  expect(immunizations.claims({ resourceType: "Patient" })).toBe(false);
  expect(immunizations.claims({ resourceType: "Basic" })).toBe(false);
  expect(immunizations.claims(null)).toBe(false);
  expect(immunizations.claims(42)).toBe(false);
  expect(immunizations.claims({})).toBe(false);
});

test.skipIf(!RENDER)("golden: every fixture renders with key clinical text findable", async () => {
  const out = join(dir, "golden.pdf");
  const res = await renderFamiliesToPdf([immunizations], fixtures, out);
  expect(res.fallbackCount).toBe(0);
  expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));

  // -layout preserves cell wrapping, so multi-word assertions run against
  // whitespace-flattened text; every asserted phrase lives inside a single cell.
  const text = (await pdfText(out)).replace(/\s+/g, " ");
  const upper = text.toUpperCase();

  // covid-completed: text-form vaccine name, CVX code from translation set, date-only occurrence,
  // long lot number survives (hyphenation may split it — match a short prefix), site display
  expect(text).toContain("Pfizer-BioNTech COVID-19 vaccine");
  expect(text).toContain("CVX 208");
  expect(text).toContain("2024-09-14");
  expect(text).toContain("PFZ-2024");
  expect(text).toContain("right arm");

  // flu-completed: text + CVX, timestamp reduced to date, lot + site.text preferred
  expect(text).toContain("Influenza vaccine, quadrivalent");
  expect(text).toContain("CVX 158");
  expect(text).toContain("2024-10-03");
  expect(text).toContain("FLU24-AB1234");
  expect(text).toContain("Left deltoid");

  // tdap-historical: occurrenceString verbatim (the narrow date column wraps it, and
  // -layout interleaves other columns between wrapped lines, so assert two fragments),
  // primarySource:false report origin visible
  expect(text).toContain("Tdap");
  expect(text).toContain("Late summer");
  expect(text).toContain("exact date unknown (patient recall)");
  expect(text).toContain("Patient self-report at intake");
  expect(text).toContain("Patient self-report at intake");

  // flu-not-done: code-only CVX coding renders as the code; statusReason visible; badge text
  expect(text).toContain("CVX 88");
  expect(upper).toContain("NOT DONE");
  expect(text).toContain("Patient declined seasonal influenza vaccine");

  // hepb-entered-in-error: text-only vaccineCode; status visibly distinguished
  expect(text).toContain("hepatitis B vaccine, adult formulation");
  expect(upper).toContain("ENTERED IN ERROR");
});

test.skipIf(!RENDER)("golden: rows sorted most-recent-first, undated (occurrenceString) last", async () => {
  const out = join(dir, "order.pdf");
  await renderFamiliesToPdf([immunizations], fixtures, out);
  const text = (await pdfText(out)).replace(/\s+/g, " ");
  const pos = (s: string) => {
    const i = text.indexOf(s);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  };
  expect(pos("hepatitis B vaccine")).toBeLessThan(pos("CVX 88")); // 2025-01-08 before 2024-11-21
  expect(pos("CVX 88")).toBeLessThan(pos("Influenza vaccine, quadrivalent")); // before 2024-10-03
  expect(pos("Influenza vaccine, quadrivalent")).toBeLessThan(pos("Pfizer-BioNTech")); // before 2024-09-14
  expect(pos("Pfizer-BioNTech")).toBeLessThan(pos("Late summer")); // dated before undated
});

test.skipIf(!RENDER)("volume: 500 rows paginate, nothing dropped, headers repeat", async () => {
  const out = join(dir, "vol.pdf");
  const res = await renderFamiliesToPdf([immunizations], amplify(fixtures, 120), out);
  expect(res.renderedIds.length).toBe(120);
  expect(res.fallbackCount).toBe(0);
  expect(res.pages).toBeGreaterThan(2);
  const p2 = (await pdfText(out, 2)).toUpperCase();
  const p3 = (await pdfText(out, 3)).toUpperCase();
  for (const p of [p2, p3]) {
    expect(p).toContain("VACCINE");
    expect(p).toContain("STATUS");
    expect(p).toContain("LOT / SITE / NOTES");
  }
}, 120_000);

test.skipIf(!RENDER)("hostile: never throws, degraded inputs still produce a table", () => {
  expect(() =>
    immunizations.render(
      [
        null,
        42,
        {},
        { resourceType: "Immunization" },
        { resourceType: "Immunization", id: "weird", vaccineCode: { coding: "not-an-array" }, occurrenceDateTime: 7 },
        { resourceType: "Immunization", status: 99, site: { coding: [{}] }, statusReason: { text: 5 } },
      ],
      summaryTheme,
    ),
  ).not.toThrow();
  expect(immunizations.render([], summaryTheme).length).toBeGreaterThanOrEqual(0);
});

test.skipIf(!RENDER)("hostile: a malformed instance costs only its own row in a full document", async () => {
  const out = join(dir, "hostile.pdf");
  const mixed = [...fixtures, { resourceType: "Immunization", id: "imm-mangled", vaccineCode: { coding: "x" } }];
  const res = await renderFamiliesToPdf([immunizations], mixed, out);
  expect(res.fallbackCount).toBe(0);
  expect(res.renderedIds).toContain("imm-mangled");
  expect(await pdfText(out)).toContain("Pfizer-BioNTech COVID-19 vaccine");
});
