#!/usr/bin/env bun
/**
 * attachment-to-pdf.ts — turn a PRE-EXISTING document body (text, RTF, HTML, or PDF)
 * into a PDF attachment body, without transiting markdown. Use this when re-homing
 * notes/reports from a record export (workflow Step 3); use md-to-pdf.ts only for
 * content you authored as markdown (the Patient Story).
 *
 * Usage:
 *   attachment-to-pdf.ts <input> [output.pdf] [--content-type t] [--title "..."]
 *                        [--patient "Name"] [--date "..."]
 *
 *   <input>           Source file. Type from --content-type, else extension
 *                     (.pdf/.rtf/.html/.htm/.txt), else content sniffing.
 *   PDF input         passes through byte-identical (already a valid PDF body).
 *   RTF / HTML / text rendered line-faithfully via the document engine — every
 *                     source line is its own line; nothing is reflowed into
 *                     markdown-style run-on paragraphs.
 *
 * Output (stdout, single JSON object):
 *   {"status":"rendered"|"copied","output":"...","pages":N,"sourceType":"rtf"}
 * stderr carries progress; exit 1 + usage on failure.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';
import { page, para, renderDoc, summaryTheme, title as titleBlock, provenanceLine } from '../../lib/doc.tsx';
import { htmlToText, rtfToText, sniffType, type SourceType } from './lib/extract-text.ts';

const USAGE =
  'Usage: attachment-to-pdf.ts <input> [output.pdf] [--content-type t] [--title T] [--patient P] [--date D]';

function fail(msg: string): never {
  console.error(`attachment-to-pdf: ${msg}\n${USAGE}`);
  process.exit(1);
}

const FLAGS: Record<string, string> = {
  '--content-type': 'contentType',
  '--title': 'title',
  '--patient': 'patient',
  '--date': 'date',
};

function typeFrom(contentType: string | undefined, file: string, bytes: Uint8Array): SourceType {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('rtf')) return 'rtf';
  if (ct.includes('html') || ct.includes('xhtml')) return 'html';
  if (ct.startsWith('text/')) return 'text';
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.rtf') return 'rtf';
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'html';
  if (ext === '.txt' || ext === '.text') return 'text';
  return sniffType(bytes);
}

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
    } else positional.push(a);
  }
  const input = positional[0];
  if (!input) fail('missing <input>');
  if (positional.length > 2) fail(`unexpected argument: ${positional[2]}`);
  if (!existsSync(input)) fail(`input not found: ${input}`);

  const bytes = new Uint8Array(await Bun.file(input).arrayBuffer());
  const sourceType = typeFrom(flags.contentType, input, bytes);
  const output = path.resolve(positional[1] ?? input.replace(/\.(pdf|rtf|html?|xhtml|txt|text)$/i, '') + '.pdf');

  if (sourceType === 'pdf') {
    if (path.resolve(input) !== output) await Bun.write(output, bytes as Uint8Array<ArrayBuffer>);
    const info = await $`pdfinfo ${output}`.text();
    const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
    if (!pages) fail(`${input} sniffed as PDF but pdfinfo can't read it`);
    console.log(JSON.stringify({ status: 'copied', output, pages, sourceType }));
    return;
  }

  const raw = new TextDecoder().decode(bytes);
  const text = sourceType === 'rtf' ? rtfToText(raw) : sourceType === 'html' ? htmlToText(raw) : raw;
  if (!text.trim()) fail(`no text content extracted from ${input} (${sourceType})`);

  const t = summaryTheme;
  const docTitle = flags.title ?? path.basename(input).replace(/\.[^.]+$/, '');
  const meta: { label: string; value: string }[] = [];
  if (flags.patient) meta.push({ label: 'Patient', value: flags.patient });
  if (flags.date) meta.push({ label: 'Date', value: flags.date });

  // Line-faithful: every non-blank source line is its own paragraph. Note bodies
  // carry meaning in their line structure; nothing gets reflowed.
  const children = [
    titleBlock(t, { title: docTitle, meta }),
    ...text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== '')
      .map((line, i) => para(t, line, { spaceAfter: 4 })),
  ];
  console.error(`attachment-to-pdf: rendering ${input} (${sourceType}, ${children.length - 1} lines)`);
  await renderDoc([page(t, children, { key: 'p1', footerLeft: provenanceLine(flags.date) })], { title: docTitle }, output);

  const info = await $`pdfinfo ${output}`.text();
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
  if (!pages) fail(`rendered ${output} but pdfinfo reported no pages`);
  console.log(JSON.stringify({ status: 'rendered', output, pages, sourceType }));
}

if (import.meta.main) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
