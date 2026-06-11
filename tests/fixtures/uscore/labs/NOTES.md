# labs family — renderer notes

US Core **9.0.0** profiles read on hl7.org/fhir/us/core (current published STU):
us-core-observation-lab, us-core-observation-clinical-result, us-core-diagnosticreport-lab,
us-core-specimen. No `meta.profile` on instances per KTC rule; `meta.lastUpdated` is present
because US Core 9.0.0 flags it must-support on lab Observation and DiagnosticReport.

Deliberate quirks a renderer MUST tolerate:

- **Epic 'Lab' category**: `observation-potassium-high` has TWO category entries — standard
  `laboratory` plus `{ "coding": [{ "code": "Lab" }], "text": "Lab" }` with **no system**.
  `diagnosticreport-cbc-panel` similarly carries a system-less `Lab` coding alongside v2-0074
  `LAB` in one CodeableConcept.
- **Extension noise**: `observation-potassium-high` carries an Epic-style extension
  (`https://open.epic.com/fhir/extensions/observation-instant`) that must be ignored gracefully.
- **Display-only references** (no `reference` element): encounters everywhere, the second
  `result` entry in `diagnosticreport-cbc-panel` ("Platelet count … paper only"), and most
  performers. Renderer must not assume resolvable references.
- **Contained resource**: `diagnosticreport-cbc-panel.performer` → `#lab-org` contained
  Organization.
- **Cross-file relative references**: `Observation/observation-*` and `Specimen/specimen-*`
  resolve to sibling fixture files in this directory; patient is always the constant urn
  `urn:uuid:00000000-b4ea-4d01-9871-000000000001`.
- **valueRatio titer** (`observation-ana-titer`): render as `1:160`, not as a fraction; its
  referenceRange and interpretation are text-only.
- **valueBoolean** (`observation-urine-nitrite`): boolean `true` means "Nitrite present" —
  renderers should not print bare "true" without the code text.
- **Component-only observation** (`observation-urine-dipstick`): no top-level value; one
  component has `dataAbsentReason` instead of a value; status is `corrected` with an
  explanatory note. Satisfies us-core-2 via components.
- **Cancelled with dataAbsentReason** (`observation-hba1c-cancelled`): no value at all,
  no issued, no specimen — the DAR text is the whole story.
- **Unicode + long text**: `observation-urine-color.note` (中文, µL, Técnico-Müller) and
  `specimen-urine-clean-catch.note`.
- `observation-clinical-ef` is the us-core-observation-clinical-result instance (category
  `imaging`); everything else with category `laboratory` targets us-core-observation-lab.

Clinical storyline: 2025-03-10 venous draw → CBC (hemoglobin low, final) + potassium
(preliminary, high); 2025-09-02 clean-catch urine → urinalysis report (preliminary) with
color/dipstick/nitrite; 2024-11-04 HbA1c cancelled (hemolysis); 2024-08-19 blood type;
2025-01-21 ANA titer; 2025-06-18 echo EF.
