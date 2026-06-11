// doc.ts — semantic document builder on top of pdfmake's declarative model.
// Exposes title/section/para/pullQuote/callout/kvPanel/table/badge/list and
// render(); entry scripts never touch pdfmake node objects directly.

import { readFileSync } from "fs";
import { join } from "path";
// pdfmake 0.3 node interface: a singleton with setFonts/createPdf.
// @ts-ignore - no bundled types for the node entry
import pdfmake from "pdfmake";

const FONT_DIR = join(import.meta.dir, "fonts");
// pdfmake 0.3's URLResolver chokes on Buffer font definitions under Node/Bun,
// so we load TTFs into its virtual filesystem and reference them by name.
const ttf = (f: string) => {
  pdfmake.virtualfs.writeFileSync(f, readFileSync(join(FONT_DIR, f)));
  return f;
};

pdfmake.setFonts({
  SourceSerif: {
    normal: ttf("source-serif-4-v14-greek_latin_latin-ext-regular.ttf"),
    bold: ttf("source-serif-4-v14-greek_latin_latin-ext-700.ttf"),
    italics: ttf("source-serif-4-v14-greek_latin_latin-ext-italic.ttf"),
    bolditalics: ttf("source-serif-4-v14-greek_latin_latin-ext-700italic.ttf"),
  },
  SourceSerifSemi: {
    normal: ttf("source-serif-4-v14-greek_latin_latin-ext-600.ttf"),
    bold: ttf("source-serif-4-v14-greek_latin_latin-ext-700.ttf"),
    italics: ttf("source-serif-4-v14-greek_latin_latin-ext-italic.ttf"),
    bolditalics: ttf("source-serif-4-v14-greek_latin_latin-ext-700italic.ttf"),
  },
  SourceSans: {
    normal: ttf("source-sans-3-v19-greek_latin_latin-ext-regular.ttf"),
    bold: ttf("source-sans-3-v19-greek_latin_latin-ext-700.ttf"),
    italics: ttf("source-sans-3-v19-greek_latin_latin-ext-italic.ttf"),
    bolditalics: ttf("source-sans-3-v19-greek_latin_latin-ext-700italic.ttf"),
  },
  SourceSansSemi: {
    normal: ttf("source-sans-3-v19-greek_latin_latin-ext-600.ttf"),
    bold: ttf("source-sans-3-v19-greek_latin_latin-ext-700.ttf"),
    italics: ttf("source-sans-3-v19-greek_latin_latin-ext-italic.ttf"),
    bolditalics: ttf("source-sans-3-v19-greek_latin_latin-ext-700italic.ttf"),
  },
});
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => false);

export type ThemeName = "story" | "summary";

interface Theme {
  font: string; // body font family key
  semiFont: string; // semibold family key (for headings)
  margins: [number, number, number, number]; // L T R B (pt)
  bodySize: number;
  leading: number; // lineHeight multiplier
  ink: string;
  muted: string;
  accent: string;
  accentSoft: string; // light tint for panels
  rule: string; // light hairline color
  highlight: string; // ==text== background
  panelFill: string;
  headerFill: string; // table header background
  headerText: string;
  zebra: string;
}

const THEMES: Record<ThemeName, Theme> = {
  story: {
    font: "SourceSerif",
    semiFont: "SourceSerifSemi",
    margins: [72, 72, 72, 86],
    bodySize: 10.5,
    leading: 1.42,
    ink: "#2e2a25",
    muted: "#7a7166",
    accent: "#a8552f",
    accentSoft: "#faf2ea",
    rule: "#e4dcd1",
    highlight: "#fbecc9",
    panelFill: "#faf5ee",
    headerFill: "#a8552f",
    headerText: "#ffffff",
    zebra: "#faf6f0",
  },
  summary: {
    font: "SourceSans",
    semiFont: "SourceSansSemi",
    margins: [54, 54, 54, 78],
    bodySize: 8.5,
    leading: 1.3,
    ink: "#1d2733",
    muted: "#5d6b7a",
    accent: "#0e7490",
    accentSoft: "#e8f4f7",
    rule: "#dbe3ea",
    highlight: "#fdeec9",
    panelFill: "#f4f8fa",
    headerFill: "#0e7490",
    headerText: "#ffffff",
    zebra: "#f5f8fa",
  },
};

