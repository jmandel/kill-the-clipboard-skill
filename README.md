# kill-the-clipboard

An AI-agent skill + companion server that helps patients share their health records
with a clinic as a **SMART Health Link** — a QR code they control — meeting the CMS
health tech ecosystem / **"Kill The Clipboard"** (KTC) participation requirements.

The agent walks the patient through choosing what to share, writes the selection code,
helps them tell their story in their own words, renders everything to conformant
artifacts, and mints a managed, revocable link. The patient gets a QR to show at
check-in and a management page to watch and control it.

> **Status: working prototype.** Targets the draft
> ["Patient-Shared Health Documents via SMART Health Links"](https://ktc-spec.github.io/)
> profile ("Draft for July 2026") on top of the
> [SMART Health Links spec (STU 1)](https://hl7.org/fhir/uv/smart-health-cards-and-links/STU1/links-specification.html).
> Not a certified medical device; not production health infrastructure. Specs are
> drafts and this implementation will track them.

## What gets shared

One encrypted [`PatientSharedBundle`](https://ktc-spec.github.io/) (FHIR R4
`collection`), assembled by the skill's scripts:

- **Discrete FHIR resources** the patient selected — US Core content, with PAMI
  (problems, allergies, medications, immunizations) as the conventional core
- **A Patient Story PDF** (LOINC 51855-5) — the patient's own words, interviewed and
  drafted by the agent, approved verbatim by the patient
- **A FHIR-Rendered PDF** (LOINC 60591-5) — a complete human-readable rendering of
  every discrete resource in the bundle, for receivers that can't ingest FHIR

Receiving EHRs participating in KTC persist the PAMI content plus both PDFs into the
chart, labeled as patient-shared.

## How it works

```
agent's machine                         companion server                 clinic
──────────────────                      ──────────────────               ──────
selection script (agent-written)
  └─ selected-resources.json
render-fhir-pdf / md-to-pdf
assemble-bundle → validate-bundle
create-shl:
  M  = 32 random bytes (owner secret)
  key  = HKDF(M, "ktc-shl/v1/key")     never leaves this column
  auth = HKDF(M, "ktc-shl/v1/auth") ─▶ stored as sha256(auth)
  JWE(bundle, key) ─────────────────▶  ciphertext only
  QR = shlink:/{url, key, exp, …}                                  scan ─▶ GET url
                                       /shl/{id}?recipient=… ────────────▶ JWE
owner page /m#M ─────────────────────▶ manage API: status, access log,
                                       re-arm, pause, rename, revoke
```

Privacy by architecture: the server stores only ciphertext, a hashed control token
(sent via Authorization header, never URL paths), client-encrypted labels, link
settings, and an access log. It can never read the records it hosts — or even the
link's label — because every key derives client-side from the owner secret.

## Components

| Path | What it is |
|---|---|
| `lib/` | Frozen kernel: HKDF capability derivation, compact JWE (`dir`/`A256GCM`), shlink build/parse, shared API types, and the semantic PDF document builder (`doc.tsx` on @react-pdf/renderer, story + summary themes, CJK fallback) |
| `server/` | Single-process Bun server: SHL data plane (U-flag direct GET + full manifest protocol with passcode lockout), capability-URL manage API, retention sweeper, and per-request `skill.zip` builder that bakes its own public URL into the skill it vends |
| `app/` | The patient-facing handoff page (`/m` manage · `/v` view), served via Bun HTML imports. Owner mode (`#<secret>`): QR, usage, access log, re-arm/pause/rename/revoke, "Preview as recipient". Viewer mode (`#shlink:/…`): in-browser viewer: decrypts and renders the shared bundle, opens PDFs, also shows the QR — a working SHL viewer-prefix target. SMART Health IT visual language |
| `skill/` | The agent skill: `SKILL.md` (composed from `partials/`) plus Bun scripts — `assemble-bundle`, `validate-bundle`, `render-fhir-pdf` (15 US Core family renderers + fallback), `md-to-pdf`, `preview-pdf`, `create-shl`, `manage-shl` |
| `tests/fixtures/uscore/` | Synthetic US Core 9.0.0 breadth corpus: ~140 instances across 16 families, every must-support element and choice-type variant covered, audited (`COVERAGE-REPORT.md`) |
| `tests/fixtures/real-world/` | A real Epic/UnityPoint export, PII-masked by a reproducible script and adversarially audited (`SANITIZATION.md`) |
| `docs/bakeoff/` | The PDF-engine bake-off (pdfmake vs react-pdf vs Typst) that picked the document engine — kept as a decision record |
| `docs/DESIGN.md` | The full design record: 19+ numbered, settled decisions with rationale |

## Run it

Requires [Bun](https://bun.sh) ≥ 1.2 and `poppler-utils` (for PDF verification in tests).

```sh
bun install
bun test                 # default tier, ~7s (logic, server API, app, validators)
bun run test:render      # renderer golden tests, ~60s — run when touching PDF code
bun run test:all         # everything incl. the 100+-page volume tier (merge gate)

bun run server           # http://localhost:8000  (config.json / BASE_URL env)
```

Then:

- `http://localhost:8000/skill.zip` — download the agent skill, pre-configured to
  point at this server. Install it in Claude Code / Claude.ai / any agent runtime
  with shell + network access, and ask the agent to help you share your records.
- `http://localhost:8000/m` — the management page (opened via the owner link the
  skill's `create-shl` script produces).

A deployment sets `BASE_URL` (and a systemd unit is provided in `server/`); the
vended skill.zip self-configures to wherever it was downloaded from.

## Where the data comes from

Getting records *into* the agent's workspace is out of scope here. Anything that
produces FHIR JSON works; [health-skillz](https://health-skillz.joshuamandel.com)
is the recommended companion — it connects to patient portals and exports exactly
the kind of per-provider FHIR bundles this skill selects from.

## Specs and conformance

- [SMART Health Links — SMART Health Cards and Links IG v1.0.0](https://hl7.org/fhir/uv/smart-health-cards-and-links/STU1/links-specification.html):
  the server implements both the KTC path (U-flag, single encrypted file, `recipient`
  query, audit) and the full manifest protocol (P/L flags, lifetime passcode budget
  with transaction-safe decrement, short-lived HMAC-ticketed location URLs)
- [KTC profile](https://ktc-spec.github.io/): `validate-bundle.ts` enforces the
  PatientSharedBundle rules (collection type, single Patient, urn:uuid fullUrls, no
  meta.profile, inline-only attachments, DocumentReference profile incl. the
  patient-shared category and PATAST label) and cross-checks that the FHIR-Rendered
  PDF covers every discrete resource
- US Core 9.0.0: type-specific PDF renderers for every resource type, tested against
  the breadth corpus and the sanitized real-world export

## Development conventions

See `CLAUDE.md` (binding for human and AI contributors): frozen kernel, secrets never
on stdout, hostile-input FHIR handling, test tiers. The design history and every
settled decision live in `docs/DESIGN.md`.

## License

MIT — see [LICENSE](LICENSE).
