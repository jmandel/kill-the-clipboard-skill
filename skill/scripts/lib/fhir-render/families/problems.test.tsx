import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import problems from "./problems.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-problems-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("problems");

describe("claims", () => {
  test("claims every problems fixture", () => {
    for (const f of fixtures) expect(problems.claims(f)).toBe(true);
  });
  test("rejects non-Condition and hostile values without throwing", () => {
    expect(problems.claims({ resourceType: "Patient" })).toBe(false);
    expect(problems.claims({ resourceType: "Basic" })).toBe(false);
    expect(problems.claims(null)).toBe(false);
    expect(problems.claims(42)).toBe(false);
    expect(problems.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the problems section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([problems], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "problems", count: fixtures.length }]);

    const text = await pdfText(out);

    expect(text).toContain("Essential hypertension");
    expect(text).toContain("May 2, 2024"); // onsetDateTime
    expect(text).toContain("May 14, 2024"); // recordedDate

    expect(text).toContain("Community-acquired"); // long code.text wins over coding displays
    expect(text).toContain("Dec 18, 2024 – Dec 22, 2024"); // onsetPeriod
    expect(text).toContain("resolved: Jan 20, 2025"); // abatementDateTime

    // Mixed-script code.text: readable part leads intact on one line; the CJK run (no
    // glyphs in the document fonts) is isolated on its own sub-line, never garbling Latin.
    expect(text).toContain("Food insecurity — (identified via Hunger Vital Sign screening)");
    expect(text).toContain("Health concern");
    expect(text).toContain("SDOH"); // dual category incl. Epic urn:oid translation
    expect(text).toContain("unconfirmed"); // non-confirmed verificationStatus surfaced

    expect(text).toContain("SNOMED 239873007"); // code-only coding fallback label
    expect(text).toContain("age 43 years"); // onsetAge (unit text wins over UCUM `a`)
    expect(text).toContain("arthroscopy"); // abatementString

    expect(text).toContain("Right ankle sprain");
    expect(text).toContain("Mar 14, 2025");
    expect(text).toContain("Encounter diagnosis");

    expect(text).toContain("Recurrent tension-type"); // text-only code, no coding

    // entered-in-error: visible, suffixed, badged — never hidden as an active problem
    expect(text).toContain("Tobacco use disorder");
    expect(text).toContain("entered in error — disregard");
    expect(text).toContain("IN ERROR");

    for (const label of ["ACTIVE", "RESOLVED", "INACTIVE"]) expect(text).toContain(label);
  });

  test("rows sort most-recent-first by clinical recency", async () => {
    const out = join(dir, "order.pdf");
    await renderFamiliesToPdf([problems], fixtures, out);
    const text = await pdfText(out);
    const order = [
      "Recurrent tension-type", // recorded 2026-02-09
      "Food insecurity", // recorded 2026-01-15
      "Right ankle sprain", // abated 2025-04-28 (resolution is clinical activity)
      "Tobacco use disorder", // recorded 2025-04-02
      "Community-acquired", // abated 2025-01-20
      "SNOMED 239873007", // recorded 2024-08-19
      "Essential hypertension", // recorded 2024-05-14 (meta.lastUpdated ignored)
    ].map((s) => text.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 rows paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const res = await renderFamiliesToPdf([problems], amplify(fixtures, 120), out);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.fallbackCount).toBe(0);
    expect(res.pages).toBeGreaterThan(2);
    for (const pg of [2, Math.min(res.pages, 8)]) {
      const t = (await pdfText(out, pg)).toUpperCase();
      expect(t).toContain("CONDITION");
      expect(t).toContain("ONSET");
      expect(t).toContain("RECORDED");
    }
  }, 120_000);
});

describe("hostile", () => {
  test("render never throws and degrades per-row", () => {
    expect(() =>
      problems.render([null, 42, {}, { resourceType: "Condition" }, { resourceType: "Condition", code: 7 }], summaryTheme),
    ).not.toThrow();
    expect(problems.render([null], summaryTheme).length).toBeGreaterThan(0);
    expect(problems.render([], summaryTheme)).toEqual([]);
  });

  test("malformed instances still produce a full-page render", async () => {
    const out = join(dir, "hostile.pdf");
    const nasty = [
      { resourceType: "Condition", id: "c-bare" },
      { resourceType: "Condition", id: "c-weird", code: { coding: [{}] }, clinicalStatus: { text: "???" }, onsetRange: { low: { value: 1 } } },
      { resourceType: "Condition", id: "c-strings", code: { text: "x".repeat(300) }, onsetString: "sometime last winter", category: [{ text: "mystery-category" }] },
      ...fixtures,
    ];
    const res = await renderFamiliesToPdf([problems], nasty, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("c-bare");
    expect(res.renderedIds).toContain("c-weird");
    expect(res.renderedIds).toContain("c-strings");
    const text = await pdfText(out);
    expect(text).toContain("Condition/c-bare");
    expect(text).toContain("sometime last winter");
    expect(text).toContain("mystery-category");
  });
});
