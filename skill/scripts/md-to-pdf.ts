#!/usr/bin/env bun
/**
 * md-to-pdf.ts — markdown adapter onto the lib/doc.tsx semantic builder (docs/DESIGN.md 17/18/19).
 *
 * The layout engine owns ALL layout; this file is parsing + component mapping only.
 *
 * Usage:
 *   md-to-pdf.ts <input.md> [output.pdf] [--theme story|summary] [--title "..."]
 *                [--patient "Name"] [--dob "..."] [--date "..."] [--kicker "..."]
 *
 * Options:
 *   <input.md>        Markdown source. Required.
 *   [output.pdf]      Output path; default = input with .pdf extension.
 *   --theme           story (serif, default) | summary (sans, dense).
 *   --title           Document title; overrides the first H1.
 *   --patient         Title-block meta: Patient name.
 *   --dob             Title-block meta: date of birth.
 *   --date            Title-block meta: share date; also appended to the provenance footer.
 *   --kicker          Small uppercase line above the title.
 *
 * Output (stdout, single JSON object): {"status":"rendered","output":"...","pages":N}
 * stderr carries progress; exit 1 + usage on failure.
 *
 * MARKDOWN DIALECT (degrade, never fail — unknown constructs become plain paragraphs):
 *   # H1            first one = document title (unless --title); later H1s act as sections
 *   ## H2           section heading
 *   ### H3          bold lead-in: merged as a bold opener into the next paragraph
 *                   ("**Heading.** body…"); standalone bold paragraph if nothing follows
 *   paragraph       inline: ==highlight==, **bold**, *italic*, [text](url), bare URLs;
 *                   [text](url) renders "text (url)" with the url as a url-styled span
 *                   (PDFs get printed — the address must stay visible)
 *   > quote         consecutive > lines join into one pullQuote (inline markers stripped)
 *   - item          bullet list (* and + accepted); indented follow-on lines continue an item
 *   | a | b |       pipe table; optional :--/--:/:-: alignment row; column widths
 *                   proportional to content length; headers repeat across pages
 *   ::: callout Title … :::   boxed callout panel (title optional, defaults to "Note")
 *   --- / ``` fences / other ::: blocks   markers dropped; fenced content kept as paragraphs
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { $ } from 'bun';
import {
  type Column,
  type Span,
  type Theme,
  bulletList,
  callout,
  page,
  para,
  provenanceLine,
  pullQuote,
  renderDoc,
  section,
  storyTheme,
  summaryTheme,
  table,
  title as titleBlock,
} from '../../lib/doc.tsx';

const USAGE =
  'Usage: md-to-pdf.ts <input.md> [output.pdf] [--theme story|summary] [--title T] ' +
  '[--patient NAME] [--dob DOB] [--date DATE] [--kicker K]';

// ---------------------------------------------------------------- inline ----

const TOKEN =
  /==(.+?)==|\*\*(.+?)\*\*|\*([^*]+?)\*|\[([^\]]+?)\]\(([^)\s]+?)\)|https?:\/\/[^\s<>"')\]]+/;

type InlineFlags = { highlight?: boolean; bold?: boolean; italic?: boolean };

function spanFrom(text: string, f: InlineFlags & { url?: boolean }): Span {
  const s: Span = { text };
  if (f.highlight) s.highlight = true;
  if (f.bold) s.bold = true;
  if (f.italic) s.italic = true;
  if (f.url) s.url = true;
  return s;
}

/** Markdown inline → Span[]. Nested markers recurse with inherited flags. */
export function parseInline(text: string, flags: InlineFlags = {}): Span[] {
  const spans: Span[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = TOKEN.exec(rest);
    if (!m) {
      spans.push(spanFrom(rest, flags));
      break;
    }
    if (m.index > 0) spans.push(spanFrom(rest.slice(0, m.index), flags));
    const [whole, hl, bold, italic, linkText, linkUrl] = m;
    if (hl !== undefined) spans.push(...parseInline(hl, { ...flags, highlight: true }));
    else if (bold !== undefined) spans.push(...parseInline(bold, { ...flags, bold: true }));
    else if (italic !== undefined) spans.push(...parseInline(italic, { ...flags, italic: true }));
    else if (linkText !== undefined && linkUrl !== undefined) {
      spans.push(...parseInline(linkText, flags));
      spans.push(spanFrom(' (', flags), spanFrom(linkUrl, { ...flags, url: true }), spanFrom(')', flags));
    } else {
      // Bare URL; sentence punctuation after it belongs to the prose, not the address.
      let url = whole;
      let trail = '';
      while (/[.,;:!?]$/.test(url)) {
        trail = url.slice(-1) + trail;
        url = url.slice(0, -1);
      }
      spans.push(spanFrom(url, { ...flags, url: true }));
      if (trail) spans.push(spanFrom(trail, flags));
    }
    rest = rest.slice(m.index + whole.length);
  }
  return spans.filter((s) => s.text.length > 0);
}

