# Coverage critic report — US Core synthetic fixture corpus

Audit date: 2026-06-10. Auditor: coverage critic (independent pass).
Scope: 14 families, 121 instances, 14 coverage.json manifests, STYLE.md rules.
Verification: mechanical script over every instance (JSON validity, family scope,
id=filename, no meta.profile, constant-patient urn on every patient/subject, inline
attachments only); automated diff of all 898 `covered` claims against instance content;
manual spot checks (≥3 per family); independent WebFetch of US Core 9.0.0 profile pages
for the 4 PAMI profiles plus us-core-careplan, us-core-device,
us-core-familymemberhistory, and the profiles index.

## Per-family verdicts

| Family | Instances | Mechanical rules | coverage.json claims | MS enumeration vs IG | Verdict |
|---|---|---|---|---|---|
| patient | 5 | clean | hold | honest gaps (gender/birthsex 9.0.0 notes) | PASS |
| problems | 7 | clean | hold | superset of official 14 MS (verified) | PASS |
| medications | 7 | clean | hold | matches official list (verified; `dispenseRequest` parent implied by children) | PASS |
| allergies | 7 | clean | hold | superset of official 6 MS (verified; adds `recorder`) | PASS |
| immunizations | 5 | clean | hold | exact match with official 11 MS (verified) | PASS |
| vitals | 15 | clean | hold | gaps admitted (BP component DAR, degF) | PASS |
| labs | 13 | clean | hold | gap admitted (Observation.effectivePeriod — actually covered elsewhere in corpus) | PASS |
| social | 16 | clean | hold | gaps admitted (QR answer types, hasMember→QR) | PASS |
| procedures | 7 | clean | hold | gaps admitted (performedString/Age/Range, focalDevice) | PASS |
| encounters | 8 | clean | hold | gaps admitted (display-only refs, Location.status) | PASS |
| care-coordination | 7 | clean | hold | exact match with official CarePlan 7 MS (verified; 9.0.0 unsliced category confirmed) | PASS |
| coverage-devices | 6 | clean | hold | MS set fine; canonical-URL drift (see flag 1) | PASS w/ note |
| documents | 6 | clean | hold | gap admitted (attachment.url deliberately never used — KTC rule) | PASS |
| supporting | 12 | clean | hold | gaps admitted (Endpoint unresolvable, onBehalfOf) | PASS |

Mechanical results, corpus-wide: 121/121 instances parse as valid JSON; every
resourceType is in its family's scope; every `id` equals the filename slug; zero
`meta.profile`; every `patient`/`subject` reference equals
`urn:uuid:00000000-b4ea-4d01-9871-000000000001` (patient-family variants correctly
exempt and never referenced elsewhere); every Attachment carries inline `data`, zero
attachment `url` anywhere.

Spot checks that confirmed non-obvious claims (all held): vitals BP
systolic/diastolic components with valueQuantity; avg-BP components 96608-5/96609-3;
pulse-ox FlowRate 3151-8 + O2-concentration DAR; labs dipstick component-level
valueCodeableConcept(text-only)/valueString/dataAbsentReason; social
screening-assessment panel-with-no-value (per IG guidance) + DAR asked-declined;
coverage memberid (MB) identifiers, class group/plan value+name; organization NAIC
identifier (urn:oid:2.16.840.1.113883.6.300); provenance author+transmitter agents;
immunization not-done + statusReason PATOBJ + occurrenceString; encounter
hospitalization.dischargeDisposition; superseded DocumentReference text-only category.

## Broken-rule list

No hard STYLE.md rule violations were found. Flags (all low severity):

