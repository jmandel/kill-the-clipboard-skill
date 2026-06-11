# US Core synthetic fixture corpus — style guide

Purpose: breadth-spanning sample instances for every US Core resource type so the FHIR→PDF
renderer is provably good across the space of what can occur (DESIGN.md §10). Breadth, not
depth: a small set per type that collectively exercises every must-support element, every
realistic choice-type variant, and the representation edge cases.

## The constant patient

Every instance's patient reference points at THE constant synthetic patient so any fixture
subset composes into a valid PatientSharedBundle:

- reference: `urn:uuid:00000000-b4ea-4d01-9871-000000000001`
- display: "Casey Breadth-Tester"
- demographics (in `patient/patient-constant.json`): name Casey Breadth-Tester,
  birthDate 1980-02-29, gender female, MRN identifier `BREADTH-0001`, one address, one
  telecom, US Core race/ethnicity/birthsex extensions populated, preferred language.

The `patient/` family may ALSO contain variant Patient instances (multiple names, no
address, unicode name 王秀英, data-absent birthDate, etc.) for renderer testing; those are
never referenced by other fixtures.

## Layout

```
tests/fixtures/uscore/<family>/
├── <type>-<slug>.json      one FHIR R4 resource per file (raw resource, not Bundle)
├── coverage.json           manifest (below)
└── NOTES.md                anything a renderer author must know (quirks deliberately included)
```

## Per-family requirements

1. Fetch the relevant US Core profile pages (hl7.org/fhir/us/core — record the version you
   read, prefer the current published STU) and enumerate must-support elements.
2. Across the family's instances, populate **every must-support element at least once**, and
   every choice-type variant that occurs in practice (e.g. Observation.value[x]: Quantity,
   CodeableConcept, string, boolean, integer, Ratio, time, dateTime, Period; component-only
   with dataAbsentReason; panel via hasMember).
3. Status/lifecycle variants: active/resolved, completed/stopped/entered-in-error, etc.
4. Representation edge cases somewhere in the family: code-only coding (no display),
   text-only CodeableConcept, multiple codings incl. translations, very long strings,
   unicode, multiple identifiers, contained resources, reference-by-display-only,
   extension noise that must be tolerated.
5. **Epic-inspired quirks** (from a real UnityPoint export): Observation.category values
   beyond the standard set (`Lab` alongside `laboratory`, `smartdata`, `exam`,
   `functional-status`, `disability-status`, `sdoh`), references like `Patient/eXYZ...`
   rewritten to the constant urn, display-rich codings.
6. Realistic clinical content (real LOINC/RxNorm/SNOMED/CVX codes, plausible values/dates
   2024–2026); obviously synthetic names for any practitioner/org ("Dr. Sample Renderer",
   "Breadth Test Medical Center").
7. No `meta.profile` on instances (KTC rule). All dates ISO 8601. Resource `id` =
   `<type-lowercase>-<slug>` matching the filename.

## coverage.json

```json
{
  "family": "medications",
  "uscoreVersion": "8.0.0",
  "profiles": {
    "<canonical-url>": {
      "mustSupport": ["status", "intent", "medication[x]", "..."],
      "covered": { "status": ["medicationrequest-active.json"], "...": ["..."] },
      "gaps": ["elements not covered, with reason"]
    }
  },
  "variants": { "value[x]": ["Quantity", "CodeableConcept", "..."] }
}
```

The coverage critic diffs `mustSupport` vs `covered` across all families; honest `gaps`
beat silent omission.
