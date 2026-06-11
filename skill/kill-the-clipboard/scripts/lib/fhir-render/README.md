# fhir-render — family renderer contract

This directory is the FHIR→PDF renderer framework (DESIGN.md §7). The `render-fhir-pdf.ts`
CLI partitions resources across **family renderers** and assembles one summary-theme PDF.
Each family is one module in `families/`, currently a stub. **A family agent replaces its
own `families/<key>.tsx` wholesale and adds `families/<key>.test.tsx` next to it. Nothing
else in this directory may be touched** — not `registry.ts`, `types.ts`, `engine.ts`,
`harness.ts`, `fallback.tsx`, other families, or this file.

## The interface (types.ts)

```ts
export interface FamilyRenderer {
  key: string;        // fixed — must stay exactly the filename stem (e.g. "care-coordination")
  title: string;      // section heading text; you may refine the wording
  order: number;      // fixed per the registry table below — do not change
  claims(resource: any): boolean;
  render(resources: any[], theme: Theme): React.ReactElement[];
}
export default myFamily;   // default export — registry.ts imports it statically
```

Semantics the framework relies on:

- **`claims` is a pure, fast, never-throw predicate over ONE (hostile) resource.** The
  framework evaluates families in registry order; the **first `true` wins** the resource.
  A thrown error counts as `false`. Write claims as an absolute predicate on
  `resourceType` (+ Observation category where noted); you may rely on earlier families
  having already won their resources (e.g. `social` can claim any remaining Observation).
- **`render` receives EVERY resource your family claimed in one call** (collection-
  oriented) and returns an array of section *content* elements. The framework renders the
  `section(theme, title)` heading itself — never emit your own `section()` for the family
  heading (sub-headings inside your content via `para(..., [{text, bold:true}])` are fine).
