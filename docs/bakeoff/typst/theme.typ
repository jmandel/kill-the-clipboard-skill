// theme.typ — shared visual language for the bake-off documents.
// Two themes: "story" (serif, warm, letter-like) and "summary" (sans, dense, clinical).

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
#let palettes = (
  story: (
    accent: rgb("#9a4a2e"),        // warm terracotta
    accent-soft: rgb("#9a4a2e").lighten(88%),
    ink: rgb("#2b2118"),
    muted: rgb("#7a6a5c"),
    highlight: rgb("#f7e7b1"),     // soft warm tint for ==spans==
    rule: rgb("#d8c7b6"),
  ),
  summary: (
    accent: rgb("#155e75"),        // clinical teal-blue
    accent-soft: rgb("#155e75").lighten(92%),
    ink: rgb("#1c2430"),
    muted: rgb("#5b6878"),
    highlight: rgb("#fdeec0"),
    rule: rgb("#c9d4dd"),
  ),
)

#let badge-colors = (
  // medication / generic statuses
  active: (fill: rgb("#e3f2e6"), stroke: rgb("#3e7d4f"), text: rgb("#255c35")),
  stopped: (fill: rgb("#fbe5e2"), stroke: rgb("#b3473a"), text: rgb("#8f3328")),
  completed: (fill: rgb("#e4edf6"), stroke: rgb("#3e6b99"), text: rgb("#2c5078")),
  // allergy criticality
  high: (fill: rgb("#fbe0dd"), stroke: rgb("#b3382a"), text: rgb("#922a1f")),
  low: (fill: rgb("#e7f1e8"), stroke: rgb("#4a7d57"), text: rgb("#33603e")),
  unable-to-assess: (fill: rgb("#fdf2d7"), stroke: rgb("#a8802a"), text: rgb("#7c5e1d")),
  // problems
  inactive: (fill: rgb("#eceff3"), stroke: rgb("#7c8794"), text: rgb("#525d6a")),
  resolved: (fill: rgb("#e4edf6"), stroke: rgb("#3e6b99"), text: rgb("#2c5078")),
  // lab interpretation flags
  HIGH: (fill: rgb("#fbe0dd"), stroke: rgb("#b3382a"), text: rgb("#922a1f")),
  LOW: (fill: rgb("#fdf2d7"), stroke: rgb("#a8802a"), text: rgb("#7c5e1d")),
  NORMAL: (fill: rgb("#eef2f0"), stroke: rgb("#7e8c85"), text: rgb("#55635c")),
)

// ---------------------------------------------------------------------------
// Document scaffold
// ---------------------------------------------------------------------------
#let conf(theme: "story", provenance: "", body) = {
  let pal = palettes.at(theme)
  let is-story = theme == "story"
  let body-font = if is-story { "Source Serif 4" } else { "Source Sans 3" }
  let footer-font = if is-story { "Source Sans 3" } else { "Source Sans 3" }

  set page(
    paper: "us-letter",
    margin: if is-story {
      (top: 1in, bottom: 1in, left: 1in, right: 1in)
    } else {
      (top: 0.8in, bottom: 0.85in, left: 0.75in, right: 0.75in)
    },
    footer: context {
      set text(font: footer-font, size: 7.5pt, fill: pal.muted)
      line(length: 100%, stroke: 0.5pt + pal.rule)
      v(4pt)
      grid(
        columns: (1fr, auto),
        align: (left + horizon, right + horizon),
        [#text(style: "italic")[#provenance]],
        [Page #counter(page).display("1 of 1", both: true)],
      )
    },
    footer-descent: 24%,
  )

  set text(
    font: body-font,
    size: if is-story { 10.5pt } else { 9pt },
    fill: pal.ink,
    lang: "en",
  )
  set par(
    leading: if is-story { 0.72em } else { 0.6em },
    spacing: if is-story { 1.05em } else { 0.85em },
    justify: is-story,
  )

  // H2-style section heading with accent rule
  show heading.where(level: 2): it => {
    set text(
      font: body-font,
      size: if is-story { 13.5pt } else { 11.5pt },
      weight: if is-story { "semibold" } else { "bold" },
      fill: pal.accent,
    )
    block(above: if is-story { 1.9em } else { 1.6em }, below: 0.9em, sticky: true)[
      #it.body
      #v(-2pt)
      #stack(dir: ltr, spacing: 0pt,
        line(length: 2.2em, stroke: 2.25pt + pal.accent),
        line(length: 100% - 2.2em, stroke: 0.75pt + pal.rule),
      )
    ]
  }

  show link: set text(fill: pal.accent)

  body
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Title block: title + identity strip, visually grouped.
#let title-block(theme: "story", title: "", subtitle: none, meta: ()) = {
  let pal = palettes.at(theme)
  let is-story = theme == "story"
  block(below: if is-story { 2em } else { 1.5em })[
    #if is-story {
      line(length: 100%, stroke: 2.5pt + pal.accent)
      v(10pt)
      text(size: 23pt, weight: "semibold", fill: pal.ink, title)
      if subtitle != none {
        v(6pt)
        text(size: 11pt, style: "italic", fill: pal.muted, subtitle)
      }
      v(8pt)
      if meta.len() > 0 {
        text(size: 9.5pt, font: "Source Sans 3", fill: pal.muted, tracking: 0.4pt,
          upper(meta.map(m => [#text(weight: "semibold", fill: pal.accent, m.at(0)) #m.at(1)]).join([#h(0.9em)·#h(0.9em)])))
      }
      v(10pt)
      line(length: 100%, stroke: 0.75pt + pal.rule)
    } else {
      block(width: 100%, fill: pal.accent, inset: (x: 16pt, y: 13pt), radius: 4pt)[
        #text(font: "Source Sans 3", size: 20pt, weight: "bold", fill: white, title)
        #if subtitle != none [
          #v(3pt)
          #text(size: 10pt, fill: white.transparentize(18%), subtitle)
        ]
        #if meta.len() > 0 [
          #v(5pt)
          #text(size: 9pt, fill: white.transparentize(10%),
            meta.map(m => [#text(weight: "semibold", m.at(0)) #m.at(1)]).join([#h(0.8em)·#h(0.8em)]))
        ]
      ]
    }
  ]
}

// Highlight span (patient-emphasized text)
#let hl(theme: "story", body) = {
  let pal = palettes.at(theme)
  highlight(fill: pal.highlight, extent: 1.2pt, top-edge: 0.85em, bottom-edge: -0.25em, body)
}

// Pull-quote
#let pull-quote(theme: "story", body) = {
  let pal = palettes.at(theme)
  block(above: 1.7em, below: 1.7em, inset: (left: 1.8em, right: 1.8em), breakable: false)[
    #block(stroke: (left: 2.5pt + pal.accent), inset: (left: 1.3em, top: 1pt, bottom: 1pt))[
      #set text(size: 12.5pt, style: "italic", fill: pal.accent.darken(15%))
      #set par(justify: false, leading: 0.68em)
      #text(size: 21pt, baseline: 3pt, fill: pal.accent)[“]#body
    ]
  ]
}

