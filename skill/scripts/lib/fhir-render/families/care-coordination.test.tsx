import { afterAll, describe, expect, test } from "bun:test";

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import careCoordination from "./care-coordination.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-care-coordination-test-"));
const fixtures = loadFamilyFixtures("care-coordination");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("claims", () => {
  test("true for every care-coordination fixture", () => {
    for (const f of fixtures) expect(careCoordination.claims(f)).toBe(true);
  });
  test("true for ServiceRequest (registry scope)", () => {
    expect(careCoordination.claims({ resourceType: "ServiceRequest" })).toBe(true);
  });
  test("false for Patient, Basic, and junk", () => {
    expect(careCoordination.claims({ resourceType: "Patient" })).toBe(false);
    expect(careCoordination.claims({ resourceType: "Basic" })).toBe(false);
    expect(careCoordination.claims(null)).toBe(false);
    expect(careCoordination.claims(42)).toBe(false);
    expect(careCoordination.claims({})).toBe(false);
  });
  test("claims never throws", () => {
    for (const v of [null, undefined, 42, "x", [], { resourceType: 9 }]) {
      expect(() => careCoordination.claims(v)).not.toThrow();
    }
  });
});

describe.skipIf(!RENDER)("golden", () => {
  test("every fixture renders in the section with key clinical text findable", async () => {
    const out = join(dir, "golden.pdf");
    const res = await renderFamiliesToPdf([careCoordination], fixtures, out);
    expect(res.fallbackCount).toBe(0);
    expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));

    const text = await pdfText(out);

    // careplan-narrative-active: plan content extracted from text.div (Epic-style),
    // entities decoded, headings/list items/table rows surviving as plain text.
    expect(text).toContain("grandkids"); // patient's own words from the narrative
    expect(text).toContain("PHQ-9"); // narrative <table> row content
    expect(text).toContain("titration"); // intervention row
    expect(text).toContain("Assessment and Plan"); // category in the plan cell

    // careplan-structured-completed: activity[] rendered, narrative-only fallback NOT used.
    expect(text).toContain("Post-acute"); // text-only category
    expect(text).toContain("rehabilitation"); // SNOMED activity code text
    expect(text).toContain("3x/week"); // scheduledTiming 3/wk
    expect(text).toContain("2024-05-01"); // scheduledPeriod start
    expect(text).toContain("Smoking"); // display-only activity.reference
    expect(text).toContain("declined"); // progress annotation

    // careteam-active-multirole: role/name rows across the member reference space.
    expect(text).toContain("CDCES"); // contained-practitioner participant
    expect(text).toContain("Jordan"); // RelatedPerson participant
    expect(text).toContain("Primary Care Provider"); // role text
    expect(text).toContain("Endocrinology"); // display-only Organization member
    expect(text).toContain("for Breadth Test Medical Center"); // onBehalfOf

    // careteam-inactive-minimal: code-only SNOMED role gets system+code label.
    expect(text).toContain("SNOMED 41672002");
    expect(text).toContain("Pulmonology"); // PractitionerRole display
    expect(text).toContain("2024-06-28"); // closed period end

    // goals: description, targets, due dates, achievement, expressedBy.
    expect(text).toContain("2026-03-31"); // a1c target dueDate
    expect(text).toContain("5–7 %"); // detailRange
    expect(text).toContain("8.4%"); // a1c note text
    expect(text).toContain("dyspnea"); // walking goal description
    expect(text).toContain("510"); // walking outcomeReference display
    expect(text).toContain("Achieved"); // achievementStatus coding without text
    expect(text).toContain("Under 2,300"); // sodium detailString (wraps after "2,300")
    expect(text).toContain("Riley"); // display-only expressedBy
    expect(text).toContain("travel"); // statusReason surfaced

    // Status badges (uppercase chips).
    for (const s of ["ACTIVE", "COMPLETED", "INACTIVE", "ON-HOLD"]) expect(text).toContain(s);
  });

  test("plans and goals sort most-recent-first", async () => {
    const out = join(dir, "sort.pdf");
    await renderFamiliesToPdf([careCoordination], fixtures, out);
    const text = await pdfText(out);
    // Plans: narrative (2025-10-22) before structured (2024-03-04).
    const narrative = text.indexOf("grandkids");
    const structured = text.indexOf("Post-acute");
    expect(narrative).toBeGreaterThan(-1);
    expect(narrative).toBeLessThan(structured);
    // Goals: sodium (statusDate 2026-01-15) > a1c (start 2025-10-22) > walking (2024-03-04).
    const sodium = text.indexOf("Sunday"); // unique to the sodium goal description
    const a1c = text.indexOf("8.4%"); // unique to the a1c goal note
    const walking = text.indexOf("510"); // unique to the walking goal outcome
    expect(sodium).toBeGreaterThan(-1);
    expect(sodium).toBeLessThan(a1c);
    expect(a1c).toBeLessThan(walking);
  });

  test("ServiceRequest renders as an Orders & Referrals row", async () => {
    const sr = {
      resourceType: "ServiceRequest",
      id: "sr-cardio",
      status: "active",
      intent: "order",
      category: [{ coding: [{ system: "http://snomed.info/sct", code: "306206005", display: "Referral to service" }] }],
      code: { text: "Referral to cardiology" },
      authoredOn: "2025-05-01",
      requester: { display: "Dr. Sample Renderer" },
    };
    const out = join(dir, "sr.pdf");
    const res = await renderFamiliesToPdf([careCoordination], [...fixtures, sr], out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds).toContain("sr-cardio");
    const text = await pdfText(out);
    expect(text).toContain("cardiology");
    expect(text).toContain("2025-05-01");
    expect(text.toUpperCase()).toContain("ORDERS & REFERRALS");
  });
});

