## Workflow

Eight steps. Shipped scripts own everything conformance-critical (bundle structure,
DocumentReference construction, encryption, the server protocol); you own the
conversation, the data selection, and the patient story. Don't narrate every step to
the patient — run the deterministic parts quietly and surface only the decisions that
are theirs to make.

**Interaction style (soft guideline):** when your platform offers structured
multiple-choice questions, prefer them for the decision points — share scope
(broad / focused / adjust), label choice, expiry/uses, final "build it?" — rather
than stretching each decision across open conversational turns. Always include an
escape option ("something else / let me explain"), and switch to free conversation
whenever the patient wants more — and always for the deeper moments, above all the
story interview (Step 4), which is the patient talking, not the patient choosing.
In general: make reasonable guesses and state them ("I'm using the records in
health-data/, exported June 8") — reserve questions for the share scope, sensitive
content, and the final approval.

**Who writes what, who runs what:**

```
YOU WRITE (per session, ad hoc)        YOU RUN (shipped, conformance-critical)
───────────────────────────────        ─────────────────────────────────────────────
select.ts — read the source files,     md-to-pdf.ts          story.md → story.pdf
  filter to the agreed scope, set        (the Patient Story you drafted)
  meta.source per resource, inline     assemble-bundle.ts    selection + story PDF →
  document bodies (original bytes,       bundle.json (+ automatic summary PDF)
  original formats), emit              validate-bundle.ts    bundle.json → pass/fail
  selected-resources.json              create-shl.ts         bundle.json → links
That's the ONLY code you write.        manage-shl.ts         status/log/re-arm/…
Everything else is running the
shipped tools in this order:           select → md-to-pdf (story) → assemble → validate → create
```

Every script prints exactly one JSON object on stdout (progress and diagnostics go to
stderr) and exits nonzero with a usage string on failure. `create-shl.ts` and
`validate-bundle.ts` stdout shapes below are exact contracts; other examples are
representative — each script's authoritative shape is doc-commented at the top of its
file. Scripts default to the server at `{{BASE_URL}}` (a `config.json` next to the
scripts can override; an explicit URL argument wins).

### Step 1: Locate the data

Inventory what's on disk: health-skillz output directories (typically
`health-data/*.json`, one file per provider — the format is self-documenting, inspect
it), FHIR bundles, NDJSON, raw resource JSON. Glob for likely candidates. If exactly
one plausible source exists, use it and say so — don't ask; confirm only when sources
genuinely conflict.

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
> your [cardiology visit], I'd suggest a solid clinical summary — problems,
> medications, allergies, immunizations, recent vitals and labs — and then go
> deeper on what matters for this visit: [the echo reports and consult notes
> from your arrhythmia workup]. Want to share broadly like that, or focus on
> [the heart-rhythm history] plus the basics every clinic needs (your allergies,
> current meds, and active problems), or adjust?"
>
> ("Focused" is a smaller share, never an unsafe one — the focused option you
> offer ALWAYS spells out that allergies, current meds, and active problems
> still ride along.)

