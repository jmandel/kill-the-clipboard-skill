# procedures family — renderer notes

US Core **9.0.0** (current published STU, fetched 2026-06-10 from
hl7.org/fhir/us/core): us-core-procedure, us-core-servicerequest.

9 instances: 6 Procedure + 3 ServiceRequest. All `subject` references point at the
constant patient urn. No `meta.profile` anywhere (KTC rule).

## Deliberate quirks the renderer must tolerate

- **procedure-colonoscopy-completed**: dual CPT+SNOMED coding with very long CPT
  display string; Epic-style second identifier under a local `urn:oid:1.2.840.114350...`
  system with value `eProcQuirk.8842`; `basedOn` is an intra-family relative reference to
  `ServiceRequest/servicerequest-colonoscopy-completed`; `encounter` is display-only
  (no reference); multi-sentence long `note.text`.
- **procedure-appendectomy-period**: SNOMED-only code; `performedPeriod` with start+end;
  two performers (one with `function` text-only, one with `onBehalfOf`); `reasonReference`
  is display-only with no `reference` element.
- **procedure-dialysis-inprogress**: `code.coding` has **no display** (code-only SNOMED
  302497006 = Hemodialysis); open-ended `performedPeriod` (start only); unknown extension
  noise at resource level; CJK unicode inside a note.
- **procedure-cardiaccath-notdone**: `status: not-done` with `statusReason`; **text-only**
  `code` (no coding array) — legal because the binding is extensible; no `performed[x]`
  (constraint us-core-7 only mandates it for completed/in-progress); reasonCode carries a
  SNOMED + ICD-10-CM translation pair.
- **procedure-tonsillectomy-childhood-age** (gap-fill 2026-06-10): `performedAge`
  (7 years, UCUM `a`) — render as "at age 7", never as a date; SNOMED+CPT dual coding;
  `asserter` is the **constant patient** (self-reported history), no performer/encounter.
- **procedure-cholecystectomy-string** (gap-fill 2026-06-10): `performedString`
  ("Late 2019, while living overseas — exact date unknown", contains an em-dash) — render
  the string verbatim, never parse it as a date; `recorder` practitioner + `asserter`
  patient; text-only reasonCode.
- **servicerequest-colonoscopy-completed**: date-precision `occurrenceDateTime`
  ("2024-09-17", no time) — renderers must not assume full timestamps.
- **servicerequest-pt-active**: `occurrenceTiming` with `boundsPeriod` + frequency/period
  ("twice weekly for 8 weeks"); two `orderDetail` entries (one text-only, one CPT-coded);
  `quantityQuantity` 12 sessions; `patientInstruction`.
- **servicerequest-mri-revoked**: status `revoked` (lifecycle breadth beyond
  active/completed); duplicate-looking category list — standard SNOMED Imaging **plus** an
  Epic-style local-oid category with code `Imaging`; LOINC+CPT dual-coded order code;
  text-only reasonCode.

## Reference resolution

Only the colonoscopy `basedOn` link resolves within this family. Encounters,
conditions, practitioners, and performing organizations are display-only references on
purpose; resolvable instances belong to their own families.

## Honest gaps

- performedRange not represented (performedString/performedAge added 2026-06-10; Range has
  no realistic export source — imprecision shows up as string or age in practice).
- `Procedure.focalDevice` (SHOULD-level, implantables) not represented here.
