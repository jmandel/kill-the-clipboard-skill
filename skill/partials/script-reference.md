## Script Reference

All scripts: `bun <skill-dir>/scripts/<name>.ts`. One JSON object on stdout, progress
on stderr, nonzero exit + usage on error. Server URL defaults to `{{BASE_URL}}`;
`config.json` next to the scripts overrides; explicit URL argument wins. Usage details
are doc-commented at the top of each script.

| Script | Usage | Purpose / stdout |
|--------|-------|------------------|
| `assemble-bundle.ts` | `bun assemble-bundle.ts --resources selected-resources.json [--story story.pdf] [--rendered rendered.pdf] [--rendered-ids rendered-ids.json] -o bundle.json` | Builds the conformant PatientSharedBundle (urn rewriting + DocumentReference construction). Emits `{status, output, ...counts}`. |
| `render-fhir-pdf.ts` | `bun render-fhir-pdf.ts --resources selected-resources.json -o rendered.pdf --ids-out rendered-ids.json` | Runs AUTOMATICALLY inside assemble-bundle; standalone use is for previewing/regenerating the summary. |
| `md-to-pdf.ts` | `bun md-to-pdf.ts story.md [story.pdf]` | Markdown → themed PDF (story theme by default) for the Patient Story. |
| `attachment-to-pdf.ts` | `bun attachment-to-pdf.ts <input> [out.pdf] [--title T] [--date D]` | Pre-existing document body (text/RTF/HTML/PDF) → PDF attachment body. PDF passes through; the rest render line-faithfully. |
| `preview-pdf.ts` | `bun preview-pdf.ts file.pdf` | Renders PDF pages to PNGs (needs poppler). Available if a PDF ever needs eyeballing; nothing in the workflow requires it. |
| `validate-bundle.ts` | `bun validate-bundle.ts bundle.json [--rendered-ids rendered-ids.json]` | KTC conformance check. Exact stdout `{status: "pass"\|"fail", errors, warnings}`; exit 1 on errors. |
| `create-shl.ts` | `bun create-shl.ts --bundle bundle.json --label "..." [--exp-hours 24] [--max-uses 5] [--flag U] -o ./shl-out/` | Encrypts + uploads + registers the link. Secrets to files in `-o` dir (incl. `handoff.md`, the closing message to paste verbatim); exact non-secret stdout per Step 7. |
| `manage-shl.ts` | `bun manage-shl.ts <shl-out-dir\|owner-link-file> status\|log\|re-arm [--exp-hours 24] [--max-uses 5]\|pause\|resume\|relabel "..."\|replace --bundle new.json\|destroy --yes` | Inspect and control an existing link. One JSON object per verb. |
