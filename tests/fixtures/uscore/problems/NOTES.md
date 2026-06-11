# problems family — renderer notes

US Core **9.0.0** profiles covered:
- Condition (Problems and Health Concerns): hypertension, pneumonia, food-insecurity, tobacco, osteoarthritis
- Condition (Encounter Diagnosis): ankle-sprain, headache

Deliberate quirks a renderer MUST tolerate:

- **condition-tobacco-entered-in-error**: `verificationStatus = entered-in-error` and **no
  `clinicalStatus`** (required absence per invariant con-5). Renderers should surface the
  entered-in-error state prominently or suppress the row, never show it as an active problem.
- **condition-osteoarthritis-inactive**: minimal/ugly form — code-only SNOMED coding
  (239873007, **no display, no text**), clinicalStatus/verificationStatus codings without
  display, `onsetAge` (43 years, UCUM `a`), `abatementString` free text. Renderer needs a
  code-system+code fallback label.
- **condition-headache-encounter-diagnosis-textonly**: `code` is **text-only** (no coding),
  no verificationStatus, `encounter` is **display-only** (no reference), recorder is a
  non-physician display-only ("Sam Scribe, RN").
- **condition-food-insecurity-health-concern**: TWO categories — `health-concern` plus an
  `sdoh` category whose CodeableConcept carries both the US Core `us-core-category` coding
  and an Epic-style `urn:oid:1.2.840...` translation coding. `code.text` contains unicode
  (食品不安全). Asserter is the patient herself by display.
- **condition-pneumonia-resolved**: unknown proprietary extension
  (`https://open.epic.com/fhir/extensions/condition-display-rank`) that must be ignored
  gracefully; very long `code.text` overriding the codings; `onsetPeriod`.
- **condition-hypertension-active**: the assertedDate **extension**
  (`http://hl7.org/fhir/StructureDefinition/condition-assertedDate`) — a must-support
  element in 9.0.0; SNOMED + ICD-10-CM dual coding.
- Encounter references (`Encounter/encounter-breadth-ed-visit`,
  `Practitioner/practitioner-sample-renderer`) are intentionally unresolvable within this
  corpus; only the constant patient urn is guaranteed resolvable.
- Timezone variety: recordedDate values appear as date-only, UTC `Z`, and `-05:00` offsets.
