# vitals family — renderer notes

US Core **9.0.0** (current published STU, FHIR R4) profile pages read on 2026-06-10:
us-core-vital-signs, us-core-blood-pressure, us-core-average-blood-pressure,
us-core-pulse-oximetry, pediatric-bmi-for-age,
head-occipital-frontal-circumference-percentile (plus the simple per-vital profiles).
LOINC 77606-2 for pediatric weight-for-height is from the profile's fixed code (verified
against LOINC; the IG page fetch did not echo it directly).

15 instances. Deliberate quirks a renderer must tolerate:

1. **Constant-patient rule wins over clinical plausibility.** The three pediatric
   percentile observations (59576-9, 77606-2, 8289-1) and the head circumference are dated
   2024 on a patient born 1980. Renderers must not crash or "fix" this; age-gating is out
   of scope for fixtures.
2. **Blood pressure has NO top-level value** (`observation-bp`, `observation-avg-bp`):
   values live only in components, per profile guidance. `observation-avg-bp` additionally
   has a component whose only payload is `dataAbsentReason` — render the reason text, not
   a blank.
3. **`observation-temperature-dar`** is `entered-in-error` with a top-level
   `dataAbsentReason` and no value. Renderers should visibly mark entered-in-error rows.
4. **`observation-heart-rate.code`** is a code-only coding: no `display`, no `text`.
   Renderer needs a fallback label (LOINC 8867-4).
5. **Quantity `unit` strings diverge from UCUM `code`** on purpose: `beats/minute` vs
   `/min`, `breaths/minute` vs `/min`, `liters/min` vs `L/min`, `lb` vs `[lb_av]`, `C` vs
   `Cel`. Prefer the human `unit` when present.
6. **Epic-isms:** second category CodeableConcept with an `urn:oid:1.2.840...` system
   (`observation-bp`), an extra display-rich category coding inside the VSCat concept
   (`observation-temperature`), an Epic-style identifier system + opaque value on the
   panel, and an unknown root extension on `observation-respiratory-rate`
   (`https://open.epic.com/fhir/extensions/row-source`) that must be silently tolerated.
7. **Panel** (`observation-vitals-panel`, LOINC 85353-1): no value, no dataAbsentReason —
   legal because `hasMember` is present. Members reference sibling fixtures by relative
   `Observation/<id>`; one member is **display-only** (no reference). When fixtures are
   bundled with urn:uuid fullUrls these relative references will dangle — render the
   `display` string in that case. Same applies to `derivedFrom` on `observation-bmi` and
   `observation-head-circumference-percentile`.
8. **Contained performer**: `observation-bp.performer` points at `#practitioner-inline`.
9. **Long + unicode text**: `observation-weight.note[0]` is a multi-sentence wrap/pagination
   stressor with `authorString` and `time`; `observation-temperature.note[0]` mixes Spanish
   and Japanese.
10. **Pulse oximetry code** carries BOTH required LOINC codings (2708-6 and 59408-5);
    don't render it as two observations. Its concentration component has
    `dataAbsentReason: not-performed` while flow rate is valued (2 L/min).
11. Statuses span final / amended / preliminary / entered-in-error. effective[x] spans
    dateTime-with-offset, date-only dateTime, and Period (avg BP home-reading window).

Honest gaps (also in coverage.json): no [degF]/[in_i]/kg/g unit variants (one unit per
profile instance, varied across the family); BP-profile component dataAbsentReason shown on
sibling profiles instead; pulse-ox concentration component never valued; non-Quantity
Observation.value[x] choice types intentionally left to the lab family because every
concrete vitals profile fixes valueQuantity.
