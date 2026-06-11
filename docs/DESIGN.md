# kill-the-clipboard — Design

An AI-agent skill + companion server for creating SMART Health Links (SHLs) that meet the
CMS health tech ecosystem / "Kill The Clipboard" (KTC) participation requirements:
patient-selected FHIR data + a Patient Story PDF + a FHIR-Rendered fallback PDF, assembled
into a `PatientSharedBundle`, encrypted client-side, and hosted as a U-flag SHL.

**Specs targeted**
- Base SHL: SMART Health Cards and Links IG v1.0.0 (`hl7.fhir.uv.smart-health-cards-and-links`), links-specification
- Profile: "Patient-Shared Health Documents via SMART Health Links" (KTC spec, v0.10.x, Draft for July 2026)
- Content: US Core (+ CARIN BB / CARIN Digital Insurance Card permitted; insurance capture deferred to phase 2/3)

**Pattern precedents** (sibling repos in this workspace)
- `request-my-ehi` — SKILL.md anatomy, server-built skill.zip with baked BASE_URL (its jsPDF
  md-to-pdf is an explicit ANTI-precedent: hand-rolled layout → wrapping/spacing disasters; see decision 17)
- `health-skillz` — partials-composed SKILL.md, dependency-free Bun scripts, JSON-lines stdout, privacy posture
- `vaxx.link` — SHL server protocol surface (deliberately NOT its data model; see §4)
- `shlinker` — receiver-side envelope viewer; informs label/bundle hygiene

---

## 1. Decisions log (settled with Josh)

