# medications family — renderer notes

US Core **9.0.0** (STU 9, FHIR R4) profiles read from hl7.org/fhir/us/core on 2026-06-10:
us-core-medicationrequest, us-core-medication, us-core-medicationdispense.

## Instance map

| file | what it stresses |
|---|---|
| medicationrequest-active-coded.json | active/order, RxNorm CodeableConcept, full structured sig (timing.boundsPeriod, route+text, doseQuantity), reportedBoolean false, requester **display-only**, encounter display-only, two identifiers (incl. Epic OID-system identifier), full dispenseRequest (repeats 3, quantity, validityPeriod, expectedSupplyDuration, performer) |
| medicationrequest-stopped-contained.json | stopped + statusReason, **medicationReference to a contained Medication** (`#med-contained-amoxicillin`, RxNorm + NDC codings), reportedReference → constant patient urn, **free-text-only sig** (no structured dosage elements), Epic-style unresolvable requester `Practitioner/eM5CWtq15N0WJeuCet5BJlQ3` with display, extension noise (`ordering-mode`) that must be tolerated |
| medicationrequest-onhold-plan-external.json | on-hold, **intent plan**, medicationReference → `Medication/medication-metformin-er` (separate fixture in this directory), category with Epic local translation coding, route as **code-only coding (no display)**, timing with GTSAbbreviation BID + repeat.when, note |
| medicationrequest-completed-longsig.json | completed, **text-only medicationCodeableConcept** (compounded "Magic Mouthwash", no coding), reportedBoolean true, sig of **exactly 250 characters**, doseRange, asNeededCodeableConcept, text-only category, date-precision authoredOn, repeats 0 |
| medication-metformin-er.json | standalone US Core Medication; code has RxNorm + NDC + Epic local OID coding (display-rich), form. Target of the two external medicationReferences |
| medicationdispense-completed.json | completed fill: type FF, quantity 30 {tbl}, **daysSupply 30 d**, whenPrepared + **whenHandedOver**, authorizingPrescription → medicationrequest-active-coded, performer.actor display-only org, context display-only, full structured sig |
| medicationdispense-inprogress-external.json | in-progress (no whenHandedOver — legitimate for this status), medicationReference → external Medication fixture, type RF as code-only coding, authorizingPrescription **display-only**, Epic-style `Practitioner/e...` performer.actor, **Spanish unicode sig** (free-text-only), extension noise |

## Quirks deliberately included (do not "fix")

- Patient is always `urn:uuid:00000000-b4ea-4d01-9871-000000000001` / "Casey Breadth-Tester".
- Epic-style references (`Practitioner/eM5CWtq15N0WJeuCet5BJlQ3`, `Practitioner/ePHARM8xQ2v0WJeuCet5XYZ9`) do **not** resolve to any fixture; render from `display`.
- `Medication/medication-metformin-er` and `MedicationRequest/medicationrequest-active-coded` are intra-corpus relative references that DO resolve to files in this directory.
- Mixed coding hygiene on purpose: code-only codings (no display), text-only CodeableConcepts, multi-coding translations (RxNorm + NDC + local OID), coding-only category without text.
- `{tbl}` is a UCUM annotation unit; render the human `unit` string.
- Unknown extensions (`ordering-mode`, `queue-position`) must be tolerated/ignored.
- No `meta.profile` anywhere (KTC rule); resource ids equal filenames.

## Honest gaps

- MedicationDispense `whenHandedOver` absent on the in-progress fixture by design (covered by the completed one).
- No `entered-in-error`/`cancelled` statuses (breadth budget; status rendering is exercised by four MedicationRequest + two MedicationDispense statuses).
- No MedicationRequest.basedOn / priorPrescription, and no Medication.batch — not must-support in US Core 9.0.0.
