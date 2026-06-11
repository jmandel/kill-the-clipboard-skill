import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import patient from "./patient.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-patient-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("patient");

describe("claims", () => {
  test("true for every fixture, false for non-Patient and junk", () => {
    for (const f of fixtures) expect(patient.claims(f)).toBe(true);
    expect(patient.claims({ resourceType: "Basic" })).toBe(false);
    expect(patient.claims({ resourceType: "Observation" })).toBe(false);
    expect(patient.claims(null)).toBe(false);
    expect(patient.claims(42)).toBe(false);
    expect(patient.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the Demographics section, key text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([patient], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "patient", count: fixtures.length }]);

    const text = await pdfText(out);
    expect(text.toUpperCase()).toContain("DEMOGRAPHICS");

    // patient-constant — the kvPanel primary
    expect(text).toContain("Casey Breadth-Tester");
    expect(text).toContain("Feb 29, 1980");
    expect(text).toContain("BREADTH-0001");
    expect(text).toContain("555-555-0142");
    expect(text).toContain("Sample City, WA 98100");
    expect(text).toContain("English");

    // patient-deceased — official name w/ suffix, deceasedDateTime, text-only language
    expect(text).toContain("Renderer-Decedent");
    expect(text).toContain("MRN BREADTH-0046");
    expect(text).toMatch(/Deceased Nov 2,\s*2025/);
    expect(text).toContain("Spanish");

    // patient-minimal-absent — data-absent name + _birthDate, deceasedBoolean, raw-OID identifier
    expect(text).toContain("TRAUMA-2026-0007");
    expect(text).toContain("Unknown (name data absent)");
    // -layout interleaves the wrapped Born cell with neighboring columns
    expect(text).toMatch(/Unknown \(data[\s\S]{0,120}absent\)/);

    // patient-multiple-names — official-first with maiden/old aliases
    expect(text).toContain("Testcase-Wright, PharmD");
    expect(text).toContain("MRN BREADTH-0044");
    expect(text).toContain("Nov 30, 1991");
    expect(text).toContain("O'Brien");
    expect(text).toContain("(maiden)");

    // patient-unicode-name — fonts lack CJK glyphs, so the Latin alias stands in and the
    // suppressed official name is flagged in words (raw CJK would garble AND vanish from
    // the text layer); system-only MRN identifier labeled; code-only zh-CN coding survives
    // -layout interleaves the wrapped Name cell with neighboring columns
    expect(text).toMatch(/Xiuying Wang \(non-Latin name[\s\S]{0,160}on file\)/);
    expect(text).not.toContain("王");
    expect(text).toContain("MRN BREADTH-0045");
    expect(text).toContain("Chinese");
    expect(text).toContain("(Mandarin)");
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("120 Patient instances paginate with repeating table headers, none dropped", async () => {
    const out = join(dir, "volume.pdf");
    const res = await renderFamiliesToPdf([patient], amplify(fixtures, 120), out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(1);
    for (let p = 2; p <= res.pages; p++) {
      const pageText = (await pdfText(out, p)).toUpperCase();
      expect(pageText).toContain("IDENTIFIER");
      expect(pageText).toContain("BORN");
    }
  }, 120_000);
});

describe("hostile", () => {
  test("render never throws on junk", () => {
    expect(() => patient.render([null, 42, {}, { resourceType: "X" }], summaryTheme)).not.toThrow();
    expect(() => patient.render([], summaryTheme)).not.toThrow();
    expect(() => patient.render(undefined as any, summaryTheme)).not.toThrow();
    expect(() =>
      patient.render(
        [
          { resourceType: "Patient", name: "not-an-array", identifier: {}, telecom: 7 },
          { resourceType: "Patient", id: "p2", name: [{ given: 5 }], communication: [{}], _birthDate: { extension: "x" } },
        ],
        summaryTheme,
      ),
    ).not.toThrow();
  });

  test("a junk primary plus junk rows still produce a renderable PDF", async () => {
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf(
      [patient],
      [
        { resourceType: "Patient", id: "junk-1", name: [{ text: 9 }], deceasedBoolean: true },
        { resourceType: "Patient", id: "junk-2", address: [{ line: ["x".repeat(300)] }] },
        { resourceType: "Patient", id: "junk-3", communication: [{ language: { coding: [{ code: "zz" }] } }] },
      ],
      out,
    );
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toEqual(["junk-1", "junk-2", "junk-3"]);
    const text = await pdfText(out);
    expect(text).toContain("Yes (date not recorded)");
    expect(text).toContain("zz");
  });
});