function plainText(text: string): string {
  return parseInline(text)
    .map((s) => s.text)
    .join('');
}

// ---------------------------------------------------------------- blocks ----

export type Block =
  | { kind: 'section'; text: string }
  | { kind: 'para'; spans: Span[] }
  | { kind: 'pullQuote'; text: string }
  | { kind: 'bulletList'; items: Span[][] }
  | { kind: 'table'; columns: Column[]; rows: Span[][][] }
  | { kind: 'callout'; title: string; body: Span[][] };

export interface CompiledDoc {
  /** First H1, or null when the source has none. */
  title: string | null;
  blocks: Block[];
}

const TABLE_ROW = /^\s*\|(.*)\|?\s*$/;
const ALIGN_CELL = /^\s*:?-{1,}:?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function buildTable(lines: string[]): Block {
  const rawRows = lines.map(splitRow);
  let aligns: Column['align'][] = [];
  const header = rawRows[0] ?? [];
  let bodyStart = 1;
  if (rawRows.length > 1 && rawRows[1]!.every((c) => ALIGN_CELL.test(c))) {
    aligns = rawRows[1]!.map((c) => {
      const t = c.trim();
      const l = t.startsWith(':');
      const r = t.endsWith(':');
      return l && r ? 'center' : r ? 'right' : 'left';
    });
    bodyStart = 2;
  }
  const nCols = Math.max(header.length, ...rawRows.map((r) => r.length));
  const body = rawRows.slice(bodyStart).map((r) => {
    const cells = [...r];
    while (cells.length < nCols) cells.push('');
    return cells.slice(0, nCols);
  });
  // Width = clamped longest plain-text content per column, so narrow columns
  // (dates, units) don't get the same share as prose columns.
  const columns: Column[] = Array.from({ length: nCols }, (_, i) => {
    const longest = Math.max(
      plainText(header[i] ?? '').length,
      ...body.map((r) => plainText(r[i] ?? '').length),
      1,
    );
    return {
      header: plainText(header[i] ?? ''),
      width: Math.min(Math.max(longest, 4), 32),
      ...(aligns[i] && aligns[i] !== 'left' ? { align: aligns[i] } : {}),
    };
  });
  return { kind: 'table', columns, rows: body.map((r) => r.map((c) => parseInline(c))) };
}