1. **Stale canonical URL** —
   `coverage-devices/coverage.json` keys the Device profile as
   `.../us-core-implantable-device` while claiming uscoreVersion 9.0.0. The 9.0.0
   profiles index lists only "US Core Device Profile" (`us-core-device`); the
   implantable-device page on hl7.org serves stale 8.0.1 content (the family's
   NOTES.md admits this ambiguity). MS element set is unaffected (verified superset).
   Fix: re-key to `us-core-device` or pin uscoreVersion for that profile to 8.0.1.
   File: `tests/fixtures/uscore/coverage-devices/coverage.json`.
2. **Manifest entries not machine-diffable** — several `covered` values are prose
   ("all observation-*.json", "all four MedicationRequest fixtures") or carry
   parenthetical annotations on filenames ("file.json (active)"). All such claims were
   verified true, but STYLE.md's coverage.json sketch implies plain filename arrays;
   any automated coverage diff must strip annotations. Families: medications, vitals,
   labs (and scattered annotations everywhere).
3. **Understated gap note** — `labs/coverage.json` gap says Observation.effectivePeriod
   is not included; it is in fact exercised corpus-wide
   (`vitals/observation-avg-bp.json`, `social/observation-smokingstatus-packyears.json`,
   `social/observation-occupation.json`). Cosmetic only.
4. **Non-conformant-by-design instances** (tolerance fixtures, keep, but renderer tests
   must not treat them as conformance examples):
   `care-coordination/careplan-structured-completed.json` text-only category (legal in
   9.0.0 — unsliced category confirmed against the published profile);
   `documents/documentreference-superseded-minimal.json` lacks date/author/category
   coding; `supporting/provenance-patient-author-quirk.json` numeric agent-type code "1".

## Coverage gaps, ranked by renderer impact

PAMI must-support verification (WebFetch, US Core 9.0.0): allergies (6/6),
immunizations (11/11), medications (18/18 incl. implied parent), problems (14/14) — no
missed must-supports in any PAMI family; the only undeclared corpus-wide gaps are the
profile-level ones below.

1. **FamilyMemberHistory — entire resource type missing.** US Core 9.0.0 defines
   `us-core-familymemberhistory` (MS: status, patient, relationship, condition,
   condition.code); no family owns it. The renderer's family-history section is
   completely untested. Highest impact: add a small family (normal + condition-coded +
   data-absent variants).
2. **US Core ADI DocumentReference Profile (`us-core-adi-documentreference`) missing.**
   Advance-directive documents are a distinct USCDI section; documents family covers
   only the base DocumentReference. Shared rendering path mitigates, but ADI category
   codes/type codes are never exercised.
3. **US Core Observation ADI Documentation Profile missing.** Companion to #2; no
   observation anywhere carries the ADI-documentation category/codes.
4. **QuestionnaireResponse answer-type breadth** (admitted by social):
   valueDate/valueDateTime/valueDecimal/valueInteger/valueQuantity/valueAttachment/
   valueReference and nested item-under-answer never exercised — the QR answer
   renderer is tested only for string/coding/boolean.
5. **Procedure.performed choice breadth** (admitted): performedString, performedAge,
   performedRange never instantiated; a renderer switch over performed[x] has three
   untested arms.
6. **BP component dataAbsentReason on us-core-blood-pressure itself** (admitted):
   demonstrated only on sibling profiles; the most common vitals panel never shows a
   missing-component rendering.
7. **Body temperature [degF]** (admitted): no Fahrenheit quantity anywhere; unit
   display fallback for `[degF]` untested (other non-metric units are covered).
8. **screening-assessment hasMember → QuestionnaireResponse target** (admitted):
   hasMember always points at Observations; the QR-typed hasMember rendering path is
   untested (derivedFrom→QR is covered).
9. **Location.status variants** (admitted): only `active`; suspended/inactive label
   handling untested. Same shape: Goal achievementStatus breadth is decent but
   Coverage has no `draft`, Device no `entered-in-error`.
10. **Provenance agent.onBehalfOf never populated** (admitted, justified — `who` is
    never a Practitioner/Device in transmitter agents); plus no Endpoint resource in
    the corpus (PractitionerRole.endpoint stays unresolvable by design).

