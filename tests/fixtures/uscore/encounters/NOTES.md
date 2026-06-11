# encounters family — renderer notes

US Core **9.0.0** (current published STU at time of authoring; profile pages
`StructureDefinition-us-core-encounter` and `StructureDefinition-us-core-location` fetched
2026-06-10). 6 Encounter + 2 Location instances.

## Deliberate quirks a renderer must tolerate

- **encounter-cancelled-minimal.json** — sparse: no identifier/participant/location/
  serviceProvider; `class` and `type` codings have **no display**; `period.start` is a
  bare date (`2024-11-03`), not a dateTime.
- **encounter-epic-quirk-telehealth.json** — Epic-inspired: identifier with `use: usual`
  and `urn:oid:1.2.840.114350...` system; `type` and `reasonCode` carry proprietary
  Epic urn:oid codings alongside CPT/SNOMED translations; participant has **no type**
  and references `Practitioner/eTOf4r2-SAMPLE-EPIC-ID-x3` (Epic-style id, no fixture
  exists — render from display); participant display contains unicode
  (Sánchez-Müller, 家庭医学); `location.location` and (very long, ALL-CAPS)
  `serviceProvider` are display-only references; class is `VR` (virtual), outside the
  AMB/EMER/IMP staples.
- **encounter-emer-discharge.json** — `reasonCode` is **text-only** (no coding);
  `reasonReference` is **display-only**; `serviceProvider` display-only;
  dischargeDisposition `home`.
- **encounter-in-progress-no-end.json** — open encounter: `period`/`participant.period`/
  `location.period` have start but **no end**; carries the US Core
  `us-core-interpreter-needed` extension (valueCoding LOINC LA33-6 "Yes") plus an
  **unknown proprietary extension** that must be ignored gracefully; very long
  reasonCode.text for wrap testing.
- **encounter-imp-hospitalization.json** — multiple identifiers (one urn:oid with
  v2-0203 `VN` type), `meta.lastUpdated`, two participants (one without period),
  second reasonCode coding without `text`, dischargeDisposition `snf` with long
  NUBC-style text, `location.period` populated.
- **location-breadth-hospital.json** — repeating `type` (HOSP + SNOMED translation,
  then ER), zip+4 postal code, unicode alias, **display-only managingOrganization**,
  second identifier is an NPI.

## Cross-references

- All `subject` references are the constant patient urn
  (`urn:uuid:00000000-b4ea-4d01-9871-000000000001`).
- `Location/location-breadth-clinic` and `Location/location-breadth-hospital` resolve
  within this family. Practitioner/Organization/Condition targets do **not** resolve
  here (owned by other families or intentionally display-only) — renderers must fall
  back to `reference.display`.

## Coverage gaps (honest)

- `reasonReference` never points at a resolvable Condition fixture.
- `Location.status` only exercises `active`.
