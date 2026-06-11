# Typst (via @myriaddreamin/typst-ts-node-compiler) — bake-off notes

## What was used

Option (1) from the brief worked on the first try: `@myriaddreamin/typst-ts-node-compiler`
v0.7.0 — a NAPI **native** binding to the Typst compiler (not WASM). Under Bun it loaded
and compiled with zero shims, zero config, zero workarounds. Options (2) WASM and
(3) CLI were never needed.

Architecture: `theme.typ` (Typst template: palettes, page/footer scaffold, title-block,
section show rule, pull-quote, callout, kv-panel, badge, lab-flag, data-table with
`table.header` repeating rows) + `doc.ts` (semantic builder emitting Typst code that
calls the template; compiles via NodeCompiler) + two thin entries
(`render-story.ts`, `render-summary.ts`).

## Bun compatibility friction

**None.** The native `.node` module loads cleanly under Bun. `NodeCompiler.create()`
with `workspace` + `fontArgs: [{fontPaths}]` just works. Diagnostics come back as
structured objects. This was the smoothest part of the whole exercise.

## Builder LOC

| File | LOC |
|---|---|
| `theme.typ` (template/components) | 268 |
| `doc.ts` (builder + compile glue) | 181 |
| `render-story.ts` | 71 |
| `render-summary.ts` | 122 |
| **Total** | **642** |

Zero layout math was hand-rolled. All pagination, cell wrapping, header repetition,
and footer placement is the engine's job. The "builder" is mostly string assembly:
JS data → Typst string literals → template function calls.

## Dependency footprint

- `node_modules`: **130 MB** total, but that includes *both* linux-x64-gnu and
  linux-x64-musl platform packages (51 MB each) plus typescript/@types (dev only).
- What actually ships in a portable skill zip:
  - `typst-ts-node-compiler.linux-x64-gnu.node` — **52.4 MB** (50 MB) per target platform.
    This is the compiled-asset blob (native, not WASM; the WASM all-in-one alternative
    is in the same ballpark). One per platform you support.
  - JS wrapper package — 60 KB.
  - `fonts/` (Source Serif 4 + Source Sans 3, 9 static TTFs) — **2.7 MB**.
  - `theme.typ` + `doc.ts` + entries — ~25 KB.
  - **Realistic zip: ~55 MB single-platform** (compresses to ~25 MB; the .node is the
    dominant cost). Multi-platform zips multiply the 50 MB blob.

## Render wall-time

- Both PDFs, cold (two separate `bun` process startups included): **0.24 s total**.
- `render-story.ts` alone: ~0.09 s; `render-summary.ts` alone: ~0.14 s.
- Warm in-process compile of summary (5 pages, 6 tables): **~120 ms**.
- Output: `story.pdf` 61 KB / 2 pages, `summary.pdf` 240 KB / 5 pages, all fonts
  embedded+subset (verified with `pdffonts`; no core-font fallback anywhere).

## SPEC components: easy / hard / impossible

- **Easy (native one-liners):** repeating table headers (`table.header`), page footer
  with "Page N of M" (`context counter(page).display(both: true)`), highlight spans
  (`highlight(fill:..)`), badges (`box(fill, stroke, radius)`), zebra striping
  (fill closure on row index), kv grid, callout (stroked block), accent-rule headings
  (show rule), justified text with proper kerning/ligatures, US-letter + margins.
- **Medium:**
  - Pull-quote: my first attempt used `line(angle: 90deg, length: 100%)` inside a
    `stack` — `100%` resolved against the remaining page height and produced a
    full-page vertical line. Fixed by using a left-stroked block. (Classic Typst
    gotcha: relative lengths resolve against the layout region.)
  - Long-URL breaking: Typst won't character-break an unbreakable token by default;
    the builder inserts zero-width spaces after `/.-?=&_` in URLs. 3 lines of JS.
  - Curly quotes: text injected as Typst *string literals* bypasses markup smartquotes,
    so the builder educates quotes itself (6 lines of JS).
- **Hard / abandoned:** preventing a tall table row from splitting across pages.
  `show table.cell: it => block(breakable: false, it.body)` corrupted row layout
  (overlapping rows — Typst measures cells itself and the wrapper broke that).
  Reverted; Typst's default behavior splits the row *cleanly* (no clipping, header
  still repeats above the continuation), which is acceptable and arguably correct
  for very tall rows.
- **Impossible:** nothing required by the SPEC.

## Torture checklist

| # | Result | Notes |
|---|---|---|
| T1 | **PASS** | Medications table spans pages 1–3; header row repeats on pages 2 and 3 (`table.header`) |
| T2 | **PASS** | Levothyroxine/ferrous sulfate/doxycycline/tramadol sigs wrap fully in-cell; no clipping/overlap (inspected at 200 dpi) |
| T3 | **PASS** | URL breaks after `/` and `-` via builder-inserted ZWSPs; fully inside 1 in margins (story p2) |
| T4 | **PASS** | "Methylmalonic acid with reflex…" wraps to 2 lines in its 2.1fr column; table undistorted (summary p4) |
| T5 | **PASS** | 9-column wideTable fits portrait at 6.5 pt, all columns present and legible; no clipping. One tall row splits cleanly across p4→p5 under a repeated header (permitted row break, not clipping) |
| T6 | **PASS** | `μg/dL`, `2.41 ± 0.05`, `mL/min/1.73m²`, em dashes, `·`, curly quotes all render (Source fonts cover them) |
| T7 | **PASS** | All 7 pages rendered to PNG and inspected; zero text outside margins |
| T8 | **PASS** | Footer (provenance line verbatim + "Page N of M") on every page of both PDFs |
| T9 | **PASS** | Every header placement verified followed by ≥1 data row (Typst's repeatable headers don't orphan) |
| T10 | **PASS** | No collisions; badges/panels/rules clean (after pull-quote fix) |

**10/10.**

## Overall take

Typst-via-NAPI is the "real typesetter for free" option. The torture checklist —
the exact failure modes that killed jsPDF — is simply not where the effort goes:
repeating headers, in-cell wrapping, footers, pagination and widow control are
engine primitives. The effort goes into (a) learning Typst's layout model (the one
real bug — the 100%-length pull-quote line — was a Typst semantics misunderstanding,
fixed in minutes), and (b) the string-escaping seam between JS data and Typst source
(solved generically with JSON-escaped string literals + quote educating + ZWSP URL
breaking). Render speed is effectively instant (~120 ms warm for 5 dense pages), which
matters for an interactive skill. **Biggest strength:** highest layout quality per
line of code of any approach here — 642 LOC total, no hand-rolled layout math, real
justification/kerning, and it survived all 10 torture items. **Biggest weakness:**
the 50 MB-per-platform native blob in the skill zip (and it's per-platform, so true
portability means either shipping several or switching to the equally large, slower
WASM build); plus generating a language as strings is a mild but real impedance
mismatch — escaping, quote education, and Typst-version coupling live in the builder.
