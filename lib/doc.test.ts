// Geometry regression tests for lib/doc.tsx (docs/DESIGN.md decision 19).
//
// The repeating-table-header behavior is undocumented emergent behavior of the PINNED
// @react-pdf/renderer version. If any of these fail after a dependency change, the
// upgrade broke the document engine — do not ship.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { badge, page, para, provenanceLine, pullQuote, renderDoc, section, storyTheme, summaryTheme, table, title } from './doc.tsx';

const dir = mkdtempSync(join(tmpdir(), 'ktc-doc-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function pageCount(pdf: string): Promise<number> {
  const info = await $`pdfinfo ${pdf}`.text();
  return Number(info.match(/Pages:\s+(\d+)/)?.[1]);
}

async function pageText(pdf: string, n: number): Promise<string> {
  return await $`pdftotext -f ${n} -l ${n} ${pdf} -`.text();
}

describe('doc engine geometry', () => {
  const pdf = join(dir, 'summary.pdf');

  test('long table: header repeats on every page, footer + page numbers everywhere', async () => {
    const t = summaryTheme;
    const rows = Array.from({ length: 60 }, (_, i) => [
      `Medication ${i + 1} hydrochloride extended-release`,
      `${(i % 9) + 1}0 mg`,
      i % 7 === 0
        ? 'Take 1 tablet by mouth once daily in the morning with a full glass of water, avoiding grapefruit; if a dose is missed take as soon as remembered unless within 6 hours of the next scheduled dose. '.repeat(2)
        : 'Take 1 tablet by mouth once daily.',
      badge(t, i % 3 === 0 ? 'ACTIVE' : 'STOPPED', i % 3 === 0 ? 'active' : 'stopped'),
    ]);
    await renderDoc(
      [
        page(
          t,
          [
            title(t, { title: 'Geometry Regression', kicker: 'TEST DOCUMENT', meta: [{ label: 'PATIENT', value: 'Casey Breadth-Tester' }] }),
            section(t, 'Medications'),
            table(t, {
              columns: [
                { header: 'Medication', width: 3 },
                { header: 'Dose', width: 1 },
                { header: 'Sig (Instructions)', width: 4 },
                { header: 'Status', width: 1 },
              ],
              rows,
            }),
          ],
          { key: 'p', footerLeft: provenanceLine('June 10, 2026') },
        ),
      ],
      { title: 'geometry test' },
      pdf,
    );

    const pages = await pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(3); // 60 rows must span pages

    for (let n = 1; n <= pages; n++) {
      const text = await pageText(pdf, n);
      // header row repeats (the regression this whole test exists for)
      expect(text).toContain('MEDICATION');
      expect(text).toContain('SIG (INSTRUCTIONS)');
      // fixed footer with provenance + accurate Page N of M on every page
      expect(text).toContain('Shared by the patient via SMART Health Link — June 10, 2026');
      expect(text).toContain(`Page ${n} of ${pages}`);
    }
    // every row landed (atomic rows can drop silently if wrap behavior changes)
    const all = (await Promise.all(Array.from({ length: pages }, (_, i) => pageText(pdf, i + 1)))).join('');
    for (const i of [1, 15, 30, 45, 60]) expect(all).toContain(`Medication ${i} hydrochloride`);
  });

  test('story theme: highlights, pull-quote, unbreakable token all render in-bounds', async () => {
    const t = storyTheme;
    const out = join(dir, 'story.pdf');
    await renderDoc(
      [
        page(t, [
          title(t, { title: 'My Story, Before We Talk', kicker: 'PATIENT STORY', meta: [{ label: 'DOB', value: 'Feb 29, 1980' }] }),
          section(t, 'What I am most worried about'),
          para(t, [
            { text: 'Fatigue is affecting my life ' },
            { text: 'more than the pain is', highlight: true },
            { text: ', and I want that to be the focus. Reference: ' },
            { text: 'https://example.org/a-very-long-unbreakable-path-segment-0123456789-0123456789-0123456789', url: true },
          ]),
          pullQuote(t, 'I am not asking you to find something wrong with me.'),
        ]),
      ],
      { title: 'story test' },
      out,
    );
    expect(await pageCount(out)).toBe(1);
    const text = await pageText(out, 1);
    expect(text).toContain('more than the pain is');
    expect(text).toContain('Page 1 of 1');
  });

  test('embedded fonts, no core-font fallback', async () => {
    const fonts = await $`pdffonts ${pdf}`.text();
    const dataLines = fonts.split('\n').slice(2).filter((l) => l.trim());
    expect(dataLines.length).toBeGreaterThan(0);
    for (const line of dataLines) expect(line).toMatch(/\byes\b/); // emb column
    expect(fonts).not.toMatch(/Helvetica|Times|Courier/);
  });
});
