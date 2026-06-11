# Sanitization of the real-world UnityPoint export

`unitypoint-sanitized.json` is a masked copy of a real UnityPoint Health (Epic) patient
export, produced by `sanitize.ts` so it can be vendored as a test fixture. The raw export
contains real PHI and must never be committed (see CLAUDE.md); only the sanitized output
and this tooling belong in the repo.

## Method

1. **Structured harvest.** The script reads the Patient resource (every name part and
   `name.text`, telecom values, all identifier values, address lines / city / district /
   postal code, `contact` names + telecoms) plus the Coverage identifiers/subscriberId and
   the top-level `patientDisplayName` / `patientBirthDate`.
2. **Variant expansion.** Each harvested value is expanded into matching variants:
   case-insensitive, word-boundary-guarded; phones in 16 formats (`555-123-4567`,
   `(555) 123-4567`, `5551234567`, `+1 555-123-4567`, …, plus last-7 forms `123-4567` /
   `1234567`); names in all first/middle/last combinations (`First M Last`, `Last, First`,
   `LAST,FIRST`, first-only, last-only); DOB in ISO, `M/D/YYYY`, `M/D/YY`, `D/M/YYYY`,
   zero-padded, digits-only (`YYYYMMDD`, `MMDDYYYY`, `MMDDYY`), spelled-month (with and
   without comma), and `D-Mon-YYYY` forms; emails plus their local part.
3. **Supplemental free-text harvest.** All 51 `attachments[].bestEffortPlaintext` bodies
   and every FHIR narrative/note were read by a human-in-the-loop pass; PII visible only
   in free text was recorded as `{token, variant}` rules in a supplemental file that
   lives NEXT TO THE RAW EXPORT, outside this repo
   (`<input>.supplemental-pii.json`, or `--supplemental <path>`) — the values themselves
   must never appear in repo files, including the script.
4. **Masking.** Every variant is replaced (longest-first) in **every string in the JSON
   tree** — structured fields, `text.div` narratives, `note.text`, attachment plaintext —
   with a stable token. Structured `birthDate`/`patientBirthDate` are set to `1980-01-01`.
5. **Stripping.** Every `attachments[].originals` array (base64 + html/rtf/xml renditions
   of each document) is replaced wholesale with the literal string
   `"[STRIPPED-NON-PLAINTEXT]"`, and any FHIR `attachment.data` (none present in this
   export) would be replaced the same way. This guarantees no PII survives inside
   encodings the masker cannot read. The DocumentReference `content[].attachment.url`
   Binary references are opaque server paths and are retained.
6. **Self-check.** The script asserts per-type FHIR resource counts are identical before
   and after, then re-scans the serialized output for **every** harvested variant and
   exits nonzero on any hit. The committed fixture was produced from a clean run
   (residual scan: 0 hits; 1,428 replacements across 112 variants; 51 originals stripped).

## Token glossary

| Token | Meaning |
|---|---|
| `[PATIENT-FULL]` | Any full-name combination of the patient (incl. `Last, First` forms) |
| `[PATIENT-FIRST]` | Patient given name (either spelling, and the free-text middle name) |
| `[PATIENT-LAST]` | Patient family name |
| `[DOB]` | Patient birth date in any textual format (structured value forced to `1980-01-01`) |
| `[PHONE-1]`, `[PHONE-2]` | Patient home / mobile phone |
| `[PHONE-3]` | Emergency-contact (spouse) phone |
| `[EMAIL]` | Patient email addresses and their local part (which is also the MyChart login) |
| `[ADDRESS-LINE]` | Patient street address line |
| `[CITY]` | Patient home city **and** county (district); see limitations |
| `[ZIP]` | Patient postal code (5- and 9-digit forms) |
| `[MRN-1..16]` | Patient identifier values: APL, CEID, EPI, EXTERNAL/INTERNAL, DSTU2 FHIR id, STU3 FHIR id (= `Patient.id`, so all `Patient/...` references are `Patient/[MRN-6]`), IHSMRN, WPRINTERNAL, payer member number, Coverage identifiers/subscriberId, and the Coverage FHIR resource id (`[MRN-16]`). Numbering has gaps where duplicate values deduplicated; the MyChart login deduplicated into `[EMAIL]` |
| `[FAMILY-NAME-1]` | Spouse / emergency-contact name (from `Patient.contact`) |
| `[CONTACT-EMPLOYER]` | Patient employer (structured `contact` + free text) |
| `[CONTACT-EDU-1]`, `[CONTACT-EDU-2]` | Schools the patient attended (free text only) |
| `[STRIPPED-NON-PLAINTEXT]` | Replaces each `attachments[].originals` array (base64/html/rtf/xml) |

## Supplemental tokens (free-text-only PII; tokens, not values)

- `[PATIENT-FULL]` / `[PATIENT-FIRST]` — the patient's spelled-out middle name appears in
  one OT evaluation note but only as an initial in structured data.
- `[CONTACT-EMPLOYER]` — employer named throughout social-history narratives.
- `[CONTACT-EDU-1]`, `[CONTACT-EDU-2]` — two schools named in an OT evaluation note.

