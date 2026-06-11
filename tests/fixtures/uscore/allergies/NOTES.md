# allergies — renderer notes

US Core 9.0.0, profile `us-core-allergyintolerance`. 7 instances, all referencing the
constant patient urn.

Deliberate quirks a renderer must tolerate:

- **`allergyintolerance-sulfa-entered-in-error.json`** has **no `clinicalStatus`** (required
  to be absent when verificationStatus = entered-in-error, invariants ait-1/ait-2) and a
  **text-only `code`** (no coding). Renderers must not assume either is present.
- **`allergyintolerance-latex-inactive-unconfirmed.json`**: `code.coding` has **no `display`
  and no `text`** (code-only SNOMED 111088007 = latex). Renderer must degrade gracefully
  (show system+code or look up). Note contains unicode (Spanish + Chinese). `clinicalStatus`
  / `verificationStatus` codings also lack `display`.
- **`allergyintolerance-no-known-allergies.json`**: SNOMED 716186003 negation pattern — no
  category, no reaction, no criticality. Should render as "No Known Allergies", not as an
  allergy to a substance.
- **`allergyintolerance-shellfish-refuted.json`**: second coding uses an **Epic-style
  proprietary `urn:oid:` system** (display-rich); verificationStatus has a free-text
  elaboration in `.text` that differs from the coding display.
- **`allergyintolerance-peanut-active-low.json`**: unknown **extension noise** at the
  resource root (open.epic.com URL) must be ignored; `recorder.reference` points at a
  Practitioner that is **not in the corpus** (display must be used); `onsetAge` choice type;
  `lastOccurrence` present.
- **`allergyintolerance-penicillin-active-high.json`**: reaction with **3 manifestations**,
  `reaction.substance`, `reaction.onset`, `exposureRoute`, severity `severe`; `asserter` is
  the patient; very long annotation text (wrap test); code has RxNorm + SNOMED translations.
- `recorder` is display-only (no reference) in most instances.
- onset[x] variants across the family: dateTime, Age, string, absent.