// Callout / info panel
#let callout(theme: "summary", title: none, body) = {
  let pal = palettes.at(theme)
  block(
    width: 100%,
    fill: pal.accent-soft,
    stroke: (left: 2.5pt + pal.accent, rest: 0.5pt + pal.rule),
    inset: (x: 12pt, y: 10pt),
    radius: (top-right: 4pt, bottom-right: 4pt),
    above: 1.3em, below: 1.3em,
    breakable: false,
  )[
    #if title != none [
      #text(size: 0.95em, weight: "bold", fill: pal.accent, tracking: 0.5pt, upper(title))
      #v(4pt)
    ]
    #set par(justify: false)
    #body
  ]
}

// Key-value panel: pairs laid out two kv-pairs per row.
#let kv-panel(theme: "summary", pairs) = {
  let pal = palettes.at(theme)
  let cells = ()
  for p in pairs {
    cells.push(text(size: 7.5pt, weight: "semibold", fill: pal.muted, tracking: 0.6pt, upper(p.at(0))))
    cells.push(text(size: 9.5pt, weight: "medium", fill: pal.ink, p.at(1)))
  }
  block(
    width: 100%,
    fill: pal.accent-soft.lighten(40%),
    stroke: 0.5pt + pal.rule,
    inset: (x: 14pt, y: 11pt),
    radius: 4pt,
    above: 1.2em, below: 1.2em,
    breakable: false,
  )[
    #grid(
      columns: (auto, 1fr, auto, 1fr),
      column-gutter: 10pt,
      row-gutter: 7pt,
      align: (left + horizon, left + horizon, left + horizon, left + horizon),
      ..cells,
    )
  ]
}

// Status badge / chip
#let badge(kind, label) = {
  let c = badge-colors.at(kind, default: (fill: luma(235), stroke: luma(120), text: luma(60)))
  box(
    fill: c.fill,
    stroke: 0.5pt + c.stroke,
    radius: 6pt,
    inset: (x: 5pt, y: 0pt),
    outset: (y: 2.5pt),
    baseline: 0pt,
    text(size: 6.8pt, weight: "semibold", fill: c.text, tracking: 0.3pt, upper(label)),
  )
}

// Lab interpretation flag (text treatment, lighter than a chip)
#let lab-flag(kind) = {
  if kind == "NORMAL" {
    text(size: 0.9em, fill: luma(130), [—])
  } else {
    badge(kind, kind)
  }
}

// Data table with repeating header row.
#let data-table(
  theme: "summary",
  columns: (),       // array of column widths
  header: (),        // array of header cell content
  rows: (),          // array of arrays of cell content
  align: auto,
  size: 8pt,
  inset: (x: 5pt, y: 4.5pt),
) = {
  let pal = palettes.at(theme)
  block(above: 0.6em, below: 1.4em)[
    #set text(size: size)
    #set par(justify: false, leading: 0.5em)
    #table(
      columns: columns,
      align: if align == auto { left + top } else { align },
      inset: inset,
      stroke: none,
      fill: (_, y) => if y == 0 { pal.accent } else if calc.even(y) { pal.accent-soft.lighten(55%) } else { none },
      table.hline(stroke: 0.75pt + pal.accent),
      table.header(
        ..header.map(h => text(size: size - 0.6pt, weight: "bold", fill: white, tracking: 0.4pt, upper(h)))
      ),
      table.hline(stroke: 0.5pt + pal.rule),
      ..rows.flatten(),
      table.hline(stroke: 0.75pt + pal.accent),
    )
  ]
}
