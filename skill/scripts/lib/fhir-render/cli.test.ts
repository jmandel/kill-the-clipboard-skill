// End-to-end test of scripts/render-fhir-pdf.ts. Assertions are stub-proof: they never
// assume WHICH section a corpus resource lands in (family agents will move them out of
// fallback), only that every resource is rendered and accounted for. Alien resourceTypes
// are the only thing pinned to fallback.
import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { loadFamilyFixtures, pdfText } from "./harness.ts";

const SCRIPT = join(import.meta.dir, "../../render-fhir-pdf.ts");
const dir = mkdtempSync(join(tmpdir(), "ktc-cli-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function mixedSet() {
  return [
    loadFamilyFixtures("patient").find((r) => r.id === "patient-constant"),
    loadFamilyFixtures("problems").find((r) => r.id === "condition-hypertension-active"),
    loadFamilyFixtures("vitals").find((r) => r.id === "observation-bp"),
    { resourceType: "Basic", id: "basic-alien-1", code: { text: "alien content marker xyzzy" } },
  ];
}

describe.skipIf(!RENDER)("render-fhir-pdf.ts", () => {
  test("end-to-end on a small mixed set", async () => {
    const resources = mixedSet();
    const inFile = join(dir, "selected-resources.json");
    const outPdf = join(dir, "rendered.pdf");
    const idsOut = join(dir, "rendered-ids.json");
    await Bun.write(inFile, JSON.stringify({ resources }));

    const proc = await $`bun ${SCRIPT} --resources ${inFile} -o ${outPdf} --ids-out ${idsOut} --date 2026-06-10`.quiet();
    const out = JSON.parse(proc.stdout.toString());

    expect(out.status).toBe("rendered");
    expect(out.output).toBe(outPdf);
    expect(out.pages).toBeGreaterThanOrEqual(1);
    const sectionTotal = out.sections.reduce((a: number, s: any) => a + s.count, 0);
    expect(sectionTotal).toBe(resources.length);
    expect(out.fallbackCount).toBeGreaterThanOrEqual(1); // the alien at minimum
    for (const s of out.sections) {
      expect(typeof s.key).toBe("string");
      expect(s.count).toBeGreaterThan(0);
    }

    const ids = await Bun.file(idsOut).json();
    expect(new Set(ids)).toEqual(new Set(resources.map((r: any) => String(r.id))));

    const text = await pdfText(outPdf);
    expect(text).toContain("Casey"); // patient name derived from the Patient resource
    expect(text).toContain("1980-02-29"); // derived DOB
    expect(text.toUpperCase()).toContain("HOW THIS DOCUMENT WAS SHARED");
    expect(text).toContain("Shared by the patient via SMART Health Link — 2026-06-10");
    expect(text).toContain("basic-alien-1"); // alien always renders via fallback
    expect(text).toContain("alien content marker xyzzy");
  });

  test("accepts a Bundle and a bare array; --patient-name/--dob flags win", async () => {
    const resources = mixedSet();
    const bundleFile = join(dir, "bundle.json");
    await Bun.write(
      bundleFile,
      JSON.stringify({ resourceType: "Bundle", type: "collection", entry: resources.map((r) => ({ resource: r })) }),
    );
    const outPdf = join(dir, "from-bundle.pdf");
    const idsOut = join(dir, "from-bundle-ids.json");
    const proc =
      await $`bun ${SCRIPT} --resources ${bundleFile} -o ${outPdf} --ids-out ${idsOut} --patient-name ${"Override Name"} --dob 1999-12-31`.quiet();
    const out = JSON.parse(proc.stdout.toString());
    expect(out.status).toBe("rendered");
    expect(new Set(await Bun.file(idsOut).json())).toEqual(new Set(resources.map((r: any) => String(r.id))));
    const text = await pdfText(outPdf);
    expect(text).toContain("Override Name");
    expect(text).toContain("1999-12-31");
  });

  test("missing required args → exit 1 + usage on stderr, nothing on stdout", async () => {
    const proc = await $`bun ${SCRIPT}`.quiet().nothrow();
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("Usage:");
    expect(proc.stdout.toString().trim()).toBe("");
  });

  test("unreadable resources file → exit 1", async () => {
    const proc = await $`bun ${SCRIPT} --resources ${join(dir, "nope.json")} -o ${join(dir, "x.pdf")} --ids-out ${join(dir, "x.json")}`
      .quiet()
      .nothrow();
    expect(proc.exitCode).toBe(1);
  });
});