const PAGE_W = 612; // US Letter portrait, pt

export const BADGE_PALETTE: Record<string, { bg: string; fg: string }> = {
  active: { bg: "#dcefe2", fg: "#1c6b3c" },
  stopped: { bg: "#fbdfdd", fg: "#a52a21" },
  completed: { bg: "#e2e8f2", fg: "#3c5577" },
  high: { bg: "#fbdfdd", fg: "#a52a21" },
  low: { bg: "#dcefe2", fg: "#1c6b3c" },
  "unable-to-assess": { bg: "#fbeed0", fg: "#8a6411" },
  HIGH: { bg: "#fbdfdd", fg: "#a52a21" },
  LOW: { bg: "#fde8cf", fg: "#9a5b10" },
  NORMAL: { bg: "#eceff3", fg: "#5d6b7a" },
  inactive: { bg: "#eceff3", fg: "#5d6b7a" },
  resolved: { bg: "#e2e8f2", fg: "#3c5577" },
};

export interface Span {
  text: string;
  highlight?: boolean;
  italic?: boolean;
  bold?: boolean;
  link?: string; // render as wrapping link styled small
}

export interface TableSpec {
  headers: string[];
  rows: any[][]; // cells: string | builder.badge(...) | {text,...}
  widths?: (string | number)[];
  fontSize?: number;
  landscape?: boolean; // start on a fresh landscape page
  zebra?: boolean;
}

export class DocBuilder {
  private t: Theme;
  private content: any[] = [];
  private provenance = "";

  constructor(theme: ThemeName) {
    this.t = THEMES[theme];
  }

  private contentWidth(landscape = false): number {
    const pageW = landscape ? 792 : PAGE_W;
    return pageW - this.t.margins[0] - this.t.margins[2];
  }

  /** Title block: doc title + identity metadata, visually grouped. */
  title(opts: { eyebrow?: string; title: string; meta: string[] }) {
    const t = this.t;
    this.content.push({
      stack: [
        ...(opts.eyebrow
          ? [{
              text: opts.eyebrow.toUpperCase(),
              font: t.semiFont,
              fontSize: 8,
              characterSpacing: 1.6,
              color: t.accent,
              margin: [0, 0, 0, 6],
            }]
          : []),
        {
          text: opts.title,
          font: t.semiFont,
          fontSize: 21,
          color: t.ink,
          lineHeight: 1.12,
          margin: [0, 0, 0, 7] as any,
        },
        {
          text: opts.meta.join("   ·   "),
          fontSize: t.bodySize - 0.5,
          italics: true,
          color: t.muted,
          margin: [0, 0, 0, 10] as any,
        },
        {
          canvas: [
            { type: "line", x1: 0, y1: 0, x2: this.contentWidth(), y2: 0, lineWidth: 2.2, lineColor: t.accent },
          ],
        },
      ],
      margin: [0, 0, 0, 18],
    });
    return this;
  }

  /** H2 with accent rule (short accent segment + hairline continuation). */
  section(text: string, opts: { landscape?: boolean } = {}) {
    const t = this.t;
    const w = this.contentWidth(opts.landscape);
    this.content.push({
      stack: [
        { text, font: t.semiFont, fontSize: 13, color: t.ink, margin: [0, 0, 0, 4], style: "secChild" },
        {
          canvas: [
            { type: "line", x1: 0, y1: 0, x2: 34, y2: 0, lineWidth: 2.4, lineColor: t.accent },
            { type: "line", x1: 34, y1: 0.7, x2: w, y2: 0.7, lineWidth: 0.7, lineColor: t.rule },
          ],
          style: "secChild",
        },
      ],
      headlineLevel: 1, // used by pageBreakBefore to avoid orphan headings
      margin: [0, 14, 0, 9],
      ...(opts.landscape ? { pageBreak: "before", pageOrientation: "landscape" } : {}),
    });
    return this;
  }

