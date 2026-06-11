import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import familyHistory from "./family-history.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-family-history-test-"));
const fixtures = loadFamilyFixtures("family-history");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("claims", () => {
  test("claims every fixture, rejects other types and junk", () => {
    for (const f of fixtures) expect(familyHistory.claims(f)).toBe(true);
    expect(familyHistory.claims({ resourceType: "Patient" })).toBe(false);
    expect(familyHistory.claims({ resourceType: "Basic" })).toBe(false);
    expect(familyHistory.claims(null)).toBe(false);
    expect(familyHistory.claims(42)).toBe(false);
    expect(familyHistory.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the Family History section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([familyHistory], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    const text = await pdfText(out);

    expect(text.toUpperCase()).toContain("FAMILY HISTORY");

    // mother-completed: name, bornDate, ICD-translated condition text, onsetAge,
    // onsetString, condition note, resource note, recorder extension
    expect(text).toContain("Mother");
    expect(text).toContain("Margaret Breadth-Tester");
    expect(text).toContain("born 1955-06-14");
    expect(text).toContain("Breast cancer");
    expect(text).toContain("onset age 52 years");
    expect(text).toContain("High blood pressure");
    expect(text).toContain("onset mid-40s");
    expect(text).toContain("lumpectomy and radiation"); // condition-level note (wraps mid-cell)
    expect(text).toContain("by Dr. Sample"); // recorder extension (wraps inside the narrow Recorded column)

    // father-deceased: deceasedAge, onsetRange, onsetPeriod (year precision),
    // contributedToDeath flag
    expect(text).toContain("Father");
    expect(text).toContain("Frank Breadth-Tester");
    expect(text).toContain("Deceased — age 71 years");
    expect(text).toContain("Heart attack");
    expect(text).toContain("onset age 60–65 years");
    expect(text).toContain("contributed to death");
    expect(text).toContain("Type 2 diabetes");
    expect(text).toContain("onset 2005–2019");

    // sister-partial: ageRange + estimatedAge, text-only condition.code, partial badge
    expect(text).toContain("Sister");
    expect(text).toContain("Sidney Breadth-Tester");
    expect(text).toContain("age 40–45 years (estimated)");
    expect(text).toContain("Asthma since childhood");
    expect(text).toContain("onset childhood");
    expect(text.toUpperCase()).toContain("PARTIAL");

    // grandmother-unicode: the document fonts carry no CJK glyphs, so raw CJK would
    // garble its line AND the text layer (patient-family policy) — Latin leads, runs
    // collapse to the worded placeholder, the fully-CJK name is flagged in words
    expect(text).toContain("Maternal grandmother");
    expect(text).toContain("(name in non-Latin script)"); // 王秀英 never printed raw
    expect(text).toContain("Stroke ([non-Latin text])"); // code-only coding falls back to code.text, CJK contained
    expect(text).toContain("onset age 79 years");
    expect(text).toContain("born: Rural Fujian"); // bornString (wraps inside the member column)
    expect(text).toContain("exact date unknown");
    expect(text).toContain("Deceased 2018-11-02");
    expect(text).not.toMatch(/[王秀英外婆中风]/); // unrenderable glyphs suppressed, not garbled
    expect(text).not.toContain("Àñ"); // the garble signature the old raw-CJK rendering produced

    // brother-healthunknown: no name (relationship leads), dataAbsentReason rendered,
    // health-unknown badge, resource note
    expect(text).toContain("Brother");
    expect(text).toContain("Unable To Obtain");
    expect(text).toContain("Estranged; no health information"); // dataAbsentReason.text (wraps mid-cell)
    expect(text.toUpperCase()).toContain("HEALTH UNKNOWN");
    expect(text).toContain("no contact with her brother");
  });

  test("deceasedBoolean false shows no death marker; deceased rows do", async () => {
    const mother = fixtures.find((f) => f.id === "familymemberhistory-mother-completed");
    const out = join(dir, "mother.pdf");
    await renderFamiliesToPdf([familyHistory], [mother], out);
    const text = await pdfText(out);
    expect(text).toContain("Mother");
    expect(text).not.toContain("Deceased");
  });

  test("most-recent-first by recorded date", async () => {
    const newer = structuredClone(fixtures.find((f) => f.id === "familymemberhistory-sister-partial"));
    const older = structuredClone(fixtures.find((f) => f.id === "familymemberhistory-father-deceased"));
    newer.date = "2026-01-15";
    older.date = "2023-02-01";
    const out = join(dir, "order.pdf");
    await renderFamiliesToPdf([familyHistory], [older, newer], out);
    const text = await pdfText(out);
    expect(text.indexOf("Sister")).toBeLessThan(text.indexOf("Father"));
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 rows paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const res = await renderFamiliesToPdf([familyHistory], amplify(fixtures, 120), out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    const mid = Math.ceil(res.pages / 2);
    for (const p of [2, mid, res.pages]) {
      const pageText = (await pdfText(out, p)).toUpperCase();
      expect(pageText).toContain("FAMILY MEMBER");
      expect(pageText).toContain("CONDITIONS");
      expect(pageText).toContain("STATUS");
      expect(pageText).toContain("RECORDED");
    }
  }, 180_000);
});

describe("hostile", () => {
  test("render never throws on junk", () => {
    expect(() =>
      familyHistory.render(
        [null, 42, {}, { resourceType: "X" }, { resourceType: "FamilyMemberHistory" }],
        summaryTheme,
      ),
    ).not.toThrow();
    expect(() => familyHistory.render(null as any, summaryTheme)).not.toThrow();
    expect(() => familyHistory.render([], summaryTheme)).not.toThrow();
  });

  test("one malformed instance degrades to a row without sinking the section", async () => {
    const poison = {
      resourceType: "FamilyMemberHistory",
      id: "fmh-poison",
      relationship: { coding: 17, text: { not: "a string" } },
      condition: "wat",
      status: { weird: 1 },
      date: { bad: true },
      deceasedAge: "seventy-one",
      note: [{ text: 9 }, null],
      extension: "nope",
    };
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf([familyHistory], [...fixtures, poison], out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("fmh-poison");
    const text = await pdfText(out);
    expect(text).toContain("Breast cancer");
  });
});