Family members are referenced in notes only by kinship (wife, daughter, brother, …) with
no names; the only named non-clinician contact is the spouse, harvested from the
structured `Patient.contact` (→ `[FAMILY-NAME-1]`, `[PHONE-3]`).

## Stripped vs masked

- **Stripped** (`[STRIPPED-NON-PLAINTEXT]`): all `attachments[].originals` — base64
  bodies and html/rtf/xml note renditions. (`bestEffortFrom` indexes into the removed
  array and is now vestigial.)
- **Masked** (tokens above): all other occurrences, including `bestEffortPlaintext`.
- **Kept**: all clinical content, all dates except DOB, practitioner/organization/staff
  names, NPIs, clinic addresses and phone/fax numbers, insurance plan names, state and
  country.

## Known limitations

- Masking `[CITY]`/county hits provider addresses too (e.g. clinic addresses read
  `[CITY], WI 53705`) — deliberate over-masking, mildly lossy for display fidelity.
- Quasi-identifiers survive in narrative: profession, state of origin, travel anecdotes,
  encounter dates, provider identities, insurance plan. The fixture is de-identified
  against direct identifiers, not k-anonymized; treat it as sensitive-but-shareable test
  data, not a public dataset.
- Mask tokens contain `[`/`]` in fields with FHIR-constrained types (ids, dates inside
  text); consumers must treat the fixture as hostile input (per CLAUDE.md they must
  anyway).
- The residual scan only proves absence of *harvested* variants; a novel spelling of a
  name (e.g. an OCR typo) would escape it. The full free-text read in step 3 is the
  mitigation — repeat it if the raw export is ever re-fetched.

## Re-running

```sh
bun tests/fixtures/real-world/sanitize.ts /path/to/health-records.json
# expects /path/to/health-records.supplemental-pii.json beside the input
# (or pass --supplemental <path>); warns and proceeds without it
# stdout: JSON report (replacement counts, resource counts, residual scan)
# exits nonzero if the residual scan or resource-count check fails
```

## Adversarial audit (2026-06-10)

An independent adversarial pass compared the committed fixture against the raw export,
treating the sanitizer as untrusted.

Attacks run:

1. **Exhaustive PII grep.** Every identifier harvested directly from the raw export
   (all four patient name forms incl. the `LAST,FIRST` and `Last, First M` permutations,
   the free-text middle
   name, spouse first/last name, both patient phones + spouse phone in full / 10-digit /
   last-7 forms, both emails + local part, street line and street name alone, 5- and
   9-digit ZIP, DOB in 12 textual/digit formats, all 12 Patient identifiers, Coverage
   identifiers/subscriberId/resource id, employer, both schools) was searched in the
   sanitized file in three projections: raw lowercase, whitespace-collapsed, and
   punctuation-stripped (defeats `S m i t h`-style letter-spaced names and bare
   last-7 phone fragments).
2. **Encoded-blob scan.** Searched for any `[A-Za-z0-9+/=_-]` run ≥ 200 chars (base64
   smuggling). Zero found — all `attachments[].originals` are the literal
   `"[STRIPPED-NON-PLAINTEXT]"`.
3. **Markup-residue scan.** `<html`, `{\rtf`, `<?xml`, `<body`, `&lt;html`,
   `<html`: zero hits. Remaining `text/html` / `text/rtf` strings are bare
   `mimeType` metadata values; the 7 `<div>`s (and 1 `<table>`) are the four retained,
   masked FHIR `text.div` narratives.
4. **Free-text spot reads.** 10 random `bestEffortPlaintext` bodies and all narrative
   `text.div`s read for names near kinship words, plus an automated
   capitalized-word-near-kinship scan over **all** strings in both files: family members
   appear by kinship only ("wife", "Lives with partner", "Spouse name: Not on file");
   the only surviving proper name near kinship context is a clinician (kept by policy).
5. **Structural integrity.** JSON parses; per-type FHIR resource counts identical to the
   original (23 types, e.g. 322 Observation / 53 Condition / 51 DocumentReference);
   all 17 token families present; 51 stripped originals; structured birthDate forced to
   `1980-01-01`.

**Finding (fixed):** one leak — the Coverage FHIR **resource id**
(an Epic server-resolvable id tied to the patient) survived at
`fhir.Coverage[0].id`. `sanitize.ts` harvested `Coverage.identifier[].value` and
`subscriberId` but not `Coverage.id`, despite the glossary claiming "Coverage ids".
Fix: harvest `cov.id` (→ `[MRN-16]`). Hardening from the same pass: phone variant
generation extended with last-7 forms, and DOB with `M/D/YY`, `D/M/YYYY`, `YYYYMMDD`,
`MMDDYYYY`, `MMDDYY`, `D-Mon-YYYY`, and comma-less spelled-month forms, so the built-in
residual scan now covers every variant the audit tested. The fixture was regenerated
(1,428 replacements across 112 variants, residual scan 0 hits) and the full attack
suite re-run against the new output: **zero hits — verdict CLEAN**.
