# family-history family — renderer notes

US Core **9.0.0** (current published STU, fetched 2026-06-10 from hl7.org/fhir/us/core):
`us-core-familymemberhistory`. 5 FamilyMemberHistory instances. Every `patient` reference
is the constant urn (`urn:uuid:00000000-b4ea-4d01-9871-000000000001`). No `meta.profile`
(KTC rule).

Must-support per the published profile: status, patient, relationship, condition,
condition.code. Additional USCDI: `extension:recorder`
(`http://hl7.org/fhir/us/core/StructureDefinition/us-core-familymemberhistory-recorder`),
present once (mother record, Practitioner reference).

## What a renderer must handle here

- **The family-member axis is `relationship`, not `name`.** The brother record has NO
  `name`; render the relationship text ("Brother"). When `name` exists it may be unicode:
  the maternal grandmother is 王秀英, with CJK in `relationship.text` (外婆) and a note (中风).
- **deceased[x] is a 3-way switch here**: `deceasedBoolean: false` (mother — explicitly
  alive, do not show a death marker), `deceasedAge` (father, 71 years UCUM `a`),
  `deceasedDate` (grandmother). Absent on the sister/brother records.
- **born[x] vs age[x] never coexist on one instance** (FHIR invariant fhs-1): mother and
  grandmother carry born[x] (bornDate vs free-text bornString), the sister carries
  `ageRange` 40–45 with `estimatedAge: true` (fhs-2 satisfied) — surface the "estimated"
  qualifier.
- **condition.onset[x] all four variants occur**: onsetAge, onsetString ("mid-40s",
  "childhood"), onsetRange (60–65 years), onsetPeriod with **year-precision** start/end
  ("2005"–"2019") — don't assume full dates.
- **contributedToDeath: true** on the father's MI and the grandmother's stroke — render as
  cause-of-death flag, distinct from the condition list itself.
- **familymemberhistory-brother-healthunknown** is the absent-data shape: status
  `health-unknown`, **no `condition` at all**, and a resource-level `dataAbsentReason`
  (history-absent-reason `unable-to-obtain` plus human text). Render the reason, don't
  show an empty condition table silently.
- **condition.code edge cases**: code-only SNOMED coding with no display (stroke
  230690007 — fall back to `text`), text-only CodeableConcept with no coding (sister's
  asthma), and a SNOMED + ICD-10-CM translation pair (breast cancer C50.911).
- `date` (when recorded) is day-precision on every instance; notes exist at both the
  resource level and inside individual condition entries.

## Honest gaps

- `status: entered-in-error` not instantiated (see coverage.json).
- No `reasonCode`/`reasonReference`, `sex` uses only the administrative-gender codings on
  three records (not must-support).