1. **Server supports the full SHL feature set** (manifest links, P/L flags, passcode lockout, file updates); **the skill guides agents to KTC-compliant links** (U flag, exp required, single `application/fhir+json` JWE containing one PatientSharedBundle).
2. **Standalone repo**, skill name **kill-the-clipboard**. health-skillz documented as a recommended upstream data source by URL (health-skillz.joshuamandel.com); its format is self-documenting — we don't bake in its details (though SKILL.md may note the general shape).
3. **All crypto in the agent's compute environment.** Key never touches our server. Key secrecy vs. the LLM context is best-effort/partly symbolic (agent already handles plaintext); convention: secrets go to files, not stdout.
4. **Single owner secret M** with HKDF-derived read + control capabilities (§3). Owner handoff page reconstructs the QR from derivation + API discovery; nothing embedded, nothing redundant.
5. **KTC defaults**: exp = 24h, maxUses = 5, manual re-arm (PATCH + client-side QR rebuild). Grace and flexibility over crushing users in short windows.
6. **Type-specific PDF rendering for all US Core resource types** + generic fallback (§7). Test fixture: `~/Downloads/health-records.json` (UnityPoint/Epic via health-skillz; 19 resource types, 321 Observations across 11 category codes).
7. `check-access` / `revoke` fold into one `manage-shl.ts` verb script.
8. **No App Attestation** (optional in spec; we're not in the CMS trusted-app library).
9. **Insurance card photo→CARIN transcription: phase 2/3.** Phase 1 is USCDI/US Core structured content.
10. **No arbitrary patient content** in phase 1; agent helps patient choose structured data + existing documents (notes from FHIR payloads — RTF/PDF/etc. — as generically coded DocumentReferences if patient insists). **Validator enforces inline attachments (`attachment.data`, never `url`)** — location-based attachments are unreachable in this scheme.
11. **Viewer prefix: supported** (amended 2026-06-10, twice). The handoff page's viewer
    mode (`/v#shlink:/...`) IS a viewer-prefix target; create-shl emits `viewer-link.txt`.
    QR display and copy-link DEFAULT to the bare shlink because that's what KTC clinic
    scanners expect at check-in — a flow preference, NOT a security rule; the prefixed
    form carries the identical shlink and is fine (often better) to share wherever a
    human clicks rather than scans. The management UI offers **"Preview as recipient"**
    (opens the prefixed viewer link in a new tab — functional self-test + patient
    empathy). Amended again 2026-06-10: the viewer page now RENDERS the shared content
    in-browser (fetches via U-flag or the full manifest flow incl. passcodes, decrypts
    with the link key, type-aware resource sections, documents open in new tabs via
    blob URLs, raw FHIR bundle openable as JSON). Routes split: /m manage, /v view,
    /s legacy alias. A richer server-hosted viewer experience remains future polish.
12. Label crafting is a first-class agent task (≤80 chars, e.g. "Josh Mandel — visit summary for June 12") — it's the most visible receiver-facing string.
13. Handoff page: `history.replaceState` strips the fragment on load; **no localStorage by default**; explicit "Make this page bookmarkable" toggle restores the fragment. Re-manage by re-opening from the agent.
14. **Confirmed**: per-file ciphertext cap 25 MB; ciphertext purge 30 days after exp (tombstone + audit log remain).
15. **All code is Bun TypeScript.** Server is plain `Bun.serve` with the `routes` option and
    **Bun HTML imports** for UI hosting alongside the APIs (no Hono, no separate bundler for
    the handoff app). Runtime deps minimal: jspdf, qrcode, (pdf-lib only if merge needed);
    JWE (`dir`+`A256GCM` compact) hand-rolled on WebCrypto in `lib/jwe.ts`, cross-checked
    against `jose` in dev tests only.
16. **Synthetic US Core fixture corpus built alongside the renderer** (§10): breadth-spanning
    sample instances for every US Core type — every must-support field and choice-type
    variant populated somewhere in the set — Epic-inspired (UnityPoint fixture quirks), so
    rendering quality is provable, not assumed.
17. **PDF engine: NOT the request-my-ehi jsPDF md-to-pdf** — Josh's verdict from that project:
    disastrous, too low-level, persistent wrapping/spacing bugs. Requirement: a real layout
    engine that owns text measurement, wrapping, table pagination, and page breaks; we only
    map markdown → its document model. No headless Chromium (skill-zip portability in agent
    sandboxes is binding). Candidates: **pdfmake** (declarative doc-definition, native long-table
    pagination with repeating header rows, pure JS), **@react-pdf/renderer** (Yoga/flexbox,
    strongest typography control, React+WASM in zip), **Typst via WASM** (highest typeset
    quality, agent-friendly source language, heaviest bundle ~15–20 MB). Decided by a
    **Phase 0 bake-off**: same content (story + dense FHIR tables + semantic components)
    rendered through each, compared as PNGs, before any contract freezes.
18. *(superseded by 19 for engine choice; builder contract stands)*
    **The document contract is a typed builder API of SEMANTIC components, not markdown.**
    `lib/doc.ts`: `title(), section(), para(), table() (repeating headers), kvPanel(),
    callout(), badge(), pullQuote(), pageFooter()` + `--theme story|summary` — implemented
    natively on the winning engine, so beauty is uncapped by markdown's expressiveness and
    engine swap happens behind a small semantic interface. `render-fhir-pdf.ts` calls the
    builder directly (it's code — no markdown round-trip). **Markdown is one input adapter**
    (`md-to-pdf.ts story.md --theme story`) kept as the agent easy path for patient stories;
    if Typst wins, a second adapter is raw Typst with our theme imported (agents know Typst —
    high-power escape hatch that still looks designed). `preview-pdf.ts` (pdftoppm → PNG)
    visual-verify gate; themes embed OFL fonts (serif story body, sans tables) and the
    provenance footer ("Shared by the patient via SMART Health Link" + page numbers). Any
    plain PDF feeds assemble-bundle identically.
19. **Engine chosen (2026-06-10 bake-off): @react-pdf/renderer.** All three candidates
    passed the 10-point torture checklist; Josh preferred react-pdf visually; agents are
    maximally fluent in JSX; the builder hides the quirky parts. Mitigations (binding):
    PIN the version (zip ships bun.lock); the repeating-header technique (`fixed` row +
    `wrap={false}` — undocumented emergent behavior) lives ONLY inside lib/doc.ts with a
    geometry regression test that fails loudly on upgrade; prune the `hyphen` dep to the
    needed pattern files. Rejected: pdfmake (0.3 API churn with SILENT no-ops + stale LLM
    training data — worst failure mode for AI-maintained code, despite best vendorability);
    Typst (superb output/speed but 52 MB per-platform native blob; remains the swap
    candidate behind the lib/doc.ts interface). Bake-off artifacts: docs/bakeoff/*/, each with
    NOTES.md, PDFs, PNGs; the react-pdf builder prototype (doc.tsx, 696 LOC) seeds the real
    lib/doc.ts implementation.

---

## 2. Components

```
kill-the-clipboard/
├── DESIGN.md                  ← this file
├── README.md
├── server/                    Bun.serve (routes + HTML imports) + bun:sqlite, single process
│   ├── src/
│   │   ├── index.ts           Bun.serve routes: data plane, control plane, /skill.zip, /s via HTML import
│   │   ├── db.ts              schema + queries (see §4)
│   │   ├── tickets.ts         stateless HMAC location-URL tickets
│   │   ├── sweep.ts           expiry/purge sweeper
│   │   └── zip.ts             skill.zip builder w/ {{BASE_URL}} templating
│   ├── config.json{,.example} { server: {port, baseURL}, limits, retention }
│   └── kill-the-clipboard.service
├── app/                       handoff page served at /s via Bun HTML import (index.html → tsx)
│   └── src/ ...               React + qrcode; fragment-driven; no server state
├── lib/                       shared kernel: types.ts, hkdf.ts, jwe.ts, shlink.ts (used by
│                              server, app, skill scripts, tests — single source of truth)
├── skill/
│   ├── build-skill.ts         partials → SKILL.md (health-skillz pattern)
│   ├── partials/
│   │   ├── header.md          frontmatter: name kill-the-clipboard + trigger description
│   │   ├── when-to-use.md
│   │   ├── background.md      KTC explainer for the agent (what receivers must persist, PAMI, two PDF kinds)
│   │   ├── workflow.md        Steps 1–10 (§6)
│   │   ├── bundle-rules.md    PatientSharedBundle + DocumentReference profile rules (§5)
│   │   ├── secrets.md         file-not-stdout conventions, per-platform handoff guidance
│   │   └── script-reference.md
│   └── kill-the-clipboard/
│       └── scripts/           shipped, dependency-light Bun TS (§6)
│           ├── assemble-bundle.ts
│           ├── render-fhir-pdf.ts
│           ├── md-to-pdf.ts          (markdown → layout-engine doc model; engine per bake-off, decision 17)
│           ├── validate-bundle.ts
│           ├── create-shl.ts
│           ├── manage-shl.ts
│           └── lib/           vendored copy of /lib + fhir-render/*.ts (zip builder syncs
│                              from root /lib so the zip stays self-contained, no bun install)
├── tests/                     unit (bun:test) + e2e (§9)
└── tests/fixtures/uscore/     synthetic breadth corpus (§11) + the UnityPoint real-world fixture
```

Roles:
- **Server**: hosts ciphertext + link config + audit log; serves the static handoff app and `/skill.zip` (built per-request, `{{BASE_URL}}` baked in, request-my-ehi/health-skillz pattern). Never sees keys or plaintext.
- **Handoff app** (`/s`): fragment-driven static page; owner/viewer modes; QR display/copy/share-sheet; status, access log, re-arm, pause, destroy; "share a view-only copy".
- **Skill**: SKILL.md + scripts; the agent drives selection, the patient story, and orchestration; shipped scripts own everything deterministic and conformance-critical.

---

## 3. Capability & crypto design (pinned)

One 32-byte owner secret **M** (`crypto.getRandomValues`), generated by the agent's create script.

```
auth = base64url( HKDF-SHA256(ikm=M, salt=<empty>, info="ktc-shl/v1/auth", L=32) )   → control capability
key  = base64url( HKDF-SHA256(ikm=M, salt=<empty>, info="ktc-shl/v1/key",  L=32) )   → SHL encryption key
```

- `auth` is registered with the server at link creation; server stores `sha256(auth)` only.
  One-way: server cannot reach M or key. Receiver (holding key) cannot reach M or auth.
- `key` never leaves the client. JWE per base spec: compact serialization, `alg:dir`,
  `enc:A256GCM`, `cty:application/fhir+json`, unique IV per encryption (incl. file updates,
  same key per spec), optional `zip:DEF`.
- HKDF output is indistinguishable from the spec's "32 random bytes" — conformant in substance.

**Fragment shapes** (the page's only inputs; fragments never reach servers):

```
https://<base>/m#<base64url(M)>          owner mode  (43 chars)
https://<base>/v#shlink:/eyJ...          viewer mode (STANDARD SHL viewer-prefix convention)
https://<base>/m#<auth>&cap=auth         monitor mode (manage w/o read) — falls out free, deferred UI
https://<base>/m#<M>&api=https://other   cross-host page→API (optional; same-origin default)
```

Owner mode flow: derive auth → `GET /api/manage/{auth}` → `{url, flag, exp, label, ...}` →
derive key → reconstruct payload `{url, key, exp, flag, label, v?}` → render QR.
The QR is always **reconstructed, never stored**; label/exp edits propagate to future QRs.
"Share a view-only copy" = client-side emission of the standard prefixed shlink. Nothing to
revoke separately; view copies die with the link.

Tradeoffs accepted: owner capabilities are linked (no read/control split for the owner —
that's what "owner" means); owner QR display needs one API round trip (offline display =
use the view-mode link).

---

## 4. Server: API + data model (first principles, not vaxx.link's)

### Data plane (receiver-facing, spec-shaped)

```
GET  /shl/{id}?recipient=...      U-flag: → JWE (content-type: application/jose)
                                  404 unless live; increments uses; audit-logs
POST /shl/{id}                    manifest request {recipient, passcode?, embeddedLengthMax?}
                                  → {status?, files:[{contentType, location|embedded, lastUpdated?}]}
                                  401 + {remainingAttempts} on bad passcode (txn-safe decrement)
GET  /shl/{id}/f/{fileId}?t=...   ticketed file fetch → JWE (application/jose)
```

- `id` = 43-char base64url entropy; full `url` ≤128 chars per spec.
- Tickets: stateless `HMAC(serverSecret, linkId|fileId|expiry)`, ~5-min TTL (spec cap: 1h).
  Survives restarts; no in-memory state.
- Liveness is **derived, never stored**:
  `active && now < exp && (max_uses IS NULL || uses < max_uses) && (passcode_attempts IS NULL || > 0)`.
  Any failure → 404 (spec). Re-arm = PATCH flips a failing condition; no state machine.

### Control plane (capability via Authorization header)

External-review hardening (2026-06-11):
- The auth capability travels in `Authorization: Bearer <auth>` — never the URL path,
  which proxies/access logs retain (the deployment's own fronting proxy demonstrated
  the leak class). `/api/manage/{auth}` path forms remain as DEPRECATED aliases for
  already-extracted skills.
- The label is stored CLIENT-ENCRYPTED (`labelEnc`: compact JWE under the link key,
  cty text/plain) — the server never learns the patient's name. The shlink payload's
  plaintext label (spec-required, receiver-facing) is unchanged: it's visible only to
  link holders, who already hold the decryption key. Residual server knowledge:
  timing, ciphertext sizes, access patterns, and audit-log recipient strings —
  inherent to hosting + the audit feature itself.

```
POST  /api/links                  {authTokenHash—no: auth, flag?, exp?, maxUses?, passcode?, label?}
                                  → {id, url}        (server stores sha256(auth))
GET   /api/manage/{auth}          → {url, flag, label, exp, maxUses, uses, active, purgedAt?,
                                     files:[{fileId, contentType, size, lastUpdated}],
                                     accessLog:[{ts, recipient, action, outcome}]}
PATCH /api/manage/{auth}          {exp?, maxUses?, active?, passcode?, label?}
POST  /api/manage/{auth}/files    JWE body, Content-Type header → {fileId}
PUT   /api/manage/{auth}/files/{fileId}    replace ciphertext (client re-encrypts: same key, new IV)
DELETE /api/manage/{auth}/files/{fileId}
DELETE /api/manage/{auth}         purge + terminal deactivation
```

- U-flag links: exactly one file (reject 2nd POST; reject DELETE of last file while active).
- `PATCH {active:false}` = reversible pause; `DELETE` = destroy. Patient-meaningful distinction.
- CORS open on `/api/manage/*` (third-party pages); page served same-origin by default.

### Schema

```sql
links (
  id TEXT PRIMARY KEY,              -- public entropy (data-plane path)
  mgmt_token_hash TEXT NOT NULL,    -- sha256(auth)
  flag TEXT NOT NULL DEFAULT 'U',
  label TEXT,
  exp INTEGER NOT NULL,
  max_uses INTEGER,                 -- NULL = unlimited
  uses INTEGER NOT NULL DEFAULT 0,
  passcode_hash TEXT,               -- Bun.password argon2id; NULL unless P
  passcode_attempts_remaining INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER, updated_at INTEGER, purged_at INTEGER
);
files (
  id TEXT PRIMARY KEY, link_id TEXT REFERENCES links(id),
  content_type TEXT NOT NULL, ciphertext BLOB, size INTEGER,
  created_at INTEGER, updated_at INTEGER
);
accesses (
  id INTEGER PRIMARY KEY, link_id TEXT, ts INTEGER,
  recipient TEXT, action TEXT, outcome TEXT   -- direct|manifest|file × ok|bad-passcode|inactive
);
```

Deliberate departures from vaxx.link: no CAS/refcounts (one row per file); stateless HMAC
tickets instead of in-memory Map; secrets hashed at rest (vaxx stores passcode plaintext);
uses/maxUses and audit first-class; passcode attempt decrement inside a transaction
(spec calls out the parallel-guess race).

Retention: sweeper nulls `files.ciphertext` 30 days after `exp` (configurable), sets
`purged_at`; link row + audit remain so `GET manage` shows an honest tombstone. Re-arm works
until purge; after purge the agent must re-upload.

KTC sender conformance carried by this design: serve without auth; accept `recipient`
(required on U-flag GET); audit each access w/ timestamp + recipient; 404 when inactive;
QR display + copy-as-URL via the handoff page.

---

## 5. Bundle assembly rules (KTC profile, enforced by shipped scripts)

`PatientSharedBundle` (canonical `https://cms.gov/fhir/StructureDefinition/patient-shared-bundle`):
- `type: collection`; `timestamp` required; entries ≥2: exactly one Patient + ≥1 content entry.
- `fullUrl` = `urn:uuid:...`; all intra-bundle references rewritten to those urns.
- Resources SHOULD NOT carry `meta.profile`.
- Patient with sufficient matching demographics (name, birthDate, gender at minimum).
- Discrete resources: US Core (CARIN BB / CARIN DIC permitted later).

`PatientSharedDocumentReference` (both PDF kinds; profile of US Core DocumentReference):
- `status: current`; `category` includes `https://cms.gov/fhir/CodeSystem/patient-shared-category#patient-shared`;
  `subject` + `author` = the bundle's Patient urn; `date` required;
  `meta.security` SHOULD include `PATAST` (`http://terminology.hl7.org/CodeSystem/v3-ObservationValue`);
  `content.attachment.contentType: application/pdf`; `content.attachment.data` = inline base64 (never `url`).
- `type` distinguishes the kinds:
  - **LOINC 51855-5** "Patient Note" → **Patient Story PDF** (patient's own words; SHOULD NOT restate discrete clinical facts)
  - **LOINC 60591-5** "Patient summary Document" → **FHIR-Rendered PDF** (SHALL be a complete readable rendering of EVERY non-DocumentReference resource in the bundle; SHOULD be included whenever discrete resources are present)

SHL payload for KTC: `{url, key, exp (required), flag:"U", label≤80}`; no P, no L, no manifest.

---

## 6. Skill: workflow + script contracts

### SKILL.md workflow (Steps, request-my-ehi style)

1. **Locate data.** Inventory local FHIR sources (health-skillz output, bundles, raw JSON);
   if no data: recommend health-skillz (health-skillz.joshuamandel.com) and stop or proceed
   with what exists. Never fabricate clinical data (⚠️ CRITICAL).
2. **Scope the share.** Conversational, not checkbox-per-resource. Default proposal: PAMI
   (Conditions, MedicationRequests+Medications, AllergyIntolerances, Immunizations) + recent
   vitals/labs if relevant to the visit; patient adds/removes categories. Inform-don't-ask
   for routine choices.
3. **Agent writes the selection script** (per-session, ad hoc): reads source files, filters,
   emits `selected-resources.json`. The skill documents the expected output shape; shipped
   scripts take it from there.
4. **Patient Story interview** (optional but offered): concerns, corrections, context,
   goals for the visit. Agent drafts markdown → patient approves text verbatim →
   `md-to-pdf.ts` → visual check (`pdftoppm`) → patient sees the PDF before inclusion.
5. **FHIR-Rendered PDF**: `render-fhir-pdf.ts` over the selected resources (§7); emits PDF +
   `rendered-ids.json` coverage manifest.
6. **Assemble**: `assemble-bundle.ts` — selected resources + story PDF + rendered PDF →
   conformant PatientSharedBundle (owns urn rewriting + DocumentReference construction;
   agents never hand-build DocRefs).
7. **Validate**: `validate-bundle.ts` (§8). Fix-and-rerun loop until clean.
8. **Create the link**: `create-shl.ts` — generate M, register, encrypt, upload, write
   artifacts. Craft the label with the patient.
9. **Handoff**: present owner page URL / QR per platform (secrets conventions below).
10. **Explain + manage**: what the clinic will persist (PAMI + both PDFs, patient-shared
    provenance label, clinician may review before filing); how to re-arm/pause/destroy
    (page or `manage-shl.ts`).

### Script contracts

Conventions (from the sibling skills): `#!/usr/bin/env bun`; minimal deps (the chosen PDF
layout engine, qrcode; pdf-lib only if merging is needed); stdout = machine-readable JSON,
stderr = progress; nonzero exit + usage on error; server URL via `config.json` `{{BASE_URL}}`
baked at zip build.

**Secrets convention**: `create-shl.ts` writes `owner-link.txt`, `shlink.txt`, `qr.png`,
and `link-meta.json` (non-secret: id, exp, label, file sizes) into an output dir; stdout
carries only paths + non-secret metadata. SKILL.md: on filesystem platforms, point the user
at files / open the browser without echoing contents; on hosted chat platforms, relay the
owner URL once and never quote or decode it again.

```
assemble-bundle.ts  --resources selected-resources.json [--story story.pdf] [--rendered rendered.pdf]
                    [--rendered-ids rendered-ids.json] -o bundle.json
render-fhir-pdf.ts  --resources selected-resources.json -o rendered.pdf --ids-out rendered-ids.json
md-to-pdf.ts        story.md [story.pdf]
validate-bundle.ts  bundle.json [--rendered-ids rendered-ids.json] → JSON findings, exit 1 on errors
create-shl.ts       --bundle bundle.json --label "..." [--exp-hours 24] [--max-uses 5]
                    [--flag U] -o ./shl-out/
manage-shl.ts       <shl-out-dir|owner-link-file> status|log|re-arm [--exp-hours N]|pause|resume|
                    relabel "..."|replace --bundle new.json|destroy
```

`manage-shl.ts` derives auth from M and calls the control plane; `replace` re-encrypts with
the derived key (same key, new IV) and PUTs.

---

## 7. FHIR→PDF renderer (US Core coverage matrix)

Dispatch on `resourceType`, with Observation sub-dispatch on `category`. Every US Core
resource type gets a section renderer; a generic key-path/value fallback guarantees the
"complete rendering" SHALL for anything unrecognized. Sections in clinical-reading order:

| Section | resourceType(s) | Rendered fields (summary) |
|---|---|---|
| Demographics | Patient | name, DOB, sex, identifiers (display only), contact |
| Problems | Condition (Problems & Health Concerns; Encounter Diagnosis) | code, clinicalStatus, onset/abatement, recorded |
| Medications | MedicationRequest + Medication, MedicationDispense | drug, dose/sig text, status, authoredOn, requester |
| Allergies | AllergyIntolerance | substance, reaction/manifestation, criticality, status |
| Immunizations | Immunization | vaccine, date, status, lot/site if present |
| Vitals | Observation cat `vital-signs` (incl. BP components, pediatric percentiles) | code, value+unit, date; table grouped by code, most-recent-first |
| Labs | Observation cat `laboratory`/`Lab`, DiagnosticReport (Lab) | test, value, reference range, interpretation, date; report→member rows |
| Social/SDOH/Surveys | Observation cat `social-history`, `sdoh`, `survey`, smoking, sexual-orientation, occupation, pregnancy status/intent, screening-assessment | code, value, date |
| Other observations | remaining categories (`exam`, `smartdata`, `functional-status`, `disability-status`, …) | generic obs row renderer |
| Procedures | Procedure | code, date, status, performer |
| Encounters | Encounter | class, type, period, location, provider |
| Care plans/teams/goals | CarePlan, CareTeam, Goal | narrative-aware summary rows |
| Service requests | ServiceRequest | code, status, intent, occurrence |
| Coverage | Coverage | payor, member id (display), class, period |
| Devices | Device (Implantable) | type, UDI display |
| Reports & notes | DiagnosticReport (Note), DocumentReference (non-PatientShared, if patient chose to include) | listed by type/date; note text excerpt if inline |
| Supporting | Practitioner, PractitionerRole, Organization, Location, Specimen, RelatedPerson, Provenance, QuestionnaireResponse | compact reference tables / fallback |
| Anything else | * | generic flattened key-value renderer (completeness guarantee) |

**Volume rule (real records repeat heavily — e.g. 321 Observations in the UnityPoint
export):** family renderers are COLLECTION-oriented, never card-per-resource. Each receives
all resources of its scope and renders compact tables — one row per resource instance,
most-recent-first, grouped clinically (labs by category/panel, vitals optionally pivoted
date×measure). Renderers may group and sort but NEVER drop or summarize-away an instance:
one row per resource is both the only layout that scales to hundreds of rows and the
completeness guarantee the FHIR-Rendered PDF SHALL requires. The `table()` primitive is the
load-bearing component (repeating headers + atomic rows, geometry-regression-tested at 60
rows; volume integration tests run the UnityPoint export plus a synthetic amplifier that
clones corpus labs/vitals across dates to 500+ rows).

Rendering source: structured elements, not `text.div` (consistent output; upstream narrative
quality varies). Engine: renderer modules call the `lib/doc.ts` semantic builder directly
(decisions 17/18) — no markdown round-trip; one themed PDF pipeline serves both artifacts.
Emits `rendered-ids.json` = every resource id rendered, for the validator
cross-check. Fixture sanity target: `~/Downloads/health-records.json` renders fully with
zero fallback-section entries for the 19 known types.

---

## 8. validate-bundle.ts checklist

Errors (exit 1): bundle type ≠ collection; missing timestamp; Patient count ≠ 1; <2 entries;
non-urn fullUrls or dangling/external intra-bundle references; DocRef violations (status,
type ∉ {51855-5, 60591-5}, missing patient-shared category, subject/author not the Patient
urn, missing date, contentType ≠ application/pdf, attachment via `url` or missing `data`,
non-base64 data); **any attachment anywhere in the bundle using `url` instead of inline
`data`**; SHL payload pre-flight (exp present, flag U, label ≤80, url ≤128) when invoked by
create-shl. Warnings: `meta.profile` present; missing PATAST; FHIR-Rendered PDF present but
`rendered-ids.json` doesn't cover every non-DocumentReference resource (error if ids file
provided); Patient missing name/birthDate/gender; discrete resources present but no
FHIR-Rendered PDF (profile SHOULD).

---

## 9. Test plan

- **Unit (bun:test)**: HKDF vectors (fixed M → expected auth/key); JWE round-trip incl.
  zip:DEF; shlink payload build/parse; renderer per-type golden tests on fixture excerpts;
  md-to-pdf overflow/pagination regression tests (long unbreakable strings, wide tables,
  page-boundary rows — the request-my-ehi failure modes, asserted via rendered-page geometry);
  validator positive/negative fixtures.
- **Server API**: create→upload→GET-with-recipient happy path; 404 matrix (expired, exhausted,
  paused, destroyed, purged); passcode lockout incl. parallel-guess race; manifest +
  ticket expiry; U-flag single-file enforcement; audit log contents; re-arm.
- **Integration**: full pipeline against the UnityPoint fixture → bundle validates → SHL
  created on local server → independent decrypt via shlinker's retrieve path (or a small
  reference client) → byte-identical bundle.
- **E2E (agentic, request-my-ehi pattern)**: scripted scenarios driving a CLI agent with the
  built skill.zip: PAMI-only share; PAMI+story; story-only; re-arm after expiry; revoke.
  Inspect produced PDFs with poppler.

---

## 10. Synthetic US Core fixture corpus (breadth, not depth)

Purpose: prove rendering quality across the full space of what can show up, not just what the
one real export happens to contain. Lives in `tests/fixtures/uscore/<resourceType>/`.

Rules:
- **One constant synthetic patient** ("Breadth Casey Tester", obviously synthetic demographics,
  fixed urn) shared by every instance, so any subset composes into a valid PatientSharedBundle
  for end-to-end tests.
- Per US Core type, a small instance set that collectively exercises:
  - every **must-support** element of every US Core profile on that type (agents fetch the
    profile pages from hl7.org/fhir/us/core during generation and record the element list);
  - every **choice-type variant** that occurs in practice (e.g. `Observation.value[x]`:
    Quantity, CodeableConcept, string, boolean, integer, Ratio, time, dateTime, Period,
    components-only with `dataAbsentReason`, panel/hasMember);
  - status/lifecycle variants (active/resolved, completed/stopped, entered-in-error);
  - representation edge cases: code-only coding (no display), text-only CodeableConcept,
    multiple codings, missing optional fields, long strings, unicode names, multiple
    identifiers, contained resources, reference-by-display.
- **Epic-inspired quirks** harvested from the UnityPoint fixture: nonstandard Observation
  categories (`Lab` alongside `laboratory`, `smartdata`, `exam`, `functional-status`,
  `disability-status`), reference styles, extension noise that renderers must tolerate.
- Each type directory carries a `coverage.json` manifest: instance → elements exercised.
  Renderer golden tests assert (a) every fixture renders with **zero fallback-section
  leakage** for known types, and (b) the union of `coverage.json` covers the recorded
  must-support list — a mechanical breadth guarantee.
- Corpus is also reused as: validator positive fixtures, assemble-bundle inputs, e2e seed data.

## 11. Build plan & parallelization

Coherence strategy: **contracts-first kernel, then directory-disjoint parallel units.**
All coherence-bearing artifacts are built serially in Phase 0 and frozen; parallel agents
own non-overlapping directories and may not add dependencies or touch the kernel — interface
change requests route through the orchestrator.

**Phase 0 — kernel (serial, single context):**
- `lib/types.ts` (manage API request/response, fragment schema, script stdout JSON shapes),
  `lib/hkdf.ts`, `lib/jwe.ts`, `lib/shlink.ts` + their unit tests
- `server/src/db.ts` schema; root `package.json` (deps pinned), tsconfig, bunfig
- The **document-builder contract** `lib/doc.ts` (decision 18: semantic components on the
  bake-off-winning engine) + the markdown-adapter dialect spec for the agent easy path
- Fixture style guide (§10 rules) and the constant synthetic patient
- Repo `CLAUDE.md`: conventions every downstream agent prompt embeds (stdout JSON/stderr
  progress, secrets-to-files, error style, test layout)

**Phase A — parallel units (one workflow; disjoint directories):**
1. `server/` — data + control planes, sweeper, tickets, skill.zip builder, API tests
2. `skill/.../md-to-pdf.ts` — markdown → chosen layout engine (per Phase 0 bake-off) + themes + tests (self-contained)
3. `tests/fixtures/uscore/` + `fhir-render/` — a **pipeline over resource families**:
   generate fixtures → write that family's renderer module (fixed interface
   `render(resources, doc): void` against the lib/doc.ts builder + section registration) →
   golden test. Renderer framework
   (section ordering, shared table helpers, fallback renderer) is authored once at the
   head of this unit, then per-family modules plug in.
4. `app/` — handoff page against the frozen fragment schema + manage API types (Bun HTML
   import entry; React + qrcode)
5. `assemble-bundle.ts` + `validate-bundle.ts` — paired (assembler output must validate;
   validator negative fixtures authored here)
6. `create-shl.ts` + `manage-shl.ts` — against `lib/` + API types; integration deferred
7. SKILL.md partials + landing page copy — against the frozen script-reference contracts
A final **coherence sweep** stage reviews cross-unit drift (naming, error shapes, conventions)
before integration.
**Coverage critic** (end of unit 3): diff fixtures' recorded must-support coverage against
US Core profile lists; gaps become a second fixture round.

**Phase B — integration (serial-ish):**
wire skill.zip end-to-end; full-pipeline integration test (UnityPoint + synthetic corpus →
bundle → validate → local SHL → independent decrypt); agentic e2e scenarios; platform setup
guide; reconciliation fixes from the coherence sweep.

## 12. Phasing

- **Phase 1** (everything above): U-flag KTC flow end-to-end; full-spec server (manifest/P/L
  supported at the API level, exercised by tests, not surfaced in SKILL.md guidance);
  handoff page owner/viewer modes; US Core renderer; validator; skill.zip distribution +
  landing page + platform setup guide (Claude.ai network-toggle caveat).
- **Phase 2**: server-hosted viewer prefix that renders FHIR resources nicely + inline PDFs
  (receiver empathy / "try your own link"); monitor-mode UI; insurance card photo →
  CARIN DIC transcription.
- **Phase 3**: questionnaires / check-in protocol alignment (SMART Health Check-in direction).
