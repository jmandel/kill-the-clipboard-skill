// doc.ts — semantic document builder that emits Typst source targeting theme.typ,
// then compiles it to PDF with @myriaddreamin/typst-ts-node-compiler.

import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { dirname } from "node:path";

export type Theme = "story" | "summary";

/** Inline span: plain text or patient-emphasized highlight. */
export type Span = { text: string; highlight?: boolean };

/** A table cell: plain text, a badge chip, a lab flag, or raw typst code. */
export type Cell =
  | string
  | { badge: string; label?: string }
  | { labFlag: string }
  | { raw: string };

/**
 * Educate straight quotes into curly ones. Strings injected as Typst string
 * literals bypass Typst's markup-level smartquote handling, so we do it here.
 */
function smarten(s: string): string {
  return s
    .replace(/(^|[\s([{—–])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/(^|[\s([{—–])'/g, "$1‘")
    .replace(/'/g, "’");
}

/** Escape a JS string into a Typst string literal (with educated quotes). */
function tstr(s: string): string {
  return JSON.stringify(smarten(s));
}

/**
 * Make very long unbreakable tokens (URLs) breakable by inserting zero-width
 * spaces after natural break characters. Visual text is unchanged.
 */
export function breakable(s: string): string {
  return s.replace(/([/\-.?=&_])/g, "$1​");
}

function spanCode(spans: Span[] | string): string {
  if (typeof spans === "string") return tstr(spans);
  const parts = spans.map((s) =>
    s.highlight ? `hl(theme: theme, ${tstr(s.text)})` : tstr(s.text),
  );
  return `(${parts.join(", ")},).join()`;
}

function cellCode(c: Cell): string {
  if (typeof c === "string") return tstr(c);
  if ("badge" in c) return `badge(${tstr(c.badge)}, ${tstr(c.label ?? c.badge)})`;
  if ("labFlag" in c) return `lab-flag(${tstr(c.labFlag)})`;
  return c.raw;
}

export interface TableOpts {
  /** Column header labels. */
  header: string[];
  /** Typst track sizes per column, e.g. "1.6fr", "auto", "0.8in". */
  widths: string[];
  rows: Cell[][];
  /** Body font size in pt (default 8). */
  size?: number;
  /** Optional per-column alignment, e.g. ["left", "center"]. */
  align?: string[];
}

export class Doc {
  private chunks: string[] = [];
  constructor(
    private theme: Theme,
    private provenance: string,
  ) {
    this.chunks.push(`#import "theme.typ": *`);
    this.chunks.push(`#let theme = ${tstr(theme)}`);
    this.chunks.push(
      `#show: conf.with(theme: ${tstr(theme)}, provenance: ${tstr(provenance)})`,
    );
  }

  /** Title block: document title + identity metadata grouped at top of page 1. */
  title(title: string, opts: { subtitle?: string; meta?: [string, string][] } = {}) {
    const meta = (opts.meta ?? [])
      .map(([k, v]) => `(${tstr(k)}, ${tstr(v)})`)
      .join(", ");
    this.chunks.push(
      `#title-block(theme: theme, title: ${tstr(title)}, subtitle: ${
        opts.subtitle ? tstr(opts.subtitle) : "none"
      }, meta: (${meta}${meta ? "," : ""}))`,
    );
  }

  /** H2 section heading with accent rule. */
  section(text: string) {
    this.chunks.push(`#heading(level: 2, ${tstr(text)})`);
  }

  /** Body paragraph; supports highlight spans. */
  para(spans: Span[] | string) {
    this.chunks.push(`#par(${spanCode(spans)})`);
  }

  /** Visually distinct pull-quote. */
  pullQuote(spans: Span[] | string) {
    this.chunks.push(`#pull-quote(theme: theme, ${spanCode(spans)})`);
  }

  /** Bulleted list; items support highlight spans. */
  list(items: (Span[] | string)[]) {
    const body = items.map((it) => `list.item(${spanCode(it)})`).join(", ");
    this.chunks.push(`#list(spacing: 0.85em, ${body},)`);
  }

  /** Boxed informational callout panel. */
  callout(title: string | null, spans: Span[] | string) {
    this.chunks.push(
      `#callout(theme: theme, title: ${title ? tstr(title) : "none"}, ${spanCode(spans)})`,
    );
  }

  /** 2-column key/value demographics grid. */
  kvPanel(pairs: [string, string][]) {
    const body = pairs.map(([k, v]) => `(${tstr(k)}, ${tstr(v)})`).join(", ");
    this.chunks.push(`#kv-panel(theme: theme, (${body},))`);
  }

  /** Standalone badge chip. */
  badge(kind: string, label?: string) {
    this.chunks.push(`#badge(${tstr(kind)}, ${tstr(label ?? kind)})`);
  }

  /** Data table with repeating header rows across page breaks. */
  table(opts: TableOpts) {
    const widths = opts.widths.join(", ");
    const header = opts.header.map((h) => tstr(h)).join(", ");
    const rows = opts.rows
      .map((r) => `(${r.map(cellCode).join(", ")},)`)
      .join(",\n    ");
    const align = opts.align
      ? `(${opts.align.map((a) => `${a} + top`).join(", ")},)`
      : "auto";
    this.chunks.push(
      `#data-table(\n  theme: theme,\n  size: ${opts.size ?? 8}pt,\n  columns: (${widths},),\n  align: ${align},\n  header: (${header},),\n  rows: (\n    ${rows},\n  ),\n)`,
    );
  }

  /** Raw Typst escape hatch. */
  raw(code: string) {
    this.chunks.push(code);
  }

  /** The generated Typst source. */
  source(): string {
    return this.chunks.join("\n\n") + "\n";
  }

  /** Compile to PDF. workspace = directory containing theme.typ and fonts/. */
  async pdf(outPath: string, workspace = import.meta.dir) {
    const typPath = outPath.replace(/\.pdf$/, ".typ");
    await Bun.write(typPath, this.source());
    const compiler = NodeCompiler.create({
      workspace,
      fontArgs: [{ fontPaths: [`${workspace}/fonts`] }],
    });
    const doc = compiler.compile({ mainFilePath: typPath });
    if (doc.result == null) {
      console.error(doc.takeDiagnostics()?.shortDiagnostics);
      throw new Error(`Typst compilation failed for ${typPath}`);
    }
    const diags = doc.takeDiagnostics();
    if (diags && diags.shortDiagnostics.length > 0) {
      for (const d of diags.shortDiagnostics) console.warn("typst:", d.message);
    }
    const pdf = compiler.pdf(doc.result);
    await Bun.write(outPath, pdf);
    return outPath;
  }
}
