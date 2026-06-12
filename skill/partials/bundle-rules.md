## Bundle Rules (what conformance means here)

**The scripts own conformance — never hand-build DocumentReferences, never hand-edit
`bundle.json`.** `assemble-bundle.ts` produces the conformant structure and
`validate-bundle.ts` proves it. You need these rules only to understand validator
findings and to keep your selection script honest.

**PatientSharedBundle** (the KTC profile of Bundle):

- `type: collection`, `timestamp` required
- ≥2 entries: exactly **one Patient** plus at least one content entry (multi-source
  exports: merge to one Patient per workflow Step 3 — the patient reviews the merged
  demographics)
- Every `fullUrl` is `urn:uuid:...`; every intra-bundle reference is rewritten to
  those urns — no dangling or external references
- Resources should NOT carry `meta.profile`
- The Patient needs matching demographics: name, birthDate, gender at minimum —
  if your selected Patient lacks these, the clinic can't match the share to a chart
- Discrete resources are US Core types

**PatientSharedDocumentReference** (wraps each of the two PDFs):

- `status: current`; `category` includes the `patient-shared` code; `subject` and
  `author` both point at the bundle's Patient urn; `date` required; `meta.security`
  carries PATAST (patient-asserted provenance)
- `type` distinguishes the kinds — **LOINC 51855-5** "Patient Note" = the Patient
  Story PDF; **LOINC 60591-5** "Patient summary Document" = the FHIR-Rendered PDF,
  which must cover EVERY non-DocumentReference resource in the bundle (that's what
  `rendered-ids.json` proves)
- `content.attachment.contentType: application/pdf` with **inline base64 `data`**

**Attachments are ALWAYS inline `data`, never `url`** — anywhere in the bundle,
including any extra DocumentReferences the patient asked to carry along (e.g. a note
from their record). A `url` attachment points at something the receiver can't reach
from an encrypted offline bundle; the validator rejects it as an error. Carried-along
documents keep their **source format** (PDF/HTML/RTF/text ride as their original
bytes with their original `contentType` — never transcoded); only the two
patient-shared PDFs above are required to be `application/pdf`. Source documents
rarely arrive inline — the re-homing recipe is in Step 3 of the workflow.

**The SHL payload itself** (built by `create-shl.ts`): `exp` required, flag `U`,
label ≤80 chars, no passcode, single encrypted file of type `application/fhir+json`.
If `create-shl.ts` rejects your label or expiry, that's the spec talking.
