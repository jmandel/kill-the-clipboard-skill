# documents family — renderer notes

Profiles read: US Core **9.0.0** (current published STU) —
`us-core-documentreference`, `us-core-diagnosticreport-note`, and (added 2026-06-10)
`us-core-adi-documentreference`.

## What a renderer must handle here

- **Inline attachments only.** Every `content.attachment` and `presentedForm` carries
  base64 `data`; `attachment.url` is NEVER used (KTC rule). us-core-6 ("url or data SHALL
  be present") is satisfied via `data` in all instances. Payloads are small but real:
  decodable text/plain notes and structurally valid one-page `%PDF-1.4` stubs.
- **text/plain payloads contain multi-line clinical prose** — render as preformatted text
  or paragraphs, not as one collapsed line. The consult note's decoded text and its
  `attachment.title` contain unicode (é, ×, ≤, °C, β, em-dash).
- **PDF payloads** (`documentreference-discharge-summary-pdf`, radiology presentedForm)
  should be embedded or linked as pages, not dumped as base64 text. `attachment.size`
  present on PDFs only.
- **documentreference-superseded-minimal** is the floor: no identifier, date, author,
  docStatus, format, or context; type coding has **no display** (LOINC 34117-2); category
  is **text-only** (not the us-core slice). Also exercises `relatesTo` with a
  display-only target.
- **Epic quirks deliberately included:** urn:oid identifiers (HAR/accession-style),
  local-codesystem translation codings alongside LOINC (consult type, discharge category,
  radiology category code "Imaging"), an unknown root extension on the discharge summary
  that must be tolerated, and a non-LOINC second coding inside the us-core category slice.
- **References:** patient is always the constant urn
  (`urn:uuid:00000000-b4ea-4d01-9871-000000000001`). Encounter references point at the
  encounters family fixtures (`Encounter/encounter-imp-hospitalization`,
  `Encounter/encounter-amb-office`); the radiology report's encounter, performer, result,
  and the consult author are **display-only** references with no `reference` — render the
  display string.
- **DiagnosticReport variants:** effectiveDateTime vs effectivePeriod; status final vs
  amended (amended report has TWO presentedForm entries — amended PDF plus plain-text
  impression; render both or prefer the first); `result` present only on the radiology
  report and only as a display-only reference.
- Very long single string: `description` on the discharge summary (~700 chars, one
  paragraph) — must wrap, not truncate.

## Advance directive (ADI) instance

- **documentreference-adi-living-will** conforms to `us-core-adi-documentreference`:
  type carries TWO LOINC codings (75320-2 "Advance directive" + 86533-7 "Patient Living
  will", both from the Advance Healthcare Directive Document Types grouper); the
  required `category:adi` slice is LOINC **42348-3 "Advance healthcare directives"** —
  a different code system than the us-core clinical-note category slice on the other
  DocumentReferences. Renderers grouping by category must not assume the
  us-core-documentreference-category system.
- `author` is the **patient herself** (constant urn) — an authoring shape no other
  document fixture uses; render as patient-authored, not clinician-authored.
- Attachment is an inline base64 one-page PDF stub (`size` 357), `creation` is
  **date-precision** ("2025-09-01"); `context.period` has start only (directive in
  effect, open-ended). No encounter context — ADI documents are typically
  encounter-independent.
- Cross-family link: `social/observation-adi-documentation.json` points at this
  instance via the `workflow-supportingInfo` extension.

## Honest gaps

- `content.attachment.url` never populated (KTC rule, recorded in coverage.json gaps).
- No `imagingStudy`/`media` on DiagnosticReport (not must-support in the note profile).
- ADI profile has a single instance (living will); DNR/POLST type variants not
  instantiated (recorded in coverage.json gaps).
