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
check-in — a QR code that hands the front desk whatever the patient chose to share,
plus their own story, instead of a clipboard form.

All encryption happens here, on the patient's side. The hosting server stores only
ciphertext; it never sees the records or the key.

**Prerequisites:** [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).
Poppler is OPTIONAL — only `preview-pdf.ts` uses it; every render works without it.

**Set up the scripts FIRST — locate, copy to a writable workspace, install.** Installs
vary (claude.ai mounts skills READ-ONLY under `/mnt/skills`; manual unzips and flat
copies differ too), and `bun install` plus your outputs need a writable directory —
copying is the expected step, not a workaround:

```bash
SRC=$(dirname "$(find . /mnt/skills -name 'create-shl.ts' -not -path '*/node_modules/*' 2>/dev/null | head -1)")
cp -r "$SRC" ./ktc-scripts && SCRIPTS=./ktc-scripts
bun install --cwd "$SCRIPTS"   # once per session; pulls the pinned PDF/QR libraries
```

Every command in this document writes `<skill-dir>/scripts/` — substitute your
`$SCRIPTS`. **Never discard stderr** (no `2>/dev/null` on these scripts — progress
and every error explanation live there). If a script exits 1 with no JSON on stdout,
run it by itself and read stderr: `error: Module not found` means the path is wrong
(re-locate); anything else is a real error message. Don't chain script invocations
with `&&` until each has succeeded once on its own.
