# supporting family — renderer notes

US Core **9.0.0** profiles covered: Practitioner, PractitionerRole, Organization,
RelatedPerson, Provenance. 12 instances.

## Cross-corpus anchors (ids are load-bearing)

Other families already reference these by relative reference, so the ids here MUST not change:

- `Practitioner/practitioner-sample-renderer` (referenced from problems, medications, procedures)
- `Practitioner/practitioner-sample-hospitalist` (referenced from medications)
- `Organization/organization-breadth-test-medical` (referenced from 5+ fixtures)
- `Location/location-breadth-clinic` lives in the **encounters** family, referenced by
  `practitionerrole-cardiology`.

All NPIs are Luhn-valid with the 80840 prefix (1234567893, 1999888773, 1555666779,
1444333227) but obviously synthetic.

## Deliberate quirks a renderer MUST tolerate

- **practitioner-nurse-minimal**: bare-bones legal instance — NCSBNID identifier only,
  `name` is family-only (no given/text), qualification code is a **code-only v2-0360
  coding (`RN`, no display, no text)**, no telecom/address. Renderer needs fallback labels.
- **practitioner-sample-hospitalist**: unicode given names (José, María), **two names**
  (official + usual nickname "Pepe"), Epic-style urn:oid identifier, and an unknown
  proprietary extension (`provider-display-rank`) that must be ignored gracefully.
- **practitionerrole-pharmacist-endpoint**: satisfies pd-1 via `endpoint` (no telecom);
  the Endpoint reference is **intentionally unresolvable** — render the display string.
  `code` is **text-only**, `specialty` is a **NUCC code-only coding** (183500000X, no
  display — NUCC displays are routinely absent in Epic exports), `location` is
  **display-only** (no reference). No `practitioner` (us-core-13 satisfied by organization).
- **organization-breadth-reference-lab**: **very long name** (>120 chars) to stress
  layout; CLIA identifier under `urn:oid:2.16.840.1.113883.4.7` with a **text-only
  identifier.type**; proprietary `lab-routing-code` extension.
- **organization-breadth-health-plan**: `active: false` (terminated payer) — should not be
  presented as a current org; NAIC identifier (`urn:oid:2.16.840.1.113883.6.300`);
  **partial address** (city/state/postalCode only, no line/country).
- **relatedperson-guardian-noname**: **no name** — valid because relationship is present
  (us-core-14: name OR relationship); relationship is a **code-only GUARD coding**;
  `active: false` with a bounded `period` (former legal guardian during patient's
  childhood). Renderer must label from the v3-RoleCode code alone.
- **relatedperson-spouse**: two relationship CodeableConcepts (SPS + ECON emergency
  contact) — render both.
- **provenance-author-transmitter**: targets span families — the **constant patient by
  urn** plus relative references into problems and allergies. Author agent is a
  Practitioner with the required `onBehalfOf` Organization; transmitter agent's type
  coding uses the **US Core CodeSystem**
  (`http://hl7.org/fhir/us/core/CodeSystem/us-core-provenance-participant-type`) while the
  author uses the THO `provenance-participant-type` system — both occur in the wild.
- **provenance-patient-author-quirk**: **patient-authored** data (who = constant patient
  urn) — no onBehalfOf needed; author type carries an extra **Epic urn:oid translation
  coding** ("Patient-entered (portal)"); transmitter `who` is **display-only** ("Breadth
  Test Health Information Exchange") with no reference; `recorded` uses milliseconds +
  numeric offset; unknown `source-system` extension; optional `activity` populated.
- Provenance targets (`Condition/condition-hypertension-active`,
  `AllergyIntolerance/allergyintolerance-penicillin-active-high`,
  `MedicationRequest/medicationrequest-active-coded`,
  `Immunization/immunization-flu-completed`) resolve only when those families are loaded
  alongside this one; standalone rendering must tolerate unresolvable targets.

No `meta.profile` anywhere (KTC rule).