**Always include the safety-critical core: allergies, current medications, and
active/relevant problems — in every share, regardless of focus, unless the patient
specifically asks to leave something out.** A clinic acting on a "focused" share
without the allergy list or med list can prescribe into an interaction or
contraindication it had no way to see. So even when the patient picks "focus just on
the heart-rhythm history," the focused share still carries allergies + current meds +
the problems relevant to the visit; treat that as the floor you inform about ("I'm
including your allergies and current medications — clinics need those for safe
prescribing"), not a question. If the patient asks to drop one of these, honor it —
it's their share — but confirm explicitly rather than inferring it from a focus
choice.

The general steer beyond that core: **good clinical-summary content as the base,
then depth where the visit calls for it** — clinical notes you have on hand, a
richer history of labs or vitals when the trend matters, prior imaging or consults
for the presenting problem. Tailor the recommendation to what the records actually
contain; never offer content that isn't there.

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
- **The safety-critical core, even in a focused share**: every AllergyIntolerance,
  every current/active medication (MedicationRequest + the Medications they
  reference), and active/relevant Conditions. Omit one of these ONLY if the patient
  explicitly asked to drop it — a "focused" scope choice is not that ask.
  (`validate-bundle.ts` warns when a family is absent; be ready to explain why.)
- Every selected clinical resource, each with `resourceType` and `id`
- Resources that selected resources reference, when available in the source
  (e.g. the Medication a MedicationRequest points to)
- **`meta.source` on every resource, when you know the provenance** — the FHIR
  endpoint each record came from, as a resource-specific URL when possible
  (`https://fhir.example.org/R4/Condition/abc`), else the base URL. Sources can
  differ per resource (multi-provider records) — that's why this is selection-script
  work, not an assembler flag. Skip it only when provenance is genuinely unknown.

**Including documents (notes, imaging reports, consults).** Documents ride as
DocumentReferences whose content is **inline**: `content[].attachment = {contentType,
data: <base64>}`. Real exports almost never arrive that way — portal FHIR uses
`attachment.url` pointing at a Binary on the source server (unreachable from an
encrypted bundle; the validator rejects any `url` attachment), and health-skillz
exports strip inline data into their `attachments[]` sidecar (look for the original
bytes there; `bestEffortPlaintext` is a last resort). So this is the ONE transform
you're expected to perform:

1. Find the document body you actually have locally — the ORIGINAL bytes (PDF, RTF,
   HTML, plain text), not extracted/derived text, whenever they exist.
2. **Keep the source format — never transcode.** Rebuild `content` as a single
   attachment: `data` = base64 of the original bytes, `contentType` = the source's
   own content type (from the export metadata; if missing, sniff the bytes — `%PDF`
   → `application/pdf`, `{\rtf` → `application/rtf`, an HTML tag → `text/html`,
   else `text/plain`); drop every `url` entry. SHL viewers render all four formats
   in-browser; converting to PDF loses formatting and is exactly the kind of
   content edit this workflow forbids. Anything outside those formats (DICOM, DOCX,
   …) still rides inline, but receivers may only be able to download it — the
   validator warns; tell the patient.
3. Keep the rest of the DocumentReference **verbatim** — especially `type` and
   `category` codings (that's how the receiver knows what the note IS), date, and
   author display. Do NOT relabel provider-authored notes with the patient-story
   type or patient-asserted security labels: re-sharing doesn't change authorship.
   If you have no local body at all, the document can't ride along — say so rather
   than including an empty shell.

(md-to-pdf.ts is for content YOU authored as markdown — the Patient Story — never
for note bodies.)

**More than one Patient resource (multi-source exports).** The bundle carries exactly
one Patient, so when sources disagree you build the merged one in your selection
script — the second (and last) sanctioned transform:

- Start from the source Patient with the most complete, most recently updated
  demographics (`meta.lastUpdated` when present, else the export date).
- Fill each demographic field (name, birthDate, gender, address, telecom) with the
  most up-to-date non-empty value across sources; identifiers may be unioned (keep
  each identifier's `system`). Every value must come **verbatim from some source
  Patient** — merging selects between sources, it never invents.
- Keep the base Patient's `id`, and leave every other resource's patient references
  **untouched** — `assemble-bundle.ts` lands them all on the single Patient entry
  automatically, whether they're relative (`Patient/<any-source-id>`) or each source
  file's pre-assigned `urn:uuid:` (rewritten when the urn appears only in
  subject/patient positions). Nothing dangles; nothing for your script to rewrite.
- **Show the patient the merged demographics before assembling** — name, DOB,
  address, phone — and ask which is current wherever sources conflict. This review
  is required whenever you merged; a clinic will match the chart on these fields.

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

The patient already approved the words; the render is mechanical and the layout
engine is heavily tested — a successful exit means it rendered correctly. Move on.

### Step 5: Assemble the bundle

```bash
bun <skill-dir>/scripts/assemble-bundle.ts --resources selected-resources.json \
  --story story.pdf -o bundle.json
```

```json
{"status":"assembled","entries":46,"docRefs":2,"output":"bundle.json","renderedPdf":"bundle.rendered.pdf","renderedIds":"bundle.rendered-ids.json","renderedPages":9}
```

- Omit `--story` if the patient declined one.
- **The FHIR-Rendered summary PDF is generated AUTOMATICALLY** — every discrete
  resource rendered into a readable document and attached as its own DocumentReference
  (the KTC SHOULD). You don't run anything for it, and the defaults are right;
  override flags exist but you should almost never need them. A successful exit
  means clean pages — inspect only on a surprise.

The script owns urn rewriting, reference fixup, and DocumentReference construction —
**never hand-build or post-edit the bundle** (see bundle rules below).

### Step 6: Validate

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

### Step 7: One approval, then create the link

**⚠️ CRITICAL: get explicit approval before creating the link** — but make it ONE
decision moment, not a series. Present a single recap that covers all three things,
then ask once (a structured question with options works well here):

> "Here's what your share will contain: your heart-rhythm-related problems, the 2
> medications, 4 allergies, both echo reports with full text, your story page,
> and a readable summary PDF. The link works for 24 hours or 5 scans — if your visit
> slips, re-arming takes one command. I'd label it **Josh Mandel — visit summary for
> June 12** (it's the most visible text the front desk sees). Build it? [Yes, build
> it / Use a different label / Change what's shared first]"

The label is ≤80 characters; lead with the patient's name and say what/when:

- `Avery Quinn — visit summary for June 12`
- `Maria Quintana — new patient intake, Lakeside Family Medicine`
- `Sam Lee — med list + allergies for ortho consult`

```bash
bun <skill-dir>/scripts/create-shl.ts --bundle bundle.json \
  --label "Avery Quinn — visit summary for June 12" -o ./shl-out/
```

Defaults: `--exp-hours 24`, `--max-uses 5` (`--max-uses unlimited` to lift the cap),
`--flag U` — deliberately forgiving-but-bounded; they're mentioned in the recap above,
never asked about separately. The share link defaults to the viewer-prefixed form
(`https://…/v#shlink:/…`) — any phone camera scans it, and SHL-aware scanners extract
the embedded `shlink:/` per spec; pass `--bare` ONLY if the patient or their clinic
specifically needs the raw `shlink:/` URI. The `-o` directory must be new or empty —
the script never overwrites a previous link's artifacts; use a fresh directory per
link. Exact stdout contract:

```json
{
  "status": "created",
  "id": "…",
  "label": "Avery Quinn — visit summary for June 12",
  "flag": "U",
  "exp": 1781234567,
  "maxUses": 5,
  "files": [{"contentType": "application/fhir+json", "size": 187234}],
  "handoffMarkdown": "You're set!\n\n**[Your link setup & control page](https://…/m#…)** — keep this one private. …",
  "nextStep": "Paste handoffMarkdown verbatim as the body of your closing chat message. …",
  "artifacts": {
    "ownerLink": "/abs/path/shl-out/owner-link.txt",
    "shlink": "/abs/path/shl-out/shlink.txt",
    "viewerLink": "/abs/path/shl-out/viewer-link.txt",
    "qrPng": "/abs/path/shl-out/qr.png",
    "meta": "/abs/path/shl-out/link-meta.json",
    "handoff": "/abs/path/shl-out/handoff.md"
  }
}
```

The script generates the key material, registers the link, encrypts the bundle
locally, uploads ciphertext, and writes the artifacts to files. `handoffMarkdown` is
your closing message, ready to paste (Step 8); `handoff.md` is its durable copy;
`nextStep` restates the handoff rule at the moment you need it.

### Step 8: Hand off — paste handoffMarkdown

Your closing message is already written: the create output's `handoffMarkdown` holds
the hand-off text with both links named by role — the owner page as a labeled
markdown link, the shareable link as code text — and the expiry/use figures filled
in. Paste it **verbatim** as the body of your final message; you may add to it (the
patient's name, a platform note), but don't reconstruct it. (`handoff.md` in the
output directory is the same text if you need it again later.)

**The one requirement that survives every platform habit: both links appear in your
message TEXT — the owner page as a clickable markdown link, the share link as inline
code.** The owner page is the patient's control surface and the share link is the
thing they'll paste into a check-in form; a path to `owner-link.txt` or a file
attachment is not a handoff — the patient should click, not open files. If your
platform pushes you toward "send files with a short caption," resist: the message
text carries the links.

**The QR lives on the owner page — don't render, display, or attach one yourself.**
The patient opens their control page and shows the QR there; it stays current through
re-arms and relabels, which any image you produce would not. (`qr.png` exists in the
output directory only for the patient who explicitly asks for a printable file.)

(The control page is the capability that manages the link; the share link is the
link itself — never swap their roles in the message.)

**Share-link forms:** the default share link and QR are viewer-prefixed
(`https://…/v#shlink:/…`) — any phone camera opens them, and SHL-aware clinic
scanners extract the embedded `shlink:/` per spec. The bare URI in `shlink.txt` is
the opt-in fallback for scanners that can't handle the prefix (the owner page has the
same toggle; `--bare` at create time flips the default). The viewer-prefixed link is
also the right thing to give a family member who should *show* the QR but not manage
it — it opens a view-only page (QR + label + expiry, no controls), same as the owner
page's "Preview" button.

After handoff, management lives on the owner page (access log, re-arm, pause/resume,
relabel, destroy); a clinician may review shared data before it appears in the chart.
The same operations work from here — when the patient asks:

```bash
bun <skill-dir>/scripts/manage-shl.ts ./shl-out status
bun <skill-dir>/scripts/manage-shl.ts ./shl-out log
bun <skill-dir>/scripts/manage-shl.ts ./shl-out re-arm --exp-hours 24 --max-uses 5
bun <skill-dir>/scripts/manage-shl.ts ./shl-out pause
bun <skill-dir>/scripts/manage-shl.ts ./shl-out resume
bun <skill-dir>/scripts/manage-shl.ts ./shl-out relabel "Avery Quinn — records for Dr. Chen"
bun <skill-dir>/scripts/manage-shl.ts ./shl-out replace --bundle new-bundle.json
bun <skill-dir>/scripts/manage-shl.ts ./shl-out destroy --yes
```

The first argument is the `-o` directory from `create-shl.ts` (or a path to
`owner-link.txt` directly). `re-arm` extends expiry to now + N hours and grants N
*more* uses; `destroy` demands `--yes` because it's irreversible — confirm with the
patient first. `status` emits the link state (id, label, exp, uses/maxUses, active,
`live` — i.e. serving right now — plus file metadata and `ownerLink`, so "give me my
link again" is one `status` call), e.g.:

```json
{"id":"…","url":"…","flag":"U","label":"Avery Quinn — visit summary for June 12","exp":1781234567,"maxUses":5,"uses":1,"active":true,"live":true,"purgedAt":null,"passcodeAttemptsRemaining":null,"createdAt":"2026-06-10T16:00:00Z","files":[{"fileId":"…","contentType":"application/fhir+json","size":187234,"lastUpdated":"2026-06-10T16:00:00Z"}],"ownerLink":"https://…/m#…"}
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
