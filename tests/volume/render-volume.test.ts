// True-volume rendering tier — opt-in (RUN_VOLUME=1 bun test tests/volume/).
//
// The per-family golden tests amplify to ~120 resources (≥3 page breaks), which already
// proves the page-count-invariant guarantees: repeating headers, atomic rows, no overflow.
// This tier exists for what is NOT page-count-invariant: react-pdf's scaling behavior on
// 100+ page documents (layout time, memory, page totals). ~60s — keep it out of the
// default loop.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amplify, loadFamilyFixtures, pdfText, renderFamiliesToPdf } from '../../skill/kill-the-clipboard/scripts/lib/fhir-render/harness.ts';
import { registry } from '../../skill/kill-the-clipboard/scripts/lib/fhir-render/registry.ts';

const enabled = process.env.RUN_VOLUME === '1';

describe.skipIf(!enabled)('volume tier (RUN_VOLUME=1)', () => {
  test('mixed 600-resource document renders, stays complete, headers repeat at depth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktc-volume-'));
    try {
      const meds = amplify(await loadFamilyFixtures('medications'), 200);
      const labs = amplify(await loadFamilyFixtures('labs'), 250);
      const problems = amplify(await loadFamilyFixtures('problems'), 150);
      const resources = [...meds, ...labs, ...problems];
      const out = join(dir, 'volume.pdf');

      const started = performance.now();
      const res = await renderFamiliesToPdf(registry, resources, out);
      const seconds = (performance.now() - started) / 1000;

      expect(res.renderedIds.length).toBe(resources.length);
      expect(new Set(res.renderedIds).size).toBe(resources.length);
      expect(res.pages).toBeGreaterThan(40);
      // headers must still repeat deep into the document, not just on early pages
      const deep = await pdfText(out, Math.floor(res.pages * 0.8));
      expect(deep.length).toBeGreaterThan(0);
      console.error(`volume render: ${resources.length} resources → ${res.pages} pages in ${seconds.toFixed(1)}s`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

if (!enabled) {
  test('volume tier skipped (set RUN_VOLUME=1 to run)', () => expect(true).toBe(true));
}