describe.skipIf(!RENDER)("volume", () => {
  test("500 rows paginate with repeating headers, nothing dropped", async () => {
    // CarePlans carry long narrative cells (near page-height rows), so the 500-instance
    // volume set is composed (per DESIGN §7 "≥500 rows however composed"): 40 plans +
    // 460 teams/goals.
    const plans = fixtures.filter((f) => f.resourceType === "CarePlan");
    const rest = fixtures.filter((f) => f.resourceType !== "CarePlan");
    const amped = [...amplify(plans, 20), ...amplify(rest, 100)];
    const out = join(dir, "vol.pdf");
    const res = await renderFamiliesToPdf([careCoordination], amped, out);
    expect(res.fallbackCount).toBe(0);
    expect(res.renderedIds.length).toBe(120);
    expect(new Set(res.renderedIds).size).toBe(120);
    expect(res.pages).toBeGreaterThan(2);

    // Repeating table headers: each table's header text shows up on several pages.
    let planHeaderPages = 0;
    let goalHeaderPages = 0;
    for (let p = 1; p <= res.pages; p++) {
      const pg = (await pdfText(out, p)).toUpperCase();
      if (pg.includes("PLAN DETAILS")) planHeaderPages++;
      if (pg.includes("PROGRESS") && pg.includes("TARGET")) goalHeaderPages++;
    }
    expect(planHeaderPages).toBeGreaterThan(2);
    expect(goalHeaderPages).toBeGreaterThan(2);
  }, 120_000);
});

describe("hostile input", () => {
  test("render never throws on junk", () => {
    expect(() =>
      careCoordination.render(
        [
          null,
          42,
          {},
          { resourceType: "X" },
          { resourceType: "CarePlan" },
          { resourceType: "CarePlan", text: { div: 12 }, activity: "nope", category: 7, period: "later" },
          { resourceType: "CarePlan", activity: [{ detail: { code: 5, scheduledTiming: { repeat: { frequency: "x" } } } }, null, "x"] },
          { resourceType: "CareTeam", participant: "nobody", period: { start: 9 } },
          { resourceType: "CareTeam", participant: [{ role: 3, member: { reference: "#missing" } }, null] },
          { resourceType: "Goal", description: 7, target: { dueDate: true }, note: "n" },
          { resourceType: "Goal", target: [{ detailRange: { low: "a" } }, null] },
          { resourceType: "ServiceRequest", code: [], requester: 5, category: "cat" },
        ],
        summaryTheme,
      ),
    ).not.toThrow();
    expect(() => careCoordination.render(null as any, summaryTheme)).not.toThrow();
  });

  test("a defeated resource degrades to its own row, the rest survive", async () => {
    const hostile = [
      ...fixtures,
      { resourceType: "CarePlan", id: "cp-hostile", category: [{ coding: [{ code: "999111" }] }] },
      { resourceType: "Goal", id: "goal-hostile" },
      { resourceType: "CareTeam", id: "team-hostile" },
    ];
    const out = join(dir, "hostile.pdf");
    const res = await renderFamiliesToPdf([careCoordination], hostile, out);
    expect(res.fallbackCount).toBe(0);
    for (const id of ["cp-hostile", "goal-hostile", "team-hostile"]) expect(res.renderedIds).toContain(id);
    const text = await pdfText(out);
    expect(text).toContain("999111"); // code-only category coding renders the bare code
    expect(text).toContain("grandkids"); // the good rows are unharmed
  });
});