- **`render` must never throw.** Wrap per-resource extraction so one malformed instance
  costs at most its own row, never the section. If your whole render throws anyway, the
  framework catches it and dumps your resources into the fallback section (completeness
  survives, quality doesn't — and your golden test should have caught it).
- `theme` is currently always `summaryTheme`, but use the passed value, never import a
  theme directly into layout decisions.

## Registry order + claim scopes (fixed; claim precedence = this order)

| # | key | title (stub) | order | claims |
|---|-----|--------------|-------|--------|
| 1 | `patient` | Demographics | 10 | `Patient` |
| 2 | `problems` | Problems & Health Concerns | 20 | `Condition` |
| 3 | `medications` | Medications | 30 | `MedicationRequest`, `MedicationDispense`, `MedicationStatement`, `Medication` |
| 4 | `allergies` | Allergies | 40 | `AllergyIntolerance` |
| 5 | `immunizations` | Immunizations | 50 | `Immunization` |
| 6 | `vitals` | Vital Signs | 60 | `Observation` with any category coding code `vital-signs` |
| 7 | `labs` | Laboratory & Clinical Results | 70 | `Observation` with category code **or** CodeableConcept.text in {`laboratory`, `Lab`, `LAB`, `imaging`, `procedure`, `clinical-test`} (case-insensitive; Epic emits a system-less `Lab` coding); `DiagnosticReport` with a lab category (v2-0074 `LAB`, or code/text `Lab`/`laboratory`); `Specimen` |
| 8 | `social` | Social History, Surveys & Other Observations | 80 | **ALL remaining `Observation`s** (social-history, sdoh, survey, exam, smartdata, functional-status, disability-status, missing/unknown category — everything vitals/labs didn't win) + `QuestionnaireResponse` |
| 9 | `procedures` | Procedures | 90 | `Procedure` |
| 10 | `encounters` | Encounters | 100 | `Encounter` |
| 11 | `care-coordination` | Care Plans, Teams & Goals | 110 | `CarePlan`, `CareTeam`, `Goal`, `ServiceRequest` |
| 12 | `coverage-devices` | Coverage & Devices | 120 | `Coverage`, `Device` |
| 13 | `documents` | Reports & Notes | 130 | `DocumentReference` + **remaining** `DiagnosticReport`s (non-lab; labs already won lab reports) |
| 14 | `family-history` | Family History | 140 | `FamilyMemberHistory` |
| 15 | `supporting` | Supporting Information | 150 | `Practitioner`, `PractitionerRole`, `Organization`, `Location`, `RelatedPerson`, `Provenance` |
| 16 | `fallback` | Other Records | 1000 | everything (never edit) |

Observation category matching must be hostile-safe, e.g.:

```ts
const categoryCodes = (r: any): string[] =>
  (Array.isArray(r?.category) ? r.category : []).flatMap((c: any) => [
    ...(Array.isArray(c?.coding) ? c.coding.map((x: any) => x?.code) : []),
    c?.text,
  ]).filter((x: any) => typeof x === "string");
```

## The volume rule (DESIGN §7 — binding)

Real records repeat heavily (321 Observations in the reference UnityPoint export). Family
renderers are **collection-oriented, never card-per-resource**:

- **One table row per resource instance. NEVER drop, dedupe, or summarize-away an
  instance** — one-row-per-resource is both the only layout that scales to hundreds of
  rows and the completeness guarantee behind the FHIR-Rendered PDF SHALL.
- Group clinically (labs by category/panel, vitals optionally pivoted date×measure — a
  pivot still needs every instance represented), sort most-recent-first.
- `table()` is the load-bearing primitive: headers repeat across page breaks and rows are
  atomic. Your volume test must render `amplify(yourFixtures, 500)` (or ≥500 rows however
  composed) and assert all ids in `renderedIds` plus multi-page text spot-checks.

## Hostile input rules (CLAUDE.md — binding)

FHIR input is hostile; real Epic data is messy. In every family:

- **Optional-chain everything.** Never assume `display`, `text`, `coding`, arrays, or any
  optional field exists. `coding[0].code` with no `display` and text-only CodeableConcepts
  (`{text: "..."}` with no coding) must both render sensibly.
- Tolerate unknown extensions, system-less codings, nonstandard categories,
  display-only references (`{display}` with no `reference`), contained resources,
  unicode, very long strings (the engine's hyphenation handles monster tokens).
- Per-resource try/catch inside `render`: a resource that defeats your extraction still
  gets a row (id + whatever you could read), and the rest of the section is unharmed.
- Render from structured elements, **not** `text.div`.
- No layout math, no direct `@react-pdf/renderer` imports, no JSX styling of your own —
  compose **only** the semantic components from `./engine.ts` (see below). Import types
  from `../types.ts` and components from `../engine.ts`; never deep-import `lib/doc.tsx`
  (the zip builder rewrites only `engine.ts`'s path).

## Engine components available (`../engine.ts`, re-exporting lib/doc.tsx)

```
table(t, {columns: [{header, width, align?}], rows: Cell[][], fontSize?, zebra?, flagRow?})
    Cell = string | Span[] | ReactElement (e.g. a badge)
para(t, spans, {size?, muted?, spaceAfter?})       Span = {text, bold?, italic?, highlight?, url?}
badge(t, label, kind?)    kinds: active stopped completed high low resolved inactive HIGH LOW NORMAL unable-to-assess
kvPanel(t, pairs)         bulletList(t, items)     callout(t, {title, body})
section / title / page / renderDoc / pageFooter    (framework-only — don't call in families)
Theme, summaryTheme, storyTheme, provenanceLine
```

## Test harness (`../harness.ts`)

```ts
renderFamiliesToPdf(families, resources, outPdf, opts?) → {renderedIds, sections, pages, fallbackCount}
    Sorts families by `order`, auto-appends fallback, partitions by claims (first-true-wins),
    renders title block + sections + fallback last, summary theme. A throwing family's
    resources route to fallback. opts: {title?, kicker?, meta?, callout?, footerLeft?}.
loadFamilyFixtures(dirName)   → instances from tests/fixtures/uscore/<dirName>/*.json
                                (coverage.json excluded; repo-only, not in skill.zip)
pdfText(pdf, page?)           → extracted text via `pdftotext -layout` (poppler required)
countPages(pdf)               → page count (no poppler needed)
amplify(resources, n)         → exactly n instances: originals + clones of date-bearing ones,
                                unique ids (`<id>-ampK`), synthetic dates 2024-01-01+K days
```

### Golden test template (`families/<key>.test.tsx`)

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import myFamily from "./<key>.tsx";
import { summaryTheme } from "../engine.ts";
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "ktc-<key>-test-"));
const fixtures = loadFamilyFixtures("<fixture-dir>");

test("golden: every fixture renders in MY section with key clinical text findable", async () => {
  const out = join(dir, "golden.pdf");
  const res = await renderFamiliesToPdf([myFamily], fixtures, out);
  expect(res.fallbackCount).toBe(0);                       // zero fallback leakage
  expect(new Set(res.renderedIds)).toEqual(new Set(fixtures.map((f) => String(f.id))));
  const text = await pdfText(out);
  // assert real extracted content per fixture: code displays, values+units, dates, statuses
});

test("volume: 500+ rows paginate with repeating headers, nothing dropped", async () => {
  const res = await renderFamiliesToPdf([myFamily], amplify(fixtures, 500), join(dir, "vol.pdf"));
  expect(res.renderedIds.length).toBe(500 /* adjust for id-less inputs */);
  expect(res.pages).toBeGreaterThan(5);
}, 120_000);

test("hostile: never throws", () => {
  expect(() => myFamily.render([null, 42, {}, { resourceType: "X" }], summaryTheme)).not.toThrow();
});
```

Notes for assertions: section/callout headings render with `textTransform: uppercase`, so
match against `text.toUpperCase()`. Assert on extracted text/geometry, not pixels.

### Fixtures

Read your family's `tests/fixtures/uscore/<dir>/NOTES.md` **first** — it documents the
deliberate quirks (Epic `Lab` category, display-only references, valueRatio titers,
dataAbsentReason, unicode notes…) your renderer must survive, and `coverage.json` lists
what each instance exercises. Your fixture dir name matches your key except where NOTES
say otherwise.

## Visual verification (binding — "it compiled" is not "it renders correctly")

Before declaring done, render a real PDF from your fixtures, rasterize, and **actually
look at the image** (Read the PNG, don't just generate it):

```sh
pdftoppm -png -r 120 golden.pdf /tmp/<key>-pg
# then Read /tmp/<key>-pg-1.png (and a continuation page for repeating headers)
```

Check: nothing overflows its cell, headers repeat on page 2+, badges legible, dates
consistent, footer intact, no orphaned headings.

## CLI (`scripts/render-fhir-pdf.ts`)

```
render-fhir-pdf.ts --resources selected-resources.json -o rendered.pdf --ids-out rendered-ids.json
                   [--patient-name NAME] [--dob YYYY-MM-DD] [--date YYYY-MM-DD]
```

Input: resource array, `{resources:[...]}`, a Bundle, or one resource. Output stdout:
`{"status":"rendered","output","idsOut","pages","sections":[{key,count}],"fallbackCount"}`.
`rendered-ids.json` is a JSON array of **every** input resource id (validator cross-check).
Target state: the UnityPoint export and the full synthetic corpus render with
`fallbackCount` 0 for all 19 known types once all families are implemented.
