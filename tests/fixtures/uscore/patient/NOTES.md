# patient family — renderer notes

Profile read: US Core Patient, **US Core 9.0.0** (current published STU at
hl7.org/fhir/us/core, read 2026-06-10). Extension pages read: us-core-individual-sex,
us-core-interpreter-needed, us-core-tribal-affiliation, us-core-sex (deprecated).

## Instances

- `patient-constant.json` — THE constant patient (`urn:uuid:00000000-b4ea-4d01-9871-000000000001`,
  Casey Breadth-Tester). Do not modify; every other family references it. Carries the
  **deprecated** `us-core-birthsex` extension on purpose — renderers must tolerate legacy
  extensions that newer US Core versions no longer profile.
- `patient-multiple-names.json` — three names (official with suffix + period.start, maiden
  with period.end, old nickname); three identifiers (MRN, SSN, Epic-style internal ID under
  `urn:oid:1.2.840.114350...` with a **text-only** `identifier.type`); current + old address
  with `address.period`; tribal-affiliation (TribalEntityUS code 187, isEnrolled true);
  individual-sex (SNOMED 248152002).
- `patient-unicode-name.json` — CJK official name (family 王, given 秀英, text 王秀英) plus
  romanized `usual` alias; CJK character inside an address line; two `communication`
  repetitions (zh-CN coding **without display**, preferred=true; en-US preferred=false);
  interpreter-needed = Yes (SNOMED 373066001); standard FHIR `individual-genderIdentity`
  extension included as noise — US Core 9.0.0 does not profile gender identity, renderers
  must tolerate it.
- `patient-deceased.json` — `deceasedDateTime` (the USCDI SHALL form) with timezone offset;
  `active: false`; 155-character address line; **text-only** communication.language
  ("Spanish", no coding); interpreter-needed = No; `managingOrganization` is
  reference-by-**display-only** (no reference); `patient-religion` extension noise;
  ethnicity with `detailed` sub-extension.
- `patient-minimal-absent.json` — Trauma-Doe edge case: name has **no family/given/text**,
  only the `data-absent-reason` extension (satisfies invariant us-core-6); `birthDate`
  absent via primitive extension on `_birthDate` (renderers must look there); no address,
  no telecom, no communication, no race/ethnicity; `gender: unknown`; `deceasedBoolean: true`
  (boolean choice variant, no date known). Identifier system is an Epic-style raw OID urn.

## Version quirks worth knowing

- In US Core 9.0.0 `Patient.gender` is **not** must-support (0..1, no MS flag); administrative
  sex moved to the `us-core-individual-sex` extension (Coding, Federal Administrative Sex VS —
  examples use SNOMED 248152002/248153007). All instances still populate `gender` because
  real exports do.
- `deceased[x]`, telecom, name.use/suffix/period, address.use/period, communication.language
  and the five extensions are "Additional USCDI" (certification-required) rather than plain MS.
- interpreter-needed binds to the Yes/No/Unknown answer set; published example uses SNOMED
  373066001/373067005, not v2-0136 Y/N.
- us-core-6: every name needs given and/or family OR the data-absent-reason extension —
  `patient-minimal-absent.json` exercises the extension arm.