Everything else in the 9.0.0 profile inventory (32 non-vitals profiles + base vitals +
13 concrete vitals profiles) is covered by at least one family with claims that
held under audit.

## Gap-fill round 2026-06-10

Closes ranked gaps 1–5 above. Corpus is now 15 families, 131 instances. Profile pages
re-fetched from hl7.org/fhir/us/core (US Core 9.0.0, STU 9) for
us-core-familymemberhistory, us-core-adi-documentreference, and
us-core-observation-adi-documentation, including the published examples
(FamilyMemberHistory-familymemberhistory-example, DocumentReference-living-will,
Observation-ADI-example) to confirm the recorder extension URL
(`us-core-familymemberhistory-recorder`), the adi category code (LOINC 42348-3), the
fixed ADI observation code (LOINC 45473-6), the `workflow-supportingInfo` extension URL,
and the yes/no/unknown answer coding (SNOMED 373066001).

### Closed

1. **FamilyMemberHistory** — NEW family `family-history/` (5 instances + coverage.json +
   NOTES.md). All 5 MS elements covered; relationships MTH/FTH/SIS/BRO/MGRMTH; statuses
   completed/partial/health-unknown; deceasedBoolean-false/deceasedAge/deceasedDate;
   onsetAge/onsetString/onsetRange/onsetPeriod; bornDate/bornString; ageRange+estimatedAge;
   resource-level dataAbsentReason (unable-to-obtain) with no condition list; unicode name
   王秀英; code-only and text-only condition codes; ICD-10-CM translation; recorder
   extension (additional USCDI).
2. **us-core-adi-documentreference** — `documents/documentreference-adi-living-will.json`
   (type LOINC 75320-2 + 86533-7, category:adi LOINC 42348-3, patient-authored, inline
   base64 PDF stub, never attachment.url). documents/coverage.json gained the profile
   block; NOTES.md updated.
3. **us-core-observation-adi-documentation** — `social/observation-adi-documentation.json`
   (fixed 45473-6, us-core-category observation-adi-documentation, valueCodeableConcept
   SNOMED 373066001 "Yes", issued + effectiveDateTime, workflow-supportingInfo extension
   referencing the ADI DocumentReference cross-family). social/coverage.json gained the
   profile block.
4. **QR answer-type breadth** — `social/questionnaireresponse-intake-numeric.json`
   exercises valueDate, valueDateTime, valueDecimal, valueInteger, valueQuantity,
   valueReference, valueAttachment (inline data), plus items nested under an answer
   (`answer[].item[]`). social/coverage.json QR gap narrowed accordingly.
5. **Procedure.performed[x]** — `procedures/procedure-tonsillectomy-childhood-age.json`
   (performedAge, 7 years UCUM `a`, self-asserted) and
   `procedures/procedure-cholecystectomy-string.json` (performedString with em-dash,
   recorder+asserter). procedures/coverage.json updated.

Mechanical re-check over the 10 new instances and 4 touched manifests: valid JSON,
id=filename, no meta.profile, constant-patient urn on every subject/patient, inline
attachment data only (zero attachment.url), every `covered` filename exists on disk.

### Still open (honest gaps, recorded in the owning coverage.json)

- performedRange (gap 5, deliberately skipped — no realistic export source; noted in
  procedures/coverage.json).
- QR answer types valueTime/valueUri (never in the ranked list; noted in social).
- ADI: single living-will instance (no DNR/POLST type variants); ADI observation covers
  only the "Yes" answer and a single supporting-info extension.
- FamilyMemberHistory status entered-in-error not instantiated.
- Ranked gaps 6–10 (BP component DAR on us-core-blood-pressure, [degF] temperature,
  hasMember→QR target, Location.status/Coverage.draft/Device.entered-in-error breadth,
  Provenance onBehalfOf/Endpoint) remain untouched by this round.
