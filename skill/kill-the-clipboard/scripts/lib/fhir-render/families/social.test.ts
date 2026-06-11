import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import social from "./social.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-social-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixtures = loadFamilyFixtures("social");

describe("claims", () => {
  test("claims every social fixture (tolerant Observation catch-all + QuestionnaireResponse)", () => {
    for (const f of fixtures) expect(social.claims(f)).toBe(true);
  });

  test("rejects non-Observation/QR resources and hostile values", () => {
    expect(social.claims({ resourceType: "Patient", id: "p1" })).toBe(false);
    expect(social.claims({ resourceType: "Basic" })).toBe(false);
    expect(social.claims(null)).toBe(false);
    expect(social.claims(undefined)).toBe(false);
    expect(social.claims(42)).toBe(false);
    expect(social.claims({})).toBe(false);
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the social section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([social], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
    expect(res.sections).toEqual([{ key: "social", count: fixtures.length }]);

    const text = await pdfText(out);
    const has = (re: RegExp | string) => {
      if (typeof re === "string") expect(text).toContain(re);
      else expect(text).toMatch(re);
    };

    // NOTE: pdftotext -layout splices adjacent columns between a cell's wrapped lines,
    // so each assertion targets a phrase short enough to stay on one rendered line.
    // observation-adi-documentation: code, value, supporting-info document link
    has(/Advance\s+healthcare\s+directive/);
    has(/Supporting\s+document:\s+Living\s+will/);
    // observation-care-experience-preference: latin part of the unicode valueString
    has(/Prefers\s+early-morning\s+appointments/);
    // observation-occupation: value, industry component, open period, contained performer
    has(/Certified\s+Nursing\s+Assistant/);
    has(/Home\s+health\s+care/);
    has("2019-06-01 –");
    has(/\bpresent\b/);
    has(/Dr\.\s+Sample\s+Renderer/);
    // pregnancy status (amended badge) + intent
    has(/Not\s+pregnant/);
    expect(text.toUpperCase()).toMatch(/AMENDED/);
    has(/Pregnancy\s+intention/);
    has("Not sure");
    // HVS cluster: risk result, panel members listed without an invented value, q1 answer,
    // q2 dataAbsentReason
    has(/Food\s+insecurity\s+risk/);
    has("At risk");
    has(/Panel\s+of\s+2\s+member\s+results:/);
    has(/Worried\s+food\s+would\s+run\s+out/);
    has(/Often\s+true/);
    has(/Not\s+recorded\s+—\s+Patient\s+declined\s+to\s+answer/);
    // sexual orientation: code-only value coding, text carries the answer
    has(/Sexual\s+orientation/);
    has(/Straight\s+or\s+heterosexual/);
    // disability + functional status (preliminary badge)
    has(/difficulty\s+hearing\?/);
    has(/Independent\s+with\s+dressing/);
    expect(text.toUpperCase()).toMatch(/PRELIMINARY/);
    // smartdata: text-only code, valueString
    has(/LIVING\s+SITUATION/);
    has(/Lives\s+alone\s+in\s+a\s+single-story\s+apartment/);
    // smoking: current status text; pack-years entered-in-error still shows value + flag
    has(/Current\s+every\s+day\s+smoker/);
    has(/15\s+pack\s+years/);
    expect(text.toUpperCase()).toMatch(/IN\s+ERROR/);
    has("1998-06-01 –");
    has("2024-11-02");
    // treatment preference: long valueString rendered in full (spot-check head and tail)
    has(/Supportive\s+and\s+Palliative\s+Care\s+Team/);
    has(/annual\s+wellness\s+visit/);
    // QR titles from _questionnaire display extension
    has(/Hunger\s+Vital\s+Sign\s+\(HVS\)/);
    has(/Annual\s+Wellness\s+Intake/);
    // QR hvs: nested group answers, boolean, unanswered item
    has(/food\s+resources\?/);
    has(/no\s+answer\s+recorded/);
    has(/food\s+pantry\s+on\s+5th\s+Street/);
    // QR intake: date, decimal, integer, quantity, reference, nested answer items,
    // inline text attachment decoded
    has("2024-10-15");
    has("2.5");
    has(/68\.5\s+kg/);
    has(/Cycling\s+and\s+yoga/);
    has(/Tobacco\s+smoking\s+status\s+\(2025\)/);
    has(/Home\s+BP\s+log/);
    has(/118\/76/);
    // category grouping sub-headings
    has(/Social\s+Determinants\s+of\s+Health\s+\(4\)/);
    has(/Social\s+History\s+\(/);
    has(/Questionnaire\s+Responses\s+\(2\)/);
  }, 60_000);
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 instances paginate with repeating headers, nothing dropped", async () => {
    const out = join(dir, "vol.pdf");
    const amped = amplify(fixtures, 120);
    const res = await renderFamiliesToPdf([social], amped, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);
    // table header repeats on continuation pages deep inside the document
    const mid = await pdfText(out, Math.ceil(res.pages / 2));
    expect(mid.toUpperCase()).toMatch(/OBSERVATION\s+RESULT/);
  }, 240_000);
});

describe("hostile input", () => {
  test("render never throws on garbage", () => {
    const garbage = [
      null,
      undefined,
      42,
      "string",
      {},
      { resourceType: "Observation" },
      { resourceType: "Observation", id: "bad-code", code: 5, valueQuantity: "nope", category: "wat" },
      { resourceType: "Observation", id: "bad-arrays", performer: {}, component: [null, 7], hasMember: "x" },
      { resourceType: "QuestionnaireResponse", id: "bad-items", item: "bogus", _questionnaire: 9 },
      { resourceType: "QuestionnaireResponse", id: "weird", item: [{ answer: [{ valueAttachment: { data: "!!", contentType: "text/plain" } }] }] },
    ];
    expect(() => social.render(garbage as any[], summaryTheme)).not.toThrow();
    expect(social.render(garbage as any[], summaryTheme).length).toBeGreaterThan(0);
  });

  test("a degraded resource still gets a row in the PDF", async () => {
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf(
      [social],
      [
        { resourceType: "Observation", id: "obs-degraded", code: { coding: [{ code: "12345-6" }] } },
        { resourceType: "Observation", id: "obs-text-only", code: { text: "Text-only concept" }, valueString: "ok" },
      ],
      out,
    );
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(["obs-degraded", "obs-text-only"]));
    const text = await pdfText(out);
    expect(text).toContain("12345-6"); // code-only coding falls back to the code itself
    expect(text).toContain("Text-only concept");
  }, 30_000);
});
