## Background: What "Kill The Clipboard" Is

"Kill The Clipboard" (KTC) is part of the CMS health tech ecosystem initiative:
participating providers, EHR vendors, and apps committed to letting patients arrive
at a visit with a QR code instead of a paper intake form. The patient presents a
**SMART Health Link (SHL)**; the clinic scans it, the contents decrypt on the
receiver's side, and the patient's shared data lands in the chart.

### What you are producing

One **PatientSharedBundle** — a FHIR collection bundle containing:

1. **Exactly one Patient resource** with matching demographics (name, birth date, sex)
2. **Discrete US Core resources the patient chose to share** — anything from their
   record. The patient's choice is the whole point: scope the share to the visit
   and the patient's wishes, not to any fixed category list.
3. **A Patient Story PDF** (optional but valuable): the patient's own words — concerns,
   corrections, context, goals for the visit. It should NOT restate the discrete
   clinical facts; the data already carries those.
4. **A FHIR-Rendered PDF**: a complete human-readable rendering of every discrete
   resource in the bundle, so a clinic that can't ingest FHIR still gets everything.

The bundle is encrypted locally and uploaded as ciphertext; the SHL QR encodes the
fetch URL plus the decryption key. The server never sees plaintext or keys.

### What the receiving clinic does with it

Set the patient's expectations honestly — and keep the framing simple: **you choose
what to share, and the clinic sees everything you shared.** That's the message.

- The clinic receives the full bundle and files it into the chart, **labeled as
  patient-shared** (clinicians always see this came from the patient).
- **A clinician may review before filing.** The data doesn't necessarily appear in
  the chart instantly; staff may reconcile it the way they would any outside records.
- Receiver-side spec details (minimum-persistence categories and the like) are not
  useful frames for scoping or for talking to the patient — leave them out of the
  conversation and out of your reasoning. Scope by what's relevant to THIS visit and
  what the patient wants.
- **Rollout is staged.** Participants are piloting acceptance from around **April
  2026**, with broader availability targeted around **July 2026** (this skill targets
  the July 2026 draft of the KTC specification). Many clinics can't scan these yet.
  The link costs the patient nothing to offer — worst case the front desk says "we
  can't take that yet" and the visit proceeds as usual. Don't oversell.

### How the link behaves

- The link **expires** (default 24 hours) and has a **use limit** (default 5 scans).
  Either limit can be lifted later — the patient or you can "re-arm" an expired link
  without rebuilding anything, as long as it hasn't been destroyed or purged.
- The patient holds an **owner page** link: a private URL that shows the QR, the
  access log (who fetched, when), and controls to re-arm, pause, relabel, or destroy.
- Anyone with the QR (or the shlink URL inside it) can read the share until it
  expires, runs out of uses, or is revoked. Treat both the owner link and the shlink
  as secrets (see the secrets section).
