# social family — renderer notes

US Core **9.0.0 (STU 9)** profiles read from hl7.org/fhir/us/core on 2026-06-10. 16 Observations +
2 QuestionnaireResponses. All subject references = constant patient urn.

## Gap-fill additions (2026-06-10)

- **observation-adi-documentation** (`us-core-observation-adi-documentation`): fixed LOINC
  45473-6, us-core-category `observation-adi-documentation`, valueCodeableConcept SNOMED
  373066001 "Yes". Carries the **`workflow-supportingInfo` extension**
  (`http://hl7.org/fhir/StructureDefinition/workflow-supportingInfo`) whose valueReference
  is a **cross-family link** to `documents/documentreference-adi-living-will.json` —
  renderers should surface the linked directive document, and must tolerate the reference
  being unresolvable when the documents family isn't loaded. Both `effectiveDateTime` and
  `issued` are present and differ by minutes; `issued` is the must-support one here.
- **questionnaireresponse-intake-numeric**: answer-type breadth. One QR exercising
  valueDate, valueDateTime, valueDecimal (2.5 — locale-safe decimal rendering),
  valueInteger, valueQuantity (UCUM kg), valueBoolean, valueString, valueReference
  (intra-family, to observation-smokingstatus-current), and valueAttachment with **inline
  base64 text/plain data and no url** (KTC rule; decoded payload is a 3-line home BP log —
  preformatted text). The `exercise` item has **items nested under the answer**
  (`answer[0].item[]`, linkIds `exercise/minutes-per-week`, `exercise/type`) — a different
  shape from the HVS group nesting (`item.item`); renderers must recurse into both.

## The HVS cluster (intentional cross-references)

Four observations and one QuestionnaireResponse form a linked Hunger Vital Sign screening
(2025-08-20). References use local relative form (`Observation/<id>`, `QuestionnaireResponse/<id>`):

```
observation-sdoh-food-insecurity-risk   --derivedFrom--> observation-sdoh-hvs-panel
observation-sdoh-hvs-panel              --hasMember----> observation-sdoh-hvs-q1, -q2
observation-sdoh-hvs-panel, -q1         --derivedFrom--> questionnaireresponse-hvs
```

- The **panel** (88121-9) deliberately has **no value** — per IG guidance the panel code carries
  meaning and `hasMember` holds the answers. Renderers must not invent a value.
- **q2** has **no value and a `dataAbsentReason`** (asked-declined). The matching QR item has
  `text` but **no `answer`** — both shapes must render gracefully.
- The QR demonstrates `_questionnaire` carrying TWO extensions (standard `display` plus the
  US Core questionnaire-uri extension). Primitive-extension (`_questionnaire`) handling is required.
- QR has a nested group item (`hvs-group`) with child items — linkIds contain `/`.

## Epic-inspired quirks (deliberate, from real-export patterns)

- **Nonstandard category codes**: `smartdata` (observation-simple-smartdata), and Epic urn-system
  codings (`urn:oid:1.2.840.114350...`) sitting **alongside** standard codings inside the same
  CodeableConcept (panel `sdoh`, functional-status, disability-status). Tolerate, don't crash,
  ideally prefer the standard coding for display.
- observation-simple-smartdata has a **text-only `code`** (no coding at all) styled like an Epic
  SmartData element label in ALL CAPS.
- observation-smokingstatus-current carries an unknown Epic-style urn extension at the resource
  root (noise; must be ignored).
- observation-sdoh-hvs-panel has **two identifiers**, one with an Epic-style urn system and
  `use: secondary`.

## Other traps

- **observation-smokingstatus-packyears is `entered-in-error`** but still carries a full
  valueQuantity (`15 {PackYears}`, UCUM annotation unit) — renderers should visibly mark or
  suppress per policy, not silently show as current data.
- observation-pregnancystatus is `amended`; observation-simple-functional-status is `preliminary`.
- observation-occupation: `effectivePeriod` with **start only** = current job (per IG); performer is
  a **contained Practitioner** (`#contained-performer`); `component:industry` (LOINC 86188-0) uses
  the ODH NAICS code system. Occupation/industry codes are the exact ones from the US Core example.
- observation-sexual-orientation: value coding has **no display** (code-only SNOMED 20430005);
  `text` carries the human-readable answer. No performer (not MS on this profile).
- Most performers/authors are **display-only references** (no `reference`), e.g.
  "Dr. Sample Renderer", "Sam Intake-Coordinator, RN";
  observation-simple-disability-status.derivedFrom is display-only too.
- observation-care-experience-preference valueString contains Spanish, CJK (家属可以陪同就诊),
  `≥ 22 °C`, guillemets, and `№` — unicode shaping test.
- observation-treatment-intervention-preference valueString is ~1500 chars — wrapping/pagination
  test.
- Preference profiles use the **US Core category code system**
  (`http://hl7.org/fhir/us/core/CodeSystem/us-core-category`), not the THO observation-category.

## Honest gaps

- Screening Assessment `hasMember` → QuestionnaireResponse target not exercised (only Observation
  members; QR linkage shown via `derivedFrom`).
- QR answer types valueTime and valueUri not exercised (all others now covered by
  questionnaireresponse-intake-numeric).
- ADI observation instantiates only the "Yes" answer; No/Unknown variants and multiple
  supporting-info extensions not repeated.
- Observation value types boolean/integer/Range/Ratio/time/dateTime/Period/SampledData don't occur
  in this family (expected from lab/vitals families).
