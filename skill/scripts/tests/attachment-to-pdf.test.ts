// Extraction units run in the default tier; the render path is RUN_RENDER-gated.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { htmlToText, rtfToText, sniffType } from '../lib/extract-text.ts';

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)

const SAMPLE_RTF = String.raw`{\rtf1\ansi{\fonttbl{\f0 Times New Roman;}}{\colortbl;\red0\green0\blue0;}
\f0\fs24 Progress note (2023-09-28)\par
Chief Complaint: annual wellness visit\par
\bullet  nortriptyline (PAMELOR) 10 MG \tab TAKE 1 CAPSULE NIGHTLY\par
Caf\'e9 au lait spot noted. Temperature 37\u176?C.\par\par
Plan: follow up in 12 months.}`;

describe('rtfToText', () => {
  test('paragraphs, bullets, tabs, hex and unicode escapes; tables skipped', () => {
    const text = rtfToText(SAMPLE_RTF);
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toBe('Progress note (2023-09-28)');
    expect(lines[1]).toBe('Chief Complaint: annual wellness visit');
    expect(text).toContain('• ');
    expect(text).toContain('nortriptyline (PAMELOR) 10 MG');
    expect(text).toContain('Café au lait');
    expect(text).toContain('37°C');
    expect(text).toContain('Plan: follow up');
    expect(text).not.toContain('Times New Roman');
    expect(text).not.toContain('\\par');
  });
});

describe('htmlToText', () => {
  test('block structure, list bullets, entities, script/style dropped', () => {
    const text = htmlToText(
      '<html><head><style>p{color:red}</style></head><body>' +
        '<h2>Allergies</h2><ul><li>Peanut &amp; tree nut</li><li>Sulfa &mdash; hives</li></ul>' +
        '<p>Temp 37&#176;C</p><script>alert(1)</script></body></html>',
    );
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toBe('Allergies');
    expect(lines[1]).toBe('• Peanut & tree nut');
    expect(lines[2]).toBe('• Sulfa — hives');
    expect(text).toContain('Temp 37°C');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });
});

describe('sniffType', () => {
  test('magic bytes', () => {
    expect(sniffType(new TextEncoder().encode('%PDF-1.7 …'))).toBe('pdf');
    expect(sniffType(new TextEncoder().encode('{\\rtf1\\ansi hello}'))).toBe('rtf');
    expect(sniffType(new TextEncoder().encode('<!DOCTYPE html><html>'))).toBe('html');
    expect(sniffType(new TextEncoder().encode('Plain old note text'))).toBe('text');
  });
});

describe.skipIf(!RENDER)('attachment-to-pdf end-to-end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ktc-att-'));
  const script = join(import.meta.dir, '..', 'attachment-to-pdf.ts');

  test('rtf renders line-faithfully', async () => {
    const src = join(dir, 'note.rtf');
    writeFileSync(src, SAMPLE_RTF);
    const proc = await $`bun ${script} ${src} --title "Progress note" --date 2023-09-28`.quiet();
    const out = JSON.parse(proc.stdout.toString());
    expect(out.status).toBe('rendered');
    expect(out.sourceType).toBe('rtf');
    const text = await $`pdftotext ${out.output} -`.text();
    // line structure survives: complaint and plan are separate lines, not run-on
    expect(text).toContain('Chief Complaint: annual wellness visit\n');
    expect(text).toContain('Café au lait');
  });

  test('pdf passes through byte-identical', async () => {
    const src = join(dir, 'already.pdf');
    const real = join(dir, 'seed.txt');
    writeFileSync(real, 'seed document');
    const made = JSON.parse((await $`bun ${script} ${real} ${join(dir, 'seed.pdf')}`.quiet()).stdout.toString());
    const bytes = await Bun.file(made.output).arrayBuffer();
    writeFileSync(src, new Uint8Array(bytes));
    const out = JSON.parse((await $`bun ${script} ${src} ${join(dir, 'copied.pdf')}`.quiet()).stdout.toString());
    expect(out.status).toBe('copied');
    expect(new Uint8Array(await Bun.file(out.output).arrayBuffer())).toEqual(new Uint8Array(bytes));
    rmSync(dir, { recursive: true, force: true });
  });
});
