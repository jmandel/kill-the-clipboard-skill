// Tests for md-to-pdf.ts + preview-pdf.ts (DESIGN.md decisions 17/18/19).
//
// Dialect tests assert parser → component-call structure without rendering; render tests
// follow the lib/doc.test.ts geometry approach (pdfinfo/pdftotext assertions, never pixels);
// the multi-page table test re-proves the repeating-header behavior through the markdown path.

import { afterAll, describe, expect, test } from 'bun:test';

const RENDER = process.env.RUN_RENDER === '1'; // rendering tests are opt-in (see CLAUDE.md Testing)
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { type Block, compileMarkdown, parseInline } from '../md-to-pdf.ts';

const SCRIPTS = join(import.meta.dir, '..');
const MD_TO_PDF = join(SCRIPTS, 'md-to-pdf.ts');
const PREVIEW = join(SCRIPTS, 'preview-pdf.ts');
const STORY_MD = join(SCRIPTS, '../../../bakeoff/content/story.md');

const dir = mkdtempSync(join(tmpdir(), 'ktc-md-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(script: string, args: string[]) {
  const r = Bun.spawnSync({ cmd: ['bun', script, ...args], stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

async function pageCount(pdf: string): Promise<number> {
  const info = await $`pdfinfo ${pdf}`.text();
  return Number(info.match(/Pages:\s+(\d+)/)?.[1]);
}

async function pageText(pdf: string, n: number): Promise<string> {
  return await $`pdftotext -f ${n} -l ${n} ${pdf} -`.text();
}

// ----------------------------------------------------------- inline dialect ----

describe('parseInline', () => {
  test('plain text is a single span', () => {
    expect(parseInline('just words')).toEqual([{ text: 'just words' }]);
  });

  test('==highlight==, **bold**, *italic*', () => {
    expect(parseInline('a ==hot== b **strong** c *lean* d')).toEqual([
      { text: 'a ' },
      { text: 'hot', highlight: true },
      { text: ' b ' },
      { text: 'strong', bold: true },
      { text: ' c ' },
      { text: 'lean', italic: true },
      { text: ' d' },
    ]);
  });

  test('nested markers inherit outer flags', () => {
    expect(parseInline('==keep **both**==')).toEqual([
      { text: 'keep ', highlight: true },
      { text: 'both', highlight: true, bold: true },
    ]);
  });

  test('[text](url) renders text plus visible url span', () => {
    expect(parseInline('see [the guide](https://x.org/g) now')).toEqual([
      { text: 'see ' },
      { text: 'the guide' },
      { text: ' (' },
      { text: 'https://x.org/g', url: true },
      { text: ')' },
      { text: ' now' },
    ]);
  });

  test('bare URL becomes a url span; trailing sentence punctuation stays prose', () => {
    expect(parseInline('go to https://example.org/path.')).toEqual([
      { text: 'go to ' },
      { text: 'https://example.org/path', url: true },
      { text: '.' },
    ]);
  });

  test('unterminated markers degrade to plain text, never throw', () => {
    expect(parseInline('a **b and ==c')).toEqual([{ text: 'a **b and ==c' }]);
    expect(parseInline('*')).toEqual([{ text: '*' }]);
  });
});

// ------------------------------------------------------------ block dialect ----

describe('compileMarkdown', () => {
  test('first H1 is the title; later H1/H2 are sections', () => {
    const c = compileMarkdown('# Top\n\n## Sec A\n\nbody\n\n# Another H1\n');
    expect(c.title).toBe('Top');
    expect(c.blocks.map((b) => b.kind)).toEqual(['section', 'para', 'section']);
    expect((c.blocks[0] as any).text).toBe('Sec A');
    expect((c.blocks[2] as any).text).toBe('Another H1');
  });

  test('H3 merges as a bold lead-in into the next paragraph', () => {
    const c = compileMarkdown('### Why this matters\nBecause reasons.\n');
    expect(c.blocks).toEqual([
      {
        kind: 'para',
        spans: [{ text: 'Why this matters. ', bold: true }, { text: 'Because reasons.' }],
      },
    ]);
  });

  test('H3 with no following paragraph renders as a standalone bold para', () => {
    const c = compileMarkdown('### Lonely heading\n\n## Next section\n');
    expect(c.blocks[0]).toEqual({ kind: 'para', spans: [{ text: 'Lonely heading', bold: true }] });
    expect(c.blocks[1]!.kind).toBe('section');
  });

  test('consecutive > lines join into one pullQuote with inline markers stripped', () => {
    const c = compileMarkdown('> I am **not** asking\n> for much.\n');
    expect(c.blocks).toEqual([{ kind: 'pullQuote', text: 'I am not asking for much.' }]);
  });

  test('bullet list with continuation lines and inline spans', () => {
    const c = compileMarkdown('- first ==hot== item\n- second item\n  continues here\n');
    const b = c.blocks[0] as Extract<Block, { kind: 'bulletList' }>;
    expect(b.kind).toBe('bulletList');
    expect(b.items).toHaveLength(2);
    expect(b.items[0]).toEqual([{ text: 'first ' }, { text: 'hot', highlight: true }, { text: ' item' }]);
    expect(b.items[1]).toEqual([{ text: 'second item continues here' }]);
  });

  test('pipe table with alignment row: aligns + content-weighted widths', () => {
    const c = compileMarkdown('| Name | Qty | Price |\n| --- | :-: | ---: |\n| Something rather long | 2 | 4.50 |\n');
    const t = c.blocks[0] as Extract<Block, { kind: 'table' }>;
    expect(t.kind).toBe('table');
    expect(t.columns.map((col) => col.header)).toEqual(['Name', 'Qty', 'Price']);
    expect(t.columns[1]!.align).toBe('center');
    expect(t.columns[2]!.align).toBe('right');
    expect(t.columns[0]!.align).toBeUndefined();
    expect(t.columns[0]!.width).toBeGreaterThan(t.columns[1]!.width);
    expect(t.rows).toEqual([[[{ text: 'Something rather long' }], [{ text: '2' }], [{ text: '4.50' }]]]);
  });

  test('pipe table without alignment row still parses; ragged rows pad', () => {
    const c = compileMarkdown('| A | B |\n| 1 |\n| 2 | 3 |\n');
    const t = c.blocks[0] as Extract<Block, { kind: 'table' }>;
    expect(t.columns).toHaveLength(2);
    expect(t.rows).toEqual([
      [[{ text: '1' }], []],
      [[{ text: '2' }], [{ text: '3' }]],
    ]);
  });

  test('::: callout with title, default title, and body spans', () => {
    const c = compileMarkdown('::: callout Heads up\nLine ==one==\nLine two\n:::\n\n::: callout\nbody\n:::\n');
    expect(c.blocks[0]).toEqual({
      kind: 'callout',
      title: 'Heads up',
      body: [[{ text: 'Line ' }, { text: 'one', highlight: true }], [{ text: 'Line two' }]],
    });
    expect((c.blocks[1] as any).title).toBe('Note');
  });

  test('unknown constructs degrade to paragraphs, never fail', () => {
    const c = compileMarkdown('::: spoiler\nhidden text\n:::\n\n```\ncode line\n```\n\n---\n\nplain after\n');
    expect(c.blocks.every((b) => b.kind === 'para')).toBe(true);
    const texts = c.blocks.map((b) => (b as any).spans.map((s: any) => s.text).join(''));
    expect(texts).toEqual(['hidden text', 'code line', 'plain after']);
  });

  test('no H1 → null title', () => {
    expect(compileMarkdown('only a paragraph\n').title).toBeNull();
  });
});

// ----------------------------------------------------------------- render ----

describe.skipIf(!RENDER)('md-to-pdf render', () => {
  const storyPdf = join(dir, 'story.pdf');

  test('bakeoff story renders: title, highlights, URL, footer on every page', async () => {
    const r = run(MD_TO_PDF, [
      STORY_MD,
      storyPdf,
      '--theme',
      'story',
      '--patient',
      'Jessica Argonaut',
      '--dob',
      'March 14, 1985',
      '--date',
      'June 12, 2026',
      '--kicker',
      'Patient Story',
    ]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('rendered');
    expect(out.output).toBe(storyPdf);
    expect(out.pages).toBeGreaterThanOrEqual(1);

    const pages = await pageCount(storyPdf);
    expect(pages).toBe(out.pages);

    const perPage = await Promise.all(Array.from({ length: pages }, (_, i) => pageText(storyPdf, i + 1)));
    const all = perPage.join('\n').replace(/\s+/g, ' ');
    expect(all).toContain('My Story, Before We Talk: Jessica Argonaut');
    // ==highlight== phrases survive into the rendered text
    expect(all).toContain('my heart was pounding so hard I could feel it in my teeth');
    expect(all).toContain('the episodes kept coming on schedule anyway');
    // bare URL is char-wrapped by the engine; compare with whitespace stripped
    expect(all.replace(/ /g, '')).toContain('https://portal.examplehealth.org/share/jargonaut');
    for (let n = 1; n <= pages; n++) {
      expect(perPage[n - 1]).toContain('Shared by the patient via SMART Health Link — June 12, 2026');
      expect(perPage[n - 1]).toContain(`Page ${n} of ${pages}`);
    }
  });

  test('--title overrides H1; default output path derives from input', () => {
    const md = join(dir, 'titled.md');
    writeFileSync(md, '# From The File\n\nbody text\n');
    const r = run(MD_TO_PDF, [md, '--title', 'Override Wins']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.output).toBe(join(dir, 'titled.pdf'));
    expect(existsSync(out.output)).toBe(true);
  });

  test('multi-page table: header repeats on every page (summary theme)', async () => {
    const md = join(dir, 'bigtable.md');
    const rows = Array.from(
      { length: 70 },
      (_, i) => `| 2026-05-${(i % 28) + 1} | ${110 + (i % 30)} | ${70 + (i % 20)} | Morning reading, seated five minutes after light activity |`,
    );
    writeFileSync(
      md,
      `# Pressure Log\n\n## Readings\n\n| Date | Systolic | Diastolic | Notes |\n| --- | ---: | ---: | --- |\n${rows.join('\n')}\n`,
    );
    const pdf = join(dir, 'bigtable.pdf');
    const r = run(MD_TO_PDF, [md, pdf, '--theme', 'summary']);
    expect(r.code).toBe(0);
    const pages = await pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(2);
    for (let n = 1; n <= pages; n++) {
      const text = await pageText(pdf, n);
      expect(text).toContain('SYSTOLIC');
      expect(text).toContain('DIASTOLIC');
      expect(text).toContain('Shared by the patient via SMART Health Link');
    }
  });

  test('usage failure: missing input → exit 1 + usage on stderr, empty stdout', () => {
    const r = run(MD_TO_PDF, []);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Usage:');
  });

  test('bad --theme rejected', () => {
    const r = run(MD_TO_PDF, [STORY_MD, '--theme', 'fancy']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('story|summary');
  });

  // ------------------------------------------------------------- preview ----

  test('preview-pdf produces one PNG per page, in order', async () => {
    const outdir = join(dir, 'preview');
    const r = run(PREVIEW, [storyPdf, outdir]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    const pages = await pageCount(storyPdf);
    expect(out.pages).toHaveLength(pages);
    for (const [i, png] of out.pages.entries()) {
      expect(png).toContain(`page-${i + 1}`);
      expect(existsSync(png)).toBe(true);
      expect(statSync(png).size).toBeGreaterThan(1000);
    }
  });

  test('preview-pdf usage failure on missing file', () => {
    const r = run(PREVIEW, [join(dir, 'nope.pdf')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Usage:');
  });
});
