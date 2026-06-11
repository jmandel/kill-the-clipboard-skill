## Workflow

Ten steps. Shipped scripts own everything conformance-critical (bundle structure,
DocumentReference construction, encryption, the server protocol); you own the
conversation, the data selection, and the patient story. Don't narrate every step to
the patient — run the deterministic parts quietly and surface only the decisions that
are theirs to make.

Every script prints exactly one JSON object on stdout (progress and diagnostics go to
stderr) and exits nonzero with a usage string on failure. `create-shl.ts` and
`validate-bundle.ts` stdout shapes below are exact contracts; other examples are
representative — each script's authoritative shape is doc-commented at the top of its
file. Scripts default to the server at `{{BASE_URL}}` (a `config.json` next to the
scripts can override; an explicit URL argument wins).

### Step 1: Locate the data

Inventory what's on disk: health-skillz output directories (typically
`health-data/*.json`, one file per provider — the format is self-documenting, inspect
it), FHIR bundles, NDJSON, raw resource JSON. Glob for likely candidates and confirm
with the patient which records are theirs and current.

If there's no local data:

> "I don't see any health records on this machine. The easiest way to get them is
> health-skillz (https://health-skillz.joshuamandel.com) — it connects to your patient
> portal and downloads your records locally. Once you've done that, I can build the
> share. Or, if you have records in a file somewhere, point me at it."

**⚠️ CRITICAL: Never fabricate clinical data.** No placeholder conditions, no
"example" medications, no inferred allergies. If the patient mentions something not in
the data ("I'm also on metformin"), it does NOT become a FHIR resource — it can go in
the Patient Story, in their own words. Only resources that exist in source files go in
the bundle.

### Step 2: Help the patient decide what to share

Your job here: help the patient decide what THEY want the clinic to have. Look at
what's actually in their records and the visit they're preparing for, make a concrete
recommendation, and ask whether they'd like to share broadly or focus:

> "I can share anything from your records — you decide what the clinic sees. For
> your [neurology visit], I'd suggest a solid clinical summary — problems,
> medications, allergies, immunizations, recent vitals and labs — and then go
> deeper on what matters for this visit: [the imaging reports and consult notes
> from your head injury]. Want to share broadly like that, focus just on
> [the concussion history], or adjust?"

The general steer: **good clinical-summary content as the base, then depth where the
visit calls for it** — clinical notes you have on hand, a richer history of labs or
vitals when the trend matters, prior imaging or consults for the presenting problem.
Tailor the recommendation to what the records actually contain; never offer content
that isn't there.

While scoping, also **offer to help the patient tell their own story** (Step 4) —
what they're worried about, what they want from the visit — alongside the records.

**Inform, don't ask** for routine inclusions (e.g. "I'm including the
Patient resource with your name and birth date — the clinic needs it to match you").
Reserve actual questions for genuinely sensitive categories (mental health, substance
use, reproductive health) — flag those explicitly rather than silently including them.

### Step 3: Write the selection script

Write a small ad hoc Bun script for this session: read the source files, filter to the
agreed scope, and emit `selected-resources.json` — a JSON array of FHIR resource
objects copied **verbatim** from the source (never edit, trim, or "clean up" resource
content; never invent ids). One sanctioned exception: re-homing document content
inline, below. Include:

- Exactly one Patient resource
- Every selected clinical resource, each with `resourceType` and `id`
- Resources that selected resources reference, when available in the source
  (e.g. the Medication a MedicationRequest points to)

**Including documents (notes, imaging reports, consults).** Documents ride as
DocumentReferences whose content is **inline**: `content[].attachment = {contentType,
data: <base64>}`. Real exports almost never arrive that way — portal FHIR uses
`attachment.url` pointing at a Binary on the source server (unreachable from an
encrypted bundle; the validator rejects any `url` attachment), and health-skillz
exports strip inline data into their `attachments[]` sidecar (look for
`bestEffortPlaintext` and the original bytes there). So this is the ONE transform
you're expected to perform:

1. Find the document body you actually have locally — original bytes (PDF/RTF) if
   available, otherwise extracted plaintext.
2. **Prefer a PDF body.** PDF is the only attachment format the KTC spec guarantees
   receivers can handle. Original PDF bytes: embed as-is. Anything else (extracted
   plaintext, RTF text): render it to PDF with the skill's own tooling —

   ```bash
   bun <skill-dir>/scripts/md-to-pdf.ts note.md note.pdf --theme summary \
     --title "Neurology consult — Dr. Rivera" --date 2024-03-12
   ```

   (plaintext is fine as input — unknown markdown constructs degrade to plain
   paragraphs; spot-check with `preview-pdf.ts`). Embedding `text/plain` directly is
   legal US Core but not guaranteed-supported — use PDF when in doubt.
3. Rebuild `content` as a single attachment: `contentType` matching what you embed
   (usually `application/pdf` after step 2), `data` base64-encoded; drop every
   `url` entry.
4. Keep the rest of the DocumentReference **verbatim** — especially `type` and
   `category` codings (that's how the receiver knows what the note IS), date, and
   author display. Do NOT relabel provider-authored notes with the patient-story
   type or patient-asserted security labels: re-sharing doesn't change authorship.
   If you have no local body at all, the document can't ride along — say so rather
   than including an empty shell.

Treat the FHIR as hostile: optional-chain everything, never assume `display` strings
or `text` exist, tolerate unknown categories and extension noise. Real exports are
messy. Report what you selected ("14 conditions, 9 active medications, 3 allergies,
12 immunizations, vitals from the last year") so the patient hears the scope in plain
words.

### Step 4: Patient Story interview (offer it — it's often the most valuable part)

> "Want to add a short note in your own words? It rides along as its own page —
> things like what's been bothering you, anything in the record that's wrong or out
> of date, and what you want out of this visit. Clinics file it alongside your data."

If yes, interview briefly: current concerns, corrections to the record, context the
data can't show, goals for the visit. Then draft markdown **in the patient's own
words** — first person, their phrasing, no clinical embellishment, no invented
content. The story should not restate the discrete data (med lists, lab values); it's
for what the data can't say.

**The patient approves the text verbatim before it becomes a PDF.** Show the full
draft, incorporate edits, and only render once they've signed off on the exact words.

```bash
bun <skill-dir>/scripts/md-to-pdf.ts story.md story.pdf
```

```json
{"status":"rendered","output":"story.pdf","pages":2}
```

Visually verify, always — "it compiled" is not "it renders correctly":

```bash
bun <skill-dir>/scripts/preview-pdf.ts story.pdf
```

```json
{"status":"rendered","pages":["story-1.png","story-2.png"]}
```

Inspect the PNGs yourself (wrapping, spacing, nothing cut off), then show the patient
the PDF and get their OK before it goes in the bundle.

### Step 5: Render the FHIR-Rendered PDF

```bash
bun <skill-dir>/scripts/render-fhir-pdf.ts --resources selected-resources.json \
  -o rendered.pdf --ids-out rendered-ids.json
```

```json
{"status":"rendered","output":"/abs/path/rendered.pdf","idsOut":"/abs/path/rendered-ids.json","pages":9,"sections":[{"key":"problems","count":14},{"key":"medications","count":9}],"fallbackCount":0}
```

`fallbackCount > 0` means some resources were unrecognized types rendered through the
generic fallback — still complete, just less pretty; worth a visual spot-check.

This is the complete human-readable rendering of every selected resource — the spec
requires it to cover all of them, and `rendered-ids.json` is the coverage manifest the
validator cross-checks. Spot-check a page or two with `preview-pdf.ts`.

### Step 6: Assemble the bundle

```bash
bun <skill-dir>/scripts/assemble-bundle.ts --resources selected-resources.json \
  --story story.pdf --rendered rendered.pdf --rendered-ids rendered-ids.json \
  -o bundle.json
```

```json
{"status":"assembled","entries":45,"docRefs":2,"output":"bundle.json"}
```

Omit `--story` if the patient declined one. The script owns urn rewriting, reference
fixup, and DocumentReference construction — **never hand-build or post-edit the
bundle** (see bundle rules below).

### Step 7: Validate

**⚠️ CRITICAL: Always run `validate-bundle.ts` before `create-shl.ts`.** Never skip
it, even when assembly "looked fine".

```bash
bun <skill-dir>/scripts/validate-bundle.ts bundle.json --rendered-ids rendered-ids.json
```

```json
{"status":"pass","errors":[],"warnings":[]}
```

Exact contract: `{status: "pass"|"fail", errors: [{code, path, message}], warnings:
[...]}`; exit code 1 on any error. On failure, fix the *input* (selection, rendering,
assembly flags) and rerun the pipeline from the broken step — don't patch
`bundle.json` by hand. Loop until clean. Resolve warnings when you can; explain to the
patient any you accept.

**Expected, acceptable warnings:** `reference-unresolved` for practitioners,
organizations, encounters, and other bookkeeping the patient's curated subset
deliberately leaves out. Every curated share produces these; receivers handle
display-only references fine, and the names already appear in the readable summary.
Accept them without deliberation — they only warrant attention when the dangling
reference is to *clinical* content the patient meant to include (a Medication a
selected MedicationRequest points to, a result a report needs).

### Step 8: Create the link

First, two approvals — **⚠️ CRITICAL: get explicit approval of the story PDF and the
share scope before creating the link.** Recap exactly what's in the bundle ("your
problem list, 9 medications, 3 allergies, immunizations, last year's vitals, your
story page, and a readable summary PDF") and wait for a clear yes.

Second, craft the **label** with the patient — it's the most visible string the clinic
sees, shown wherever the link lands. ≤80 characters; lead with the patient's name and
say what/when:

- `Josh Mandel — visit summary for June 12`
- `Maria Quintana — new patient intake, Lakeside Family Medicine`
- `Sam Lee — med list + allergies for ortho consult`

```bash
bun <skill-dir>/scripts/create-shl.ts --bundle bundle.json \
  --label "Josh Mandel — visit summary for June 12" -o ./shl-out/
```

Defaults: `--exp-hours 24`, `--max-uses 5` (`--max-uses unlimited` to lift the cap),
`--flag U`. The `-o` directory must be new or empty — the script never overwrites a
previous link's artifacts; use a fresh directory per link. Defaults are deliberately
forgiving-but-bounded; mention them, don't ask ("the link works for 24 hours or 5
scans — if the visit slips, re-arming takes one command"). Exact stdout contract:

```json
{
  "status": "created",
  "id": "…",
  "label": "Josh Mandel — visit summary for June 12",
  "flag": "U",
  "exp": 1781234567,
  "maxUses": 5,
  "files": [{"contentType": "application/fhir+json", "size": 187234}],
  "artifacts": {
    "ownerLink": "/abs/path/shl-out/owner-link.txt",
    "shlink": "/abs/path/shl-out/shlink.txt",
    "viewerLink": "/abs/path/shl-out/viewer-link.txt",
    "qrPng": "/abs/path/shl-out/qr.png",
    "meta": "/abs/path/shl-out/link-meta.json"
  }
}
```

The script generates the key material, registers the link, encrypts the bundle
locally, uploads ciphertext, and writes the secret-bearing artifacts to files —
**stdout never contains the secrets, and neither should your messages** (see the
secrets section).

### Step 9: Hand off to the patient

The patient needs two things: the **QR/share link** (what the clinic scans — `qr.png`
/ `shlink.txt`) and their **owner page** (`owner-link.txt` — QR display, access log,
re-arm/pause/destroy controls, hosted at {{BASE_URL}}/s). Deliver per platform
following the secrets conventions: on a machine with a filesystem, point at the files
or open the owner page in the browser without echoing the URL; on a hosted chat, relay
the owner link once and never repeat it.

> "You're set. Your owner page is open in the browser — it shows the QR code to
> present at check-in, plus who's accessed it and buttons to extend or kill the link.
> The QR is also saved at shl-out/qr.png if you'd rather print it or save it to your
> phone's photos."

**Preview (recommended):** offer to show the patient what a recipient sees —
`viewer-link.txt` holds a viewer-prefixed copy of the link that opens a view-only
page (QR + label + expiry, no controls); the owner page's "Preview as recipient"
button opens the same thing. It's also the right link to give a family member who
should be able to *show* the QR but not manage it, and it's fine to share with anyone —
it carries the same shlink, and SHL-aware receivers handle the prefixed form.
The QR and `shlink.txt` default to the bare `shlink:/` form simply because that's
what KTC clinic scanners expect at check-in; prefer the bare form for that flow,
the viewer link wherever a human will click rather than scan.

### Step 10: Explain what happens next, and how to manage the link

Close the loop with the patient:

- **At the clinic:** they show the QR (phone screen or paper); the clinic scans it
  and sees everything the patient chose to share, filed into the chart and labeled as
  coming from the patient; a clinician may review before it appears. If the clinic
  can't scan SHLs yet, nothing is lost — check in normally.
- **Watching and managing:** everything is on the owner page — access log, re-arm,
  pause/resume, relabel, destroy. The same operations work from here:

```bash
bun <skill-dir>/scripts/manage-shl.ts ./shl-out status
bun <skill-dir>/scripts/manage-shl.ts ./shl-out log
bun <skill-dir>/scripts/manage-shl.ts ./shl-out re-arm --exp-hours 24 --max-uses 5
bun <skill-dir>/scripts/manage-shl.ts ./shl-out pause
bun <skill-dir>/scripts/manage-shl.ts ./shl-out resume
bun <skill-dir>/scripts/manage-shl.ts ./shl-out relabel "Josh Mandel — records for Dr. Chen"
bun <skill-dir>/scripts/manage-shl.ts ./shl-out replace --bundle new-bundle.json
bun <skill-dir>/scripts/manage-shl.ts ./shl-out destroy --yes
```

The first argument is the `-o` directory from `create-shl.ts` (or a path to
`owner-link.txt` directly). `re-arm` extends expiry to now + N hours and grants N
*more* uses; `destroy` demands `--yes` because it's irreversible — confirm with the
patient first. `status` emits the link state (id, label, exp, uses/maxUses, active,
`live` — i.e. serving right now — plus file metadata), e.g.:

```json
{"id":"…","url":"…","flag":"U","label":"Josh Mandel — visit summary for June 12","exp":1781234567,"maxUses":5,"uses":1,"active":true,"live":true,"purgedAt":null,"passcodeAttemptsRemaining":null,"createdAt":"2026-06-10T16:00:00Z","files":[{"fileId":"…","contentType":"application/fhir+json","size":187234,"lastUpdated":"2026-06-10T16:00:00Z"}]}
```

- **Re-arm vs pause vs destroy** (patient-meaningful distinctions): *re-arm* revives
  an expired or used-up link — the existing QR keeps unlocking it (URL and key never
  change), though its payload carries the old expiry as a display hint; the script's
  output reminds you, and the owner page always shows a freshly rebuilt QR. *Pause* is
  reversible off; *destroy* is permanent. About 30 days after expiry the server purges
  the ciphertext for good — after that, re-arming requires re-uploading
  (`replace --bundle`).
- **Visit content changed?** Update the data and `replace --bundle` — the existing QR
  stays valid because the key doesn't change.
