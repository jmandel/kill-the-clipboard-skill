import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import supporting from "./supporting.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-supporting-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("supporting");

describe("claims", () => {
  test("true for every fixture in the family dir", () => {
    for (const f of fixtures) expect(supporting.claims(f)).toBe(true);
  });

  test("true for Location (registry scope, normally won earlier by encounters)", () => {
    expect(supporting.claims({ resourceType: "Location", id: "loc-1" })).toBe(true);
  });

  test("false for Patient, Basic, and junk", () => {
    expect(supporting.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(supporting.claims({ resourceType: "Basic" })).toBe(false);
    expect(supporting.claims(null)).toBe(false);
    expect(supporting.claims(42)).toBe(false);
    expect(supporting.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the section with key content findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([supporting], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "supporting", count: fixtures.length }]);

    const text = await pdfText(out);
    expect(text.toUpperCase()).toContain("CARE TEAM & SOURCES");

    // practitioner-sample-renderer: full name w/ suffixes, NPI, qualification text
    expect(text).toContain("Dr. Sample Q. Renderer, MD");
    expect(text).toContain("1234567893");
    expect(text).toContain("Doctor of Medicine");
    expect(text).toContain("100 Renderer Way");
    // practitioner-sample-hospitalist: unicode names, second usual name, NPI
    expect(text).toContain("José María");
    expect(text).toContain(`("Pepe")`);
    expect(text).toContain("1999888773");
    expect(text).toContain("Doctor of Osteopathy");
    // practitioner-nurse-minimal: family-only name, code-only RN qualification, NCSBN id
    expect(text).toContain("Sample-Nurse");
    expect(text).toContain("RN");
    expect(text).toContain("NCSBN");
    expect(text).toContain("87654321");
    // practitionerrole-cardiology: practitioner display, code text, specialty, org + location
    expect(text).toContain("Cardiologist");
    expect(text).toContain("Cardiovascular");
    expect(text).toContain("Breadth Test Clinic");
    // practitionerrole-pharmacist-endpoint: text-only code as the row label, NUCC code-only
    // specialty, display-only location, unresolvable endpoint rendered as its display
    expect(text).toContain("Clinical pharmacist");
    expect(text).toContain("183500000X");
    expect(text).toContain("Direct:");
    // organization-breadth-test-medical: name, NPI, type, address
    expect(text).toContain("Medical Center");
    expect(text).toContain("1555666779");
    expect(text).toContain("Healthcare Provider");
    expect(text).toContain("1 Coverage Plaza");
    // organization-breadth-reference-lab: very long name survives, CLIA + NPI both shown
    expect(text).toContain("Esoteric");
    expect(text).toContain("CLIA");
    expect(text).toContain("99D9999999");
    expect(text).toContain("1444333227");
    // organization-breadth-health-plan: NAIC id, inactive badge, partial address
    expect(text).toContain("NAIC");
    expect(text).toContain("95999");
    expect(text.toUpperCase()).toContain("INACTIVE");
    expect(text).toContain("98103");
    // relatedperson-spouse: both relationships, name, address
    expect(text).toContain("Jordan Avery");
    expect(text).toContain("Spouse");
    expect(text).toContain("Spouse; Emergency"); // "Emergency contact" wraps across cell lines
    expect(text).toContain("4242 Coverage Court");
    // relatedperson-guardian-noname: code-only GUARD labeled, bounded period, no name
    expect(text).toContain("Guardian");
    expect(text).toContain("(name not recorded)");
    expect(text).toContain("1980");
    expect(text).toContain("1998");
    // provenance rows: recorded dates, agents w/ onBehalfOf, display-only transmitter, targets
    expect(text.toUpperCase()).toContain("RECORD SOURCES (PROVENANCE)");
    expect(text).toContain("Nov 3, 2025");
    expect(text).toContain("Jan 15, 2026");
    expect(text).toContain("Transmitter");
    expect(text).toContain("Casey Breadth-Tester");
    expect(text).toContain("3 records");
    expect(text).toContain("2 records");
    expect(text).toContain("Activity: revise");
  });

  test("provenance sorts most-recent-first", async () => {
    const out = join(dir, "sort.pdf");
    await renderFamiliesToPdf([supporting], fixtures, out);
    const text = await pdfText(out);
    const newer = text.indexOf("Jan 15, 2026");
    const older = text.indexOf("Nov 3, 2025");
    expect(newer).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(newer);
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 instances paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const amplified = amplify(fixtures, 120);
    const res = await renderFamiliesToPdf([supporting], amplified, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    const page2 = await pdfText(out, 2);
    expect(page2.toUpperCase()).toMatch(/NAME|RECORDED/);
    const lastPage = await pdfText(out, res.pages);
    expect(lastPage).toContain(`Page ${res.pages} of ${res.pages}`);
  }, 120_000);
});

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() =>
      supporting.render(
        [
          null,
          42,
          {},
          { resourceType: "X" },
          { resourceType: "Practitioner", name: "wat", identifier: 7, qualification: {} },
          { resourceType: "Provenance", agent: "no", target: 3, recorded: { bad: true } },
          { resourceType: "Organization", name: 12, address: "nope", type: false },
        ],
        summaryTheme,
      ),
    ).not.toThrow();
    expect(() => supporting.render(null as any, summaryTheme)).not.toThrow();
    expect(() => supporting.render([], summaryTheme)).not.toThrow();
  });

  test("a malformed instance still yields a row alongside good ones", async () => {
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf(
      [supporting],
      [
        { resourceType: "Practitioner", id: "prac-bad", name: 9, identifier: "x" },
        { resourceType: "Provenance", id: "prov-bad", agent: 1, recorded: 2 },
        { resourceType: "RelatedPerson", id: "rp-bad", relationship: "spouse?" },
        ...fixtures,
      ],
      out,
    );
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("prac-bad");
    expect(res.renderedIds).toContain("prov-bad");
    expect(res.renderedIds).toContain("rp-bad");
    expect(res.renderedIds.length).toBe(fixtures.length + 3);
  });
});
