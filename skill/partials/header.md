---
name: kill-the-clipboard
description: |
  Help a patient share their health records with a clinic via a SMART Health Link (SHL).
  Use when the patient wants to "share my records" with a doctor or clinic, "prepare for
  a visit" or an appointment, "create a SMART Health Link", speed up "clinic check-in",
  or "kill the clipboard". Selects FHIR data with the patient, interviews them for an
  optional Patient Story PDF, renders a readable summary PDF, assembles a conformant
  PatientSharedBundle, encrypts it locally, and hosts it as a QR-scannable link the
  patient controls (expire, re-arm, revoke).
---

# Kill The Clipboard

Turn a patient's health records into a SMART Health Link they can present at clinic
check-in — a QR code that hands the front desk their medication list, allergies,
problems, immunizations, and their own story, instead of a clipboard form.

All encryption happens here, on the patient's side. The hosting server stores only
ciphertext; it never sees the records or the key.

**Prerequisites:** [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)
and, for visual PDF checks, `pdftoppm` from poppler-utils (`apt install poppler-utils`).
All scripts run with `bun <skill-dir>/scripts/<name>.ts`. Before first use, run
`bun install` once inside `<skill-dir>/scripts/` (a pinned `package.json` + lockfile
ship in the zip; the install pulls the PDF/QR libraries the scripts need).
