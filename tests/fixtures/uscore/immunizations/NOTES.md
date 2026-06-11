# immunizations — renderer notes

Profile: US Core Immunization (US Core **9.0.0**, current published STU read 2026-06-10).
Must-support: status, statusReason, vaccineCode, patient, encounter, occurrence[x]
(dateTime | string), primarySource, location, lotNumber, performer, performer.actor.

## Instances

| file | status | what it exercises |
|---|---|---|
| `immunization-flu-completed.json` | completed | The "everything" instance: encounter + location (display-only refs), lotNumber, expirationDate, site/route/doseQuantity, two performers (contained Practitioner via `#performer-practitioner`, plus display-only ordering provider), identifier, Epic-style extension noise (`open.epic.com/.../immunization-data-source`) the renderer must tolerate. |
| `immunization-covid-completed.json` | completed | vaccineCode with **CVX + NDC translation codings** (us-core-5 SHOULD pattern), date-only occurrenceDateTime, absurdly long lotNumber, unicode in `note`, display-only Organization performer with no `function`. |
| `immunization-tdap-historical.json` | completed | **occurrenceString** ("Late summer 2024…"), **primarySource: false + reportOrigin** (`recall`), multiple identifiers, deliberately sparse otherwise (historical/self-reported records carry no lot/site/performer). |
| `immunization-flu-not-done.json` | not-done | **statusReason** (v3-ActReason `PATOBJ` + text). vaccineCode is a **code-only coding** (CVX 88, no display, no text) — renderer must not crash on missing display. occurrenceDateTime here is the date the refusal was recorded. |
| `immunization-hepb-entered-in-error.json` | entered-in-error | **Text-only vaccineCode** (no coding at all). Renderers should visibly distinguish or suppress entered-in-error records. |

## Quirks deliberately included

- Patient reference is always `urn:uuid:00000000-b4ea-4d01-9871-000000000001` / "Casey Breadth-Tester".
- `encounter` and `location` are **display-only References** (no `reference`) — common in Epic exports after reference scrubbing.
- Contained-resource performer referenced as `#performer-practitioner`.
- occurrenceDateTime varies in precision: full timestamp with offset vs date-only.
- Site/route use v3-ActSite (`LA`/`RA`) and v3-RouteOfAdministration (`IM`) per the standard FHIR R4 example bindings; route appears once coding-only and once coding+text.
- `not-done` semantics: per the base spec, occurrence[x] is still required even when the vaccine was not given.
- No `meta.profile` anywhere (KTC rule).

## Honest gaps

- `encounter`/`location` never resolve to real Encounter/Location instances (display-only only) — corpus has no constant Encounter/Location to point at.
- protocolApplied / doseNumber, reaction, education, fundingSource not exercised (not must-support in US Core 9.0.0).
