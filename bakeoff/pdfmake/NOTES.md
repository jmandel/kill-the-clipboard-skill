# pdfmake candidate — evaluation notes

Engine: **pdfmake 0.3.10** (declarative doc-definition model, pdfkit underneath), run
server-side under **Bun 1.3.14** via the package's Node entry (`js/index.js` singleton:
`setFonts` / `createPdf` / `OutputDocumentServer.write`).

## Bun compatibility friction

- **Zero Bun-specific friction.** pdfmake + pdfkit + fontkit are pure JS; no native
  modules, no shims. `bun render-*.ts` just works, TypeScript included.
- Friction encountered was **pdfmake 0.3 API churn**, not Bun:
  1. Passing font files as `Buffer`s (the documented Node pattern for 0.2/PdfPrinter)
     crashes 0.3's `URLResolver` (`url.toLowerCase` on a Buffer-wrapped object).
     Workaround: load TTFs into `pdfmake.virtualfs` and reference by name (3 lines).
  2. `pageBreakBefore` changed signature in 0.3: the 2nd arg is now an accessor object
     (`getFollowingNodesOnPage()` etc.), not an array. The widely-documented 0.2 recipe
     silently never fires. Found by reading `LayoutBuilder.js`.
  3. 0.3 prints access-policy warnings unless you call `setUrlAccessPolicy` /
     `setLocalAccessPolicy` (a nice security feature, but undocumented noise).

## Builder LOC

| file | LOC |
|---|---|
| `doc.ts` (semantic builder: title/section/para/pullQuote/callout/kvPanel/table/badge/list/pageFooter/render, 2 themes) | 502 |
| `render-story.ts` (minimal md parse → builder) | 84 |
| `render-summary.ts` (JSON → builder) | 120 |
| **total** | **706** |

Zero hand-rolled layout math: no cursor tracking, no manual page breaks, no text
measurement. The only "math" is fixed column-width picks and a 90pt keep-with-next
threshold.

## Dependency footprint

- `du -sh node_modules` → **69 MB**, but ~31 MB of that is dev tooling from `bun init`
  (typescript 23M, bun-types, @types).
- pdfmake runtime closure (pdfmake, pdfkit, fontkit, linebreak, xmldoc, sax + fontkit/pdfkit
  transitive deps) ≈ **32 MB** installed.
- Prunable for a skill zip: `pdfmake/build/` (14 MB browser bundles), `pdfmake/fonts/`
  (644K bundled Roboto), pdfkit ships 3 redundant builds in `js/` (4.5 MB, only one needed).
  Realistic shipped subset: **~10–14 MB of JS** + **2.1 MB fonts** (10 static TTFs,
  Source Serif 4 + Source Sans 3, latin/latin-ext/greek, OFL via google-webfonts-helper)
  + 0.7 KB of our scripts. Zipped, roughly 4–5 MB.

## Render wall-time

(median of 3, includes Bun startup + font load; in-process layout time in parens)

- `story.pdf` (2 pages): **~270 ms** process (~120 ms in-process)
- `summary.pdf` (7 pages, 90+ table rows): **~455 ms** process (~240–300 ms in-process)
- Cold ≈ warm (no JIT/cache effect worth mentioning; Bun transpile cache makes run 1 ≈ run 3).

## SPEC components: easy / hard / impossible

**Easy (native or near-native):**
- Title block, section accent rules (stack + canvas lines), body text, lists.
- Repeating table headers: `headerRows: 1` — completely free, survives 3-page table.
- "Page N of M": footer callback receives `pageCount` natively.
- Highlight spans: text `background` property — free.
- Callout / kvPanel / pull-quote: single-cell tables with custom layout objects.
- Custom fonts: 4-variant family map + virtualfs; semibold as a second family for
  weight hierarchy.
- Per-section landscape rotation: `pageBreak + pageOrientation` on one node (used for
  the 9-column wideTable; portrait would have needed ~6pt type).
- Long-URL breaking: pdfmake uses a real UAX#14 line breaker (`linebreak` pkg), so the
  100-char URL wraps after `/` and `-` with no manual zero-width-space injection.

**Hard (cost real debugging):**
- **Badges**: the obvious nested-table-with-fill chip renders UNDER the parent row's
  zebra fill when `dontBreakRows` is on (unbreakable-block fill vectors are spliced to
  the background layer at a fixed index, reversing z-order). Rebuilt badges as
  NBSP-padded text with `background` (decoration layer → always above fills).
- **Keep-with-next for headings**: no native support. The `pageBreakBefore` hook is the
  designed answer but a following table registers a phantom start position on the
  heading's page, so "no following nodes on this page" fails. Solved with a
  remaining-space heuristic (force break if <90pt left below a heading). Works, but it's
  a heuristic, not a guarantee.

**Impossible / gaps:**
- Rounded pill corners on badges (table fills are rectangles; would need canvas overlay
  hacks). Chips are square-cornered.
- True keep-with-next semantics (see above — approximated).
- No other gaps: every SPEC component is genuinely expressed.

## Torture checklist

| # | Result | Evidence |
|---|---|---|
| T1 | **PASS** | Medications spans pages 2–4; teal header row repeats on p3 and p4 |
| T2 | **PASS** | Levothyroxine/ferrous (p2), doxycycline/tramadol (p4) sigs wrap fully; `dontBreakRows` keeps each row intact, no clip/overlap |
| T3 | **PASS** | URL breaks after `/`/`-` (UAX#14), 2 lines, inside 1" margins (story p2) |
| T4 | **PASS** | Methylmalonic… wraps to 3 lines in Test column, row heights uniform (p5) |
| T5 | **PASS** | wideTable on landscape p7 (rotation permitted by SPEC and noted); all 9 columns, 6.8pt, no clipping; footer adapts to landscape width |
| T6 | **PASS** | μg/dL, 2.41 ± 0.05, mL/min/1.73m², em dashes all render (required re-pulling fonts with the greek subset — first build showed .notdef for μ; caught on PNG inspection) |
| T7 | **PASS** | All 9 pages inspected at 120–220 dpi; no content outside margins |
| T8 | **PASS** | Footer (provenance verbatim + "Page N of M") on every page of both PDFs, incl. landscape |
| T9 | **PASS** | `keepWithHeaderRows: 1` + `dontBreakRows`; closest call is Labs header + 1 data row at p4 bottom — header never alone |
| T10 | **PASS** | Badges are in-text backgrounds (cannot collide); panels/rules/text clean on all pages |

10/10.

## Overall take

pdfmake is a strong fit for this pipeline. The declarative model means the builder is
~500 LOC of *styling*, not layout engineering — pagination, repeating headers, page
totals, cell wrapping, and UAX#14 word breaking are all engine-owned, which is exactly
the class of work that killed the jsPDF attempt. It runs on Bun with literally zero
runtime friction and renders both documents in under half a second.

The costs: (1) the 0.3 API is newer than most of its documentation, and two of its
sharp edges (Buffer fonts, `pageBreakBefore` signature) required reading library
source; (2) z-ordering of fills inside unbreakable rows is buggy/surprising, which
limits how fancy chips/panels inside tables can get; (3) no keep-with-next means
heading orphan control is heuristic; (4) ~10–14 MB minimum shippable JS is heavier
than a hand-rolled pdfkit solution would be, lighter than anything browser-based.

Biggest strength: highest layout-correctness-per-line-of-code; the entire torture list
passes with almost no hand-rolled geometry.
Biggest weakness: fill z-order quirks + heuristic heading control — polish beyond
"clean clinical document" starts fighting the engine.