/** Markdown source → component-call structure (no rendering; unit-testable). */
export function compileMarkdown(md: string): CompiledDoc {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let title: string | null = null;
  let paraBuf: string[] = [];
  let leadIn: string | null = null;

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const spans = parseInline(paraBuf.join(' '));
    if (leadIn) {
      const sep = /[.:!?]$/.test(leadIn) ? ' ' : '. ';
      spans.unshift({ text: leadIn + sep, bold: true });
      leadIn = null;
    }
    blocks.push({ kind: 'para', spans });
    paraBuf = [];
  };
  const flushLeadIn = () => {
    if (!leadIn) return;
    blocks.push({ kind: 'para', spans: [{ text: leadIn, bold: true }] });
    leadIn = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushLeadIn();
      const text = plainText(h[2]!.trim());
      const level = h[1]!.length;
      if (level === 1 && title === null) title = text;
      else if (level <= 2) blocks.push({ kind: 'section', text });
      else leadIn = text;
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      flushLeadIn();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      const text = plainText(quote.join(' ').trim());
      if (text) blocks.push({ kind: 'pullQuote', text });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      flushPara();
      flushLeadIn();
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        if (/^[-*+]\s+/.test(l)) items.push(l.replace(/^[-*+]\s+/, ''));
        else if (/^\s+\S/.test(l) && items.length > 0) items[items.length - 1] += ' ' + l.trim();
        else break;
        i++;
      }
      blocks.push({ kind: 'bulletList', items: items.map((it) => parseInline(it)) });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flushPara();
      flushLeadIn();
      const tlines: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        tlines.push(lines[i]!);
        i++;
      }
      blocks.push(buildTable(tlines));
      continue;
    }

    const co = /^:::\s*callout\b\s*(.*)$/.exec(line);
    if (co) {
      flushPara();
      flushLeadIn();
      const body: Span[][] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i]!)) {
        const l = lines[i]!.trim();
        if (l) body.push(parseInline(l));
        i++;
      }
      if (i < lines.length) i++; // closing :::
      blocks.push({ kind: 'callout', title: co[1]!.trim() || 'Note', body });
      continue;
    }

    // Unknown fence/directive markers degrade: drop the marker line, keep the content
    // as ordinary paragraphs (never fail on weird markdown).
    if (/^:::/.test(line) || /^```/.test(line) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    paraBuf.push(line.trim());
    i++;
  }
  flushPara();
  flushLeadIn();
  return { title, blocks };
}

// ------------------------------------------------------------- rendering ----

function blockNode(t: Theme, b: Block, i: number) {
  switch (b.kind) {
    case 'section':
      return section(t, b.text, `s${i}`);
    case 'para':
      return para(t, b.spans);
    case 'pullQuote':
      return pullQuote(t, b.text);
    case 'bulletList':
      return bulletList(t, b.items);
    case 'table':
      return table(t, { columns: b.columns, rows: b.rows });
    case 'callout':
      return callout(t, { title: b.title, body: b.body });
  }
}

export interface RenderOpts {
  theme: Theme;
  title: string;
  kicker?: string;
  meta: { label: string; value: string }[];
  date?: string;
}

export async function renderMarkdownPdf(md: string, outPath: string, opts: RenderOpts) {
  const compiled = compileMarkdown(md);
  const children = [
    titleBlock(opts.theme, { title: opts.title, kicker: opts.kicker, meta: opts.meta }),
    ...compiled.blocks.map((b, i) => blockNode(opts.theme, b, i)),
  ];
  await renderDoc(
    [page(opts.theme, children, { key: 'p1', footerLeft: provenanceLine(opts.date) })],
    { title: opts.title },
    outPath,
  );
}

// ------------------------------------------------------------------- cli ----

function fail(msg: string): never {
  console.error(`md-to-pdf: ${msg}\n${USAGE}`);
  process.exit(1);
}

const FLAGS: Record<string, string> = {
  '--theme': 'theme',
  '--title': 'title',
  '--patient': 'patient',
  '--dob': 'dob',
  '--date': 'date',
  '--kicker': 'kicker',
};

async function main() {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const name = FLAGS[a];
      if (!name) fail(`unknown flag: ${a}`);
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${a}`);
      flags[name] = v;
    } else {
      positional.push(a);
    }
  }
  const input = positional[0];
  if (!input) fail('missing <input.md>');
  if (positional.length > 2) fail(`unexpected argument: ${positional[2]}`);
  if (!existsSync(input)) fail(`input not found: ${input}`);
  const themeName = flags.theme ?? 'story';
  if (themeName !== 'story' && themeName !== 'summary') fail(`--theme must be story|summary, got: ${themeName}`);
  const theme = themeName === 'story' ? storyTheme : summaryTheme;
  const output = path.resolve(positional[1] ?? input.replace(/\.(md|markdown)$/i, '') + '.pdf');

  const md = await Bun.file(input).text();
  const compiled = compileMarkdown(md);
  const docTitle = flags.title ?? compiled.title ?? path.basename(input).replace(/\.(md|markdown)$/i, '');
  const meta: { label: string; value: string }[] = [];
  if (flags.patient) meta.push({ label: 'Patient', value: flags.patient });
  if (flags.dob) meta.push({ label: 'DOB', value: flags.dob });
  if (flags.date) meta.push({ label: 'Date', value: flags.date });

  console.error(`md-to-pdf: rendering ${input} (${compiled.blocks.length} blocks, theme ${themeName})`);
  await renderMarkdownPdf(md, output, { theme, title: docTitle, kicker: flags.kicker, meta, date: flags.date });

  const info = await $`pdfinfo ${output}`.text();
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
  if (!pages) fail(`rendered ${output} but pdfinfo reported no pages`);
  console.log(JSON.stringify({ status: 'rendered', output, pages }));
}

if (import.meta.main) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
