import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import coverageDevices from "./coverage-devices.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-coverage-devices-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("coverage-devices");

describe("claims", () => {
  test("true for every fixture in the family dir", () => {
    for (const f of fixtures) expect(coverageDevices.claims(f)).toBe(true);
  });

  test("false for Patient, Basic, and junk", () => {
    expect(coverageDevices.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(coverageDevices.claims({ resourceType: "Basic" })).toBe(false);
    expect(coverageDevices.claims(null)).toBe(false);
    expect(coverageDevices.claims(42)).toBe(false);
    expect(coverageDevices.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the section with key content findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([coverageDevices], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "coverage-devices", count: fixtures.length }]);

    const text = await pdfText(out);
    // Both subsections present (para sub-headings, not uppercased section headers).
    expect(text).toContain("Insurance Coverage");
    expect(text).toContain("Devices & Implants");

    // coverage-employer-ppo: payor display-only, member id, subscriberId, group+plan class, period.
    expect(text).toContain("Commercial PPO");
    expect(text).toContain("MBR-884221");
    expect(text).toContain("EMP-7741-00");
    expect(text).toContain("GRP-100234");
    expect(text).toContain("PLN-PPO-GOLD");
    expect(text).toContain("Jan 1, 2025");
    expect(text).toContain("Dec 31, 2025");
    expect(text).toContain("Self");
    // coverage-spouse-cancelled: text-only type, code-only relationship, plan class without name.
    expect(text).toContain("SP-2210-01");
    expect(text).toContain("Spouse");
    expect(text).toContain("Jordan");
    expect(text).toContain("SMI-HDHP-2024");
    expect(text.toUpperCase()).toContain("CANCELLED");
    // coverage-medicare-contained-payor: contained Organization payor, MBI, open-ended period.
    expect(text).toContain("Centers");
    expect(text).toContain("Medicare");
    expect(text).toContain("1EG4-TE5-MK73");
    expect(text).toContain("Mar 1, 2025");
    expect(text).toContain("ongoing");

    // device-pacemaker-active: full GS1 UDI, distinctIdentifier, lot+serial, mfg/exp dates.
    expect(text).toContain("EnduraPace");
    expect(text).toContain("BT-100");
    expect(text).toContain("00643169007222");
    // Monster HRF tokens wrap at the engine's 11-char hyphenation boundaries; the first
    // chunk is always contiguous in extracted text even when the rest wraps.
    expect(text).toContain("(01)0064316");
    expect(text).toContain("LOT-PMK-2024A");
    expect(text).toContain("PMK-SN-000123");
    expect(text).toContain("Jan 15, 2024");
    expect(text).toContain("Jan 15, 2032");
    // device-hip-prosthesis-inactive: DI-only UDI, lot without serial, code-only 2nd coding, note.
    expect(text).toContain("08717648200274");
    expect(text).toContain("HIP-LOT-7781");
    expect(text).toContain("femoral");
    expect(text).toContain("explanted");
    expect(text.toUpperCase()).toContain("INACTIVE");
    // device-insulin-pump-active: HIBCC HRF, manual entryType, unicode manufacturer, firmware.
    expect(text).toContain("GlucoFlow");
    expect(text).toContain("B1XCRT001234567");
    expect(text).toContain("+B1XCRT0012");
    expect(text).toContain("IP-2406-001");
    expect(text).toContain("Jun 30, 2027");
    expect(text).toContain("Bösch");
    expect(text).toContain("Firmware");
    expect(text.toUpperCase()).toContain("ACTIVE");
  });

  test("rows sort most-recent-first within each table", async () => {
    const out = join(dir, "sort.pdf");
    await renderFamiliesToPdf([coverageDevices], fixtures, out);
    const text = await pdfText(out);
    // Coverage by period.start desc: medicare (2025-03) > employer (2025-01) > spouse (2024-01).
    const covOrder = ["1EG4-TE5-MK73", "MBR-884221", "SP-2210-01"].map((s) => text.indexOf(s));
    // Devices by manufacture/expiration date desc: pump (exp 2027) > pacemaker (2024) > hip (2018).
    const devOrder = ["GlucoFlow", "EnduraPace", "HIP-LOT-7781"].map((s) => text.indexOf(s));
    for (const order of [covOrder, devOrder]) {
      for (const idx of order) expect(idx).toBeGreaterThan(-1);
      for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    }
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("120 instances paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const amplified = amplify(fixtures, 120);
    const res = await renderFamiliesToPdf([coverageDevices], amplified, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    // A continuation page must carry a repeated table header (coverage or device table).
    const page2 = await pdfText(out, 2);
    expect(page2.toUpperCase()).toMatch(/PAYER|PLAN \/ GROUP|DEVICE|UDI/);
    const lastPage = await pdfText(out, res.pages);
    expect(lastPage).toContain(`Page ${res.pages} of ${res.pages}`);
  }, 120_000);
});

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() =>
      coverageDevices.render(
        [
          null,
          42,
          {},
          { resourceType: "X" },
          { resourceType: "Coverage", payor: 7, class: "x", period: 3, identifier: {}, relationship: 9 },
          { resourceType: "Device", udiCarrier: "x", deviceName: 9, type: [], note: 1, version: "v" },
        ],
        summaryTheme,
      ),
    ).not.toThrow();
    expect(() => coverageDevices.render(null as any, summaryTheme)).not.toThrow();
    expect(() => coverageDevices.render([], summaryTheme)).not.toThrow();
  });

  test("malformed instances still yield rows alongside good ones", async () => {
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf(
      [coverageDevices],
      [
        { resourceType: "Coverage", id: "cov-bad", payor: 7, class: "x", period: 3 },
        { resourceType: "Device", id: "dev-bad", udiCarrier: "x", deviceName: 9, type: [] },
        ...fixtures,
      ],
      out,
    );
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("cov-bad");
    expect(res.renderedIds).toContain("dev-bad");
    expect(res.renderedIds.length).toBe(fixtures.length + 2);
  });

  test("code-only and text-only concepts degrade readably", () => {
    const els = coverageDevices.render(
      [
        { resourceType: "Coverage", id: "c1", type: { text: "Text only plan" }, relationship: { coding: [{ code: "child" }] } },
        { resourceType: "Device", id: "d1", type: { coding: [{ code: "304120007" }] } },
      ],
      summaryTheme,
    );
    expect(els.length).toBeGreaterThan(0);
  });
});
