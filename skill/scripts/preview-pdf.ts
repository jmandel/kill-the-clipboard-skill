#!/usr/bin/env bun
/**
 * preview-pdf.ts — rasterize a PDF to PNGs for visual verification (docs/DESIGN.md decision 18:
 * "render with pdftoppm and inspect before declaring done").
 *
 * Usage:
 *   preview-pdf.ts <file.pdf> [outdir]
 *
 * Options:
 *   <file.pdf>   PDF to rasterize. Required.
 *   [outdir]     Output directory (created if missing); default "<file>-preview" next
 *                to the PDF.
 *
 * Output (stdout, single JSON object): {"pages":["/abs/path/page-1.png",...]} in page order.
 * stderr carries progress; exit 1 + usage on failure. Requires poppler's pdftoppm.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';

const USAGE = 'Usage: preview-pdf.ts <file.pdf> [outdir]';

function fail(msg: string): never {
  console.error(`preview-pdf: ${msg}\n${USAGE}`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1 || argv.length > 2 || argv.some((a) => a.startsWith('--'))) fail('expected <file.pdf> [outdir]');
  const pdf = path.resolve(argv[0]!);
  if (!existsSync(pdf)) fail(`input not found: ${pdf}`);

  const outdir = path.resolve(argv[1] ?? pdf.replace(/\.pdf$/i, '') + '-preview');
  mkdirSync(outdir, { recursive: true });
  // Stale pages from an earlier (longer) render of the same PDF must not leak into output.
  for (const f of readdirSync(outdir)) {
    if (/^page-\d+\.png$/.test(f)) rmSync(path.join(outdir, f));
  }
  const prefix = path.join(outdir, 'page');

  console.error(`preview-pdf: rasterizing ${pdf} at 120 dpi`);
  const r = await $`pdftoppm -png -r 120 ${pdf} ${prefix}`.quiet().nothrow();
  if (r.exitCode !== 0) fail(`pdftoppm failed: ${r.stderr.toString().trim()}`);

  // pdftoppm zero-pads page numbers based on page count; sort numerically, not lexically.
  const pages = readdirSync(outdir)
    .filter((f) => /^page-\d+\.png$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((f) => path.join(outdir, f));
  if (pages.length === 0) fail('pdftoppm produced no pages');
  console.log(JSON.stringify({ pages }));
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