  /** Paragraph with highlight-span / italic / link support. */
  para(spans: string | Span[], opts: { size?: number; color?: string; spaceAfter?: number } = {}) {
    const t = this.t;
    const arr = typeof spans === "string" ? [{ text: spans }] : spans;
    this.content.push({
      text: arr.map((s) => ({
        text: s.text,
        ...(s.highlight ? { background: t.highlight } : {}),
        ...(s.italic ? { italics: true } : {}),
        ...(s.bold ? { font: t.semiFont } : {}),
        ...(s.link
          ? { link: s.link, color: t.accent, fontSize: (opts.size ?? t.bodySize) - 1.3, decoration: "underline", decorationColor: t.rule }
          : {}),
      })),
      fontSize: opts.size ?? t.bodySize,
      color: opts.color ?? t.ink,
      lineHeight: t.leading,
      alignment: "left",
      margin: [0, 0, 0, opts.spaceAfter ?? 8],
    });
    return this;
  }

  /** Visually distinct pull-quote: accent left bar, tinted field, large italic. */
  pullQuote(text: string) {
    const t = this.t;
    this.content.push({
      table: {
        widths: ["*"],
        body: [[{
          text,
          italics: true,
          fontSize: t.bodySize + 2,
          lineHeight: 1.4,
          color: "#5a4a3a",
          margin: [14, 10, 12, 10],
        }]],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (i: number) => (i === 0 ? 3 : 0),
        vLineColor: () => t.accent,
        fillColor: () => t.accentSoft,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [18, 6, 18, 14],
      unbreakable: true,
    });
    return this;
  }

  /** Boxed informational panel with a small-caps title. */
  callout(title: string, paragraphs: string[]) {
    const t = this.t;
    this.content.push({
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            {
              text: title.toUpperCase(),
              font: t.semiFont,
              fontSize: t.bodySize - 1.5,
              characterSpacing: 1.1,
              color: t.accent,
              margin: [0, 0, 0, 5],
            },
            ...paragraphs.map((p, i) => ({
              text: p,
              fontSize: t.bodySize - 0.5,
              lineHeight: 1.35,
              color: t.ink,
              margin: [0, 0, 0, i === paragraphs.length - 1 ? 0 : 4],
            })),
          ],
          margin: [12, 10, 12, 10],
        }]],
      },
      layout: {
        hLineWidth: () => 0.8,
        vLineWidth: () => 0.8,
        hLineColor: () => "#bcd6de",
        vLineColor: () => "#bcd6de",
        fillColor: () => t.accentSoft,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 2, 0, 14],
      unbreakable: true,
    });
    return this;
  }

  /** 2-column key/value grid inside a soft panel. */
  kvPanel(pairs: [string, string][]) {
    const t = this.t;
    const rows: any[][] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const cell = (p?: [string, string]) =>
        p
          ? [
              { text: p[0].toUpperCase(), font: t.semiFont, fontSize: t.bodySize - 2, characterSpacing: 0.8, color: t.muted },
              { text: p[1], fontSize: t.bodySize + 0.5, color: t.ink, font: t.semiFont },
            ]
          : [{ text: "" }, { text: "" }];
      rows.push([...cell(pairs[i]), ...cell(pairs[i + 1])]);
    }
    this.content.push({
      table: {
        widths: [78, "*", 78, "*"],
        body: rows.map((r) => r.map((c) => ({ ...c, margin: [10, 5, 6, 5] }))),
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0 : 0.7),
        vLineWidth: () => 0,
        hLineColor: () => "#e0e8ee",
        fillColor: () => t.panelFill,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 0, 0, 12],
      unbreakable: true,
    });
    return this;
  }

  /** Colored chip; returns an inline node usable as a table cell.
   *  Implemented with pdfmake's text `background` (decoration layer) because
   *  nested-table fills get painted UNDER the parent row's zebra fill when
   *  dontBreakRows is on (fill-ordering quirk found empirically). */
  badge(text: string, kind?: string) {
    const pal = BADGE_PALETTE[kind ?? text] ?? { bg: "#eceff3", fg: "#444c55" };
    const t = this.t;
    const pad = "  ";
    return {
      text: `${pad}${text.toUpperCase()}${pad}`,
      font: t.semiFont,
      fontSize: t.bodySize - 2,
      characterSpacing: 0.5,
      color: pal.fg,
      background: pal.bg,
      lineHeight: 1.15,
      margin: [5, 3.5, 5, 3],
    };
  }

  /** Data table with repeating header row; header never widowed. */
  table(spec: TableSpec) {
    const t = this.t;
    const size = spec.fontSize ?? t.bodySize - 0.5;
    const headerCells = spec.headers.map((h) => ({
      text: h.toUpperCase(),
      font: t.semiFont,
      fontSize: size - 1,
      characterSpacing: 0.4,
      color: t.headerText,
      margin: [5, 3.5, 5, 3.5],
    }));
    const bodyRows = spec.rows.map((r) =>
      r.map((cell) => {
        if (cell && typeof cell === "object") return { ...cell, margin: cell.margin ?? [5, 3, 5, 3] };
        return { text: String(cell ?? ""), fontSize: size, color: t.ink, lineHeight: 1.22, margin: [5, 3, 5, 3] };
      })
    );
    this.content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        keepWithHeaderRows: 1,
        widths: spec.widths ?? spec.headers.map(() => "*"),
        body: [headerCells, ...bodyRows],
      },
      layout: {
        hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? 0.9 : 0.55),
        vLineWidth: () => 0,
        hLineColor: (i: number, node: any) =>
          i === 0 || i === 1 || i === node.table.body.length ? t.headerFill : t.rule,
        fillColor: (rowIndex: number) =>
          rowIndex === 0 ? t.headerFill : spec.zebra !== false && rowIndex % 2 === 0 ? t.zebra : null,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 0, 0, 16],
    });
    return this;
  }

  /** Bulleted list with accent markers. */
  list(items: (string | Span[])[]) {
    const t = this.t;
    this.content.push({
      ul: items.map((it) => ({
        text: (typeof it === "string" ? [{ text: it }] : it).map((s) => ({
          text: s.text,
          ...(s.highlight ? { background: t.highlight } : {}),
          ...(s.italic ? { italics: true } : {}),
        })),
        fontSize: t.bodySize,
        lineHeight: t.leading,
        color: t.ink,
        margin: [0, 0, 0, 4],
      })),
      markerColor: t.accent,
      margin: [10, 0, 0, 10],
    });
    return this;
  }

  /** Footer (page x of y + verbatim provenance) applied to every page. */
  pageFooter(provenance: string) {
    this.provenance = provenance;
    return this;
  }

  private buildDocDefinition() {
    const t = this.t;
    return {
      pageSize: "LETTER",
      pageOrientation: "portrait",
      pageMargins: t.margins,
      defaultStyle: { font: t.font, fontSize: t.bodySize, color: t.ink },
      info: { title: "Bake-off candidate (pdfmake)" },
      content: this.content,
      footer: (currentPage: number, pageCount: number, pageSize: any) => ({
        margin: [t.margins[0], 24, t.margins[2], 0],
        stack: [
          {
            canvas: [{
              type: "line",
              x1: 0,
              y1: 0,
              x2: pageSize.width - t.margins[0] - t.margins[2],
              y2: 0,
              lineWidth: 0.6,
              lineColor: t.rule,
            }],
            margin: [0, 0, 0, 5],
          },
          {
            columns: [
              { text: this.provenance, fontSize: 7.5, color: t.muted, width: "*" },
              {
                text: `Page ${currentPage} of ${pageCount}`,
                fontSize: 7.5,
                color: t.muted,
                alignment: "right",
                width: "auto",
              },
            ],
          },
        ],
      }),
      styles: { secChild: {} },
      // pdfmake 0.3 passes an accessor object (not arrays) as the 2nd argument.
      // A section heading's own flattened children (text + canvas) land on the
      // same page, so exclude them when testing for an orphaned heading.
      // Keep section headings attached to their content. pdfmake has no
      // keep-with-next, and a following table can register a phantom start
      // position on the heading's page, so "no following nodes on page" is
      // unreliable; instead require enough room below the heading for at
      // least a table header plus a couple of rows (~90pt).
      pageBreakBefore: (currentNode: any, opts: any) => {
        if (currentNode.headlineLevel !== 1 || currentNode.pageBreak === "before") return false;
        const pos = currentNode.startPosition;
        const remaining = pos.pageInnerHeight * (1 - pos.verticalRatio);
        if (remaining < 90) return true;
        const following = opts
          .getFollowingNodesOnPage()
          .filter((n: any) => n.style !== "secChild");
        return following.length === 0;
      },
    };
  }

  async render(path: string) {
    const doc = pdfmake.createPdf(this.buildDocDefinition());
    await doc.write(path);
  }
}
