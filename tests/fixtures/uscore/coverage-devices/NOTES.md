# coverage-devices — renderer notes

US Core version: **9.0.0** (current published STU, generated 2026-05-31), profiles read from
hl7.org/fhir/us/core on 2026-06-10:

- `us-core-coverage` — page reports IG 9.0.0.
- `us-core-implantable-device` — the rendered page header showed 8.0.1 (likely a stale build
  artifact on hl7.org); its must-support element set is identical across STU 7/8/9, so the
  enumeration below is safe either way.

## Instances (6)

| File | Purpose |
|---|---|
| coverage-employer-ppo.json | active, self, SOP 512 PPO, memberid + Epic filler identifier, subscriberId, full period, class group+plan (both with value+name), payor by display only |
| coverage-spouse-cancelled.json | cancelled, spouse (code-only coding), **text-only** `type`, subscriberId only (satisfies us-core-15 without a memberid identifier), subscriber reference-by-display-only, plan class without name |
| coverage-medicare-contained-payor.json | active Medicare, MBI memberid identifier (`http://hl7.org/fhir/sid/us-mbi`), open-ended period (start only), **contained Organization payor** (`#cms-payor`), top-level extension noise |
| device-pacemaker-active.json | the everything-device: full GS1 UDI (DI + HRF + issuer + jurisdiction + entryType), distinctIdentifier, manufacture/expiration dates, lot + serial, type with SNOMED **plus Epic-style display-rich local coding** (`urn:oid:1.2.840.114350...`) |
| device-hip-prosthesis-inactive.json | inactive (explanted), udiCarrier with **deviceIdentifier only, no carrierHRF** (legacy-import pattern), lot but no serial, second `type` coding is code-only (no display), long narrative `note`, extension noise |
| device-insulin-pump-active.json | HIBCC-issued UDI with HRF, entryType `manual`, serial + expiration but no lot/manufactureDate, unicode manufacturer name (Bösch), deviceName user-friendly + model-name, firmware `version` |

## Quirks deliberately included (do not "fix")

- `Coverage.payor` is frequently a **display-only Reference** (no `reference`) — real Epic
  exports do this; the renderer must show the payer name without resolving anything.
- `coverage-medicare-contained-payor` resolves its payor to a **contained** Organization
  (`#cms-payor`).
- `coverage-employer-ppo` carries a second identifier with an Epic-style `urn:oid:` system
  and a type coding renderers won't recognize (`FILL`).
- `coverage-spouse-cancelled.type` has **no coding, text only**; its `relationship` coding
  has **no display** — render from code or text fallback.
- Pacemaker `type` second coding has a verbose, ALL-CAPS, bracketed display (Epic
  display-rich style); the SNOMED coding is first and preferred.
- carrierHRF strings are long, unbroken, parenthesis/symbol-heavy (`(01)...(21)...`,
  HIBCC `+B1XCRT...$$...`); renderers must wrap, not truncate, and must NOT attempt to
  parse them.
- `distinctIdentifier` appears only on the pacemaker (it is MS but rare in the wild).
- Extension noise at resource level on one Coverage and one Device must be tolerated/ignored.
- All patient references are the constant urn `urn:uuid:00000000-b4ea-4d01-9871-000000000001`.

## Honest gaps

- `Device.status` `entered-in-error` not exercised (variants asked only active vs inactive).
- `udiCarrier.carrierAIDC` (base64 AIDC form) omitted — not must-support, rarely exported.
- Coverage `class` slices other than group/plan (subgroup, rxbin, rxpcn...) not included —
  not must-support in US Core.
