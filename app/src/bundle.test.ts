// Smoke test: the handoff page (index.html → main.tsx → React + qrcode + kernel libs)
// bundles cleanly for the browser, so Bun.serve HTML imports will serve it.

import { expect, test } from 'bun:test';

test('index.html bundles for the browser', async () => {
  const result = await Bun.build({
    entrypoints: [new URL('../index.html', import.meta.url).pathname],
    target: 'browser',
    minify: false,
  });
  expect(result.success).toBe(true);
  const js = result.outputs.find((o) => o.path.endsWith('.js'));
  const css = result.outputs.find((o) => o.path.endsWith('.css'));
  const html = result.outputs.find((o) => o.path.endsWith('.html'));
  expect(js).toBeDefined();
  expect(css).toBeDefined();
  expect(html).toBeDefined();
  const bundled = await js!.text();
  for (const marker of ['ktc-shl/v1/auth', 'ktc-shl/v1/key', 'shlink:/', 'Keep this page bookmarkable', 'Preview as recipient']) {
    expect(bundled).toContain(marker);
  }
}, 30_000);
