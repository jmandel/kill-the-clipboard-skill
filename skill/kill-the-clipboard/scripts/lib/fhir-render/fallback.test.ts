import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summaryTheme } from "./engine.ts";
import fallback from "./fallback.tsx";
import { loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "./harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-fallback-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("fallback renderer", () => {
  test("never throws on hostile garbage", () => {
    const els = fallback.render([null, 42, "string", {}, { resourceType: "Basic" }, { a: { b: [{ c: null }] } }], summaryTheme);
    expect(Array.isArray(els)).toBe(true);
    expect(els.length).toBeGreaterThan(0);
  });

  test("corpus instance + alien resource: ids and values land in the PDF, noise is skipped", async () => {
    const patient = loadFamilyFixtures("patient").find((r) => r.id === "patient-constant");
    expect(patient).toBeDefined();
    const alien = {
      resourceType: "Basic",
      id: "basic-alien-1",
      meta: { versionId: "999", source: "should-not-appear-meta" },
      text: { status: "generated", div: "<div>narrative-noise-should-not-appear</div>" },
      extension: [
        { url: "https://example.org/fhir/StructureDefinition/widget-flavor", valueString: "extension-value-appears" },
      ],
      code: { coding: [{ code: "alien-code-only" }] },
      note: [{ text: "B".repeat(500) }],
    };

    const out = join(dir, "fallback.pdf");
    const res = await renderFamiliesToPdf([], [patient, alien], out);

    expect(res.fallbackCount).toBe(2);
    expect(res.renderedIds.sort()).toEqual(["basic-alien-1", "patient-constant"]);
    expect(res.sections).toEqual([{ key: "fallback", count: 2 }]);

    const text = await pdfText(out);
    // section headings render with textTransform:uppercase, so match case-insensitively
    expect(text.toUpperCase()).toContain("OTHER RECORDS");
    expect(text).toContain("patient-constant");
    expect(text).toContain("Breadth-Tester"); // a real leaf value from the corpus instance
    expect(text).toContain("basic-alien-1");
    expect(text).toContain("alien-code-only");
    expect(text).toContain("extension-value-appears");
    // noisy keys skipped
    expect(text).not.toContain("should-not-appear-meta");
    expect(text).not.toContain("narrative-noise-should-not-appear");
    // extension urls collapse to their last segment (both the alien's and the corpus
    // patient's US Core race/ethnicity extensions)
    expect(text).not.toContain("StructureDefinition");
    expect(text).toContain("widget-flavor");
    // long values are capped, not dumped
    expect(text).not.toContain("B".repeat(200));
  });
});
