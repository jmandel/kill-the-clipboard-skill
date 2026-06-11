# PDF Engine Bake-off — Shared Specification

You are an engineer-agent implementing one candidate PDF engine. Every engine renders
**exactly the same content** from this directory and is judged on identical criteria.
Do not invent content; do not omit content.

## Inputs (this directory, read-only)

| File | Purpose |
|---|---|
| `story.md` | Source for `story.pdf` (Patient Story, "story" theme) |
| `summary-data.json` | Source for `summary.pdf` (FHIR-Rendered Summary, "summary" theme) |
| `SPEC.md` | This document |

## Deliverables

Produce exactly two PDFs:

1. **`story.pdf`** — rendered from `story.md` using the **story theme** (serif, warm, letter-like).
2. **`summary.pdf`** — rendered from `summary-data.json` using the **summary theme** (sans, dense, clinical).

Both: **US Letter (8.5 × 11 in)**, generous margins (≥ 0.75 in; ~1 in preferred for story),
portrait orientation.

## Required semantic components

Each engine MUST demonstrate all of the following. If your engine cannot express one,
approximate it as closely as possible and document the gap.

1. **Title block** — document title, patient name, DOB, and document date, visually grouped
   at the top of page 1.
2. **Section headings** — H2-level headings with an accent rule (colored line/bar associated
   with the heading).
3. **Body paragraphs** — justified or ragged-right at your discretion; consistent leading.
4. **Pull-quote** — the blockquote in `story.md` rendered as a visually distinct pull-quote
   (not a default grey `>` indent).
5. **Highlight styling** — `==text==` spans in `story.md` are patient-emphasized text; render
   with a highlight treatment (e.g., soft background tint). Do NOT print the literal `==` marks.
6. **Callout / info panel** — a boxed informational panel. In `summary.pdf`, use it for a
   "How this document was shared" panel containing the provenance text (see Footer below)
   plus one sentence explaining that the patient shared this via a SMART Health Link.
7. **Key-value panel** — patient demographics from `summary-data.json` `patient` object,
   laid out as a 2-column key/value grid (Name, DOB, Sex, MRN, Generated).
8. **Data table with repeating header rows** — when a table breaks across pages, the header
   row MUST repeat on every continuation page. This is mandatory for the Medications table.
9. **Status badges** — colored chips/pills for:
   - allergy `criticality`: `high` (red family), `low` (neutral/green family),
     `unable-to-assess` (amber/grey family);
   - medication `status`: `active`, `stopped`, `completed` (three visually distinct chips).
10. **Page footer on EVERY page** of both PDFs, containing:
    - page number — "Page N of M" if your engine supports total-page counts, else "Page N";
    - the provenance line, verbatim:
      `Shared by the patient via SMART Health Link — June 10, 2026`

## summary.pdf required structure (in order)

1. Title block ("Health Summary" or similar + patient identity + generated date)
2. Demographics key-value panel
3. "How this document was shared" callout
4. **Problems** — table or list: condition, clinical status, onset (12 rows)
5. **Medications** — table: name, dose, sig, status (badge), authored, prescriber — all 40
   rows; WILL cross page boundaries; headers must repeat
6. **Labs** — table: test, value, unit, reference range, interpretation, date (25 rows);
   visually flag HIGH/LOW interpretations
7. **Allergies** — substance, reaction, criticality (badge), status (6 rows)
8. **Immunizations** — vaccine, date, status (8 rows)
9. **`wideTable`** — render the 9-column dataset legibly: shrink font, wrap cells, and/or
   adjust column widths. Horizontal overflow or clipped text = failure. Dropping columns
   = failure. (Landscape rotation for this one section is permitted if your engine supports
   it; note it in your writeup.)

## story.pdf required structure

Render `story.md` faithfully: H1 title block (fold in patient name/DOB/visit-date line),
H2 sections with accent rules, paragraphs, the pull-quote, the bulleted list, highlight
spans, and the long URL (must wrap or break legibly inside the margins — see torture
checklist).

## Typography (hard requirement)

- **Embed real OFL-licensed fonts.** Serif for story body (e.g., Source Serif 4 or Lora);
  sans for summary (e.g., Inter or Source Sans 3). Pick one serif + one sans and embed them.
- Falling back to system/core PDF fonts (Helvetica, Times, Courier, etc.) anywhere =
  **automatic disqualification from the beauty score**.
- Fonts must support the unicode in the data: `μ`, `±`, `²`, `—`, `·`, curly quotes.
- Establish hierarchy with size/weight, not just bold.

## Torture checklist (output MUST survive all of these)

- [ ] **T1** Medications table (40 rows) spans ≥ 2 pages with header row repeated on each page
- [ ] **T2** The 200+ char sig texts (levothyroxine, ferrous sulfate, doxycycline, tramadol)
      wrap fully inside their cells — no clipping, no overlap with adjacent cells/rows
- [ ] **T3** The ~100-char unbreakable URL in `story.md` stays inside the margins
      (character-level breaking or a smaller treatment is fine; overflow is not)
- [ ] **T4** The absurdly long lab test name ("Methylmalonic acid with reflex…") wraps
      inside its column without distorting the table
- [ ] **T5** The 9-column `wideTable` fits the page with all columns and all cell text legible
- [ ] **T6** Unicode renders correctly: `μg/dL`, `2.41 ± 0.05`, `mL/min/1.73m²`, em dashes
- [ ] **T7** Zero text outside the page margins, anywhere, in either PDF (inspect every page)
- [ ] **T8** Footer (page number + provenance line) present on every page of both PDFs
- [ ] **T9** No widowed table header (header row alone at the bottom of a page)
- [ ] **T10** No content overlap: badges, rules, panels, and text never collide

These are exactly the failure modes that killed the prior jsPDF implementation
(text running off pages, broken wrapping and spacing). Verify by opening the PDFs, not by
assuming the library handles it.

## Judging criteria

| Criterion | What's measured |
|---|---|
| **Beauty** | Typography quality, spacing rhythm, visual hierarchy, badge/panel polish. Core-font fallback = 0. |
| **Torture survival** | T1–T10 pass/fail count; T7 failures weigh heaviest |
| **Implementation effort** | Lines of code, "hours-feel", how much layout math you hand-rolled |
| **Bun friction** | Does it run cleanly under Bun? Workarounds, shims, native-module pain |
| **Dependency weight** | `node_modules` size and what would actually ship inside a skill zip (including fonts) |
| **Render speed** | Wall-clock time to produce both PDFs, cold and warm |

## Reporting

Alongside `story.pdf` and `summary.pdf`, report: LOC, dependency list + installed size,
render times, T1–T10 results (with page numbers for any failure), and any spec gaps or
workarounds. Keep it terse and factual.

---
*Repo note (2026-06-10): heavyweight artifacts (downloaded font copies, output PDFs,
most rasterized pages, lockfiles) were pruned before publishing; each engine keeps its
sources, NOTES.md, and two representative pages (story-1, summary-2). Re-run any
candidate per its NOTES.md to regenerate. Verdict: react-pdf (DESIGN.md decision 19).*
