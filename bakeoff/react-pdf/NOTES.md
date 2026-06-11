# NOTES — @react-pdf/renderer candidate

Engine: `@react-pdf/renderer@4.5.1` + `react@19.2.7`, Bun 1.3.14, Linux.

## Bun compatibility friction

Essentially zero. `renderToFile` worked first try under Bun — no Yoga/WASM shims, no
flags, no patching. `@react-pdf/renderer` 4.x uses pure-JS `yoga-layout` bindings that
load cleanly in Bun. The only console noise is React's "unique key prop" dev warning
(cosmetic; from passing element arrays to `<Page>`). TSX support is native to Bun, so no
build step at all.

## Architecture / builder

- `doc.tsx` — semantic builder: `title, section, para (highlight/italic/url spans),
  pullQuote, bulletList, callout, kvPanel, table (repeating headers), badge,
  pageFooter, page, renderDoc` + two themes (story serif / summary sans). **696 LOC.**
- `render-story.ts` — minimal markdown parse (H1/H2/blockquote/bullets/`==…==`/bare
  URLs) → builder calls. **105 LOC.**
- `render-summary.ts` — JSON → builder calls. **172 LOC.**
- Total: **973 LOC**, of which ~250 is StyleSheet-ish theming verbosity.

Hand-rolled layout math: almost none. Column widths are percentage weights; everything
else is flexbox. The two non-obvious tricks (both discovered by reading
`@react-pdf/layout` source, then verified in rasters):

1. **Repeating table headers**: header row gets the `fixed` prop *inside* the table
   View. When the layout engine splits a node across pages it copies `fixed` children
   into every continuation chunk and re-runs flow layout, so the header lands at the
   top of each continuation — even for tables that start mid-page (verified: the
   allergies table split mid-page with a correct repeated header). Rows get
   `wrap={false}` so they never split mid-row.
2. **Char-level breaking for monster tokens** (the ~100-char URL, long chemical
   names): `Font.registerHyphenationCallback` chunks any word > 22 chars into 11-char
   pieces. Side effect: react-pdf draws a synthetic hyphen at those break points
   (e.g. "carboxymet-/hylcellulose"); fine for print, would corrupt copy-paste of the
   URL slightly. Acceptable trade; documented here.

## Fonts

Source Serif 4 (400/400i/600/700) + Inter (400/500/600/700), static OFL TTFs from
fonts.gstatic.com, 2.0 MB total in `fonts/`. `pdffonts` confirms all text is embedded,
subsetted CID TrueType — zero core-font fallback. μ, ±, ², —, ·, curly quotes all render.

## Dependency footprint

- `node_modules`: **62 MB installed**, but 29 MB is dev-only (typescript 23M, @types
  2.6M, bun-types 3.7M). Runtime-only ≈ **33 MB / 73 packages**: @react-pdf 3.0M,
  hyphen 9.7M (locale dictionaries — prunable to ~200 KB since we override hyphenation),
  fontkit 5.7M, @noble 2.9M, yoga-layout 324K, react 260K.
- Portable skill zip would ship: `doc.tsx` + 2 entry scripts (~30 KB), `fonts/` 2.0 MB,
  runtime node_modules ≈ 33 MB raw (≈ 24 MB with hyphen pruned; compresses to roughly
  8–10 MB zipped).

## Render wall-time (Bun, this machine)

- story.pdf (2 pages): **~0.40 s** wall (204 ms in-process). Cold ≈ warm.
- summary.pdf (6 pages, 92 table rows): **~1.5 s** wall (1.33 s in-process).
  Pagination relayout is the cost: each page split re-runs yoga + text layout.

## SPEC components: easy / hard / impossible

- **Easy**: title block, section accent rules, paragraphs, callout, kvPanel (flex-wrap
  2-col grid), badges, footer with `Page N of M` (`render={({pageNumber,totalPages})}`
  is first-class), justified text, zebra striping, landscape page for the wide table.
- **Medium**: highlight spans — inline `backgroundColor` on nested `<Text>` just works,
  but is undocumented-ish; pull-quote needed manual flex composition; badge chips
  needed `maxWidth:'100%'` + width tuning to stop label overflow (first attempt
  collided with the adjacent column — caught in raster review).
- **Hard**: repeating table headers — not a documented feature; required reading the
  splitter source to trust the `fixed`-row-inside-table pattern. A widowed header is
  still theoretically possible if a table starts in the last ~40pt of a page; mitigated
  with `minPresenceAhead` on section headings. Edge case where the final split chunk
  could be header-only exists in the engine; did not occur in these documents.
- **Impossible/gaps**: none for this spec. (No native "table" primitive at all, though —
  everything is flexbox you build yourself.)

## Torture checklist

| # | Result | Notes |
|---|--------|-------|
| T1 | **PASS** | Meds table spans pages 1–3 (summary), header repeated on pp. 2 and 3 |
| T2 | **PASS** | Levothyroxine/ferrous sulfate/doxycycline/tramadol sigs wrap fully in-cell; rows grow; `wrap={false}` keeps rows atomic |
| T3 | **PASS** | URL breaks at char level inside margins (smaller, accent-colored treatment); engine inserts a visual hyphen at break points |
| T4 | **PASS** | "Methylmalonic acid with reflex…" wraps to 4 lines inside its column, table undistorted |
| T5 | **PASS** | 9-column wideTable rendered on a landscape page (permitted; noted), 6.4pt cells, all columns and full text legible, no clipping |
| T6 | **PASS** | μg/dL, 2.41 ± 0.05, mL/min/1.73m², em dashes, curly quotes all correct (subset-embedded) |
| T7 | **PASS** | All 8 pages inspected at 120–200 dpi; nothing outside margins |
| T8 | **PASS** | Fixed footer (provenance + "Page N of M") on every page of both PDFs, incl. landscape |
| T9 | **PASS** | No widowed header observed; every header is followed by ≥1 row (page boundaries land after ≥2 rows) |
| T10 | **PASS** | Initial build FAILED here (badge text overflowed chips into the date column); fixed via column widths + `maxWidth` + letter-spacing; re-verified clean |

10/10 after one iteration.

## Overall take

react-pdf is the "it just works under Bun" candidate. The declarative flexbox model plus
a real pagination engine means I wrote no layout math: long cells, page splits, footers
and totals are engine concerns. Output typography is genuinely good (real kerning,
subsetting, justified serif body reads like a letter). **Biggest strength**: semantic
builder maps 1:1 to components with first-class `Page N of M` and a pagination engine
that survives every torture case; lowest implementation effort imaginable for this
quality bar. **Biggest weakness**: repeating table headers are an undocumented emergent
behavior of the `fixed` prop rather than a feature — it works (verified in source and
pixels) but is the kind of thing a minor version could break; plus a moderately heavy
runtime dep tree (~33 MB raw, ~73 packages) and ~1.5 s for a dense 6-page document.
