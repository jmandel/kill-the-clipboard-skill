// skill.zip builder (docs/DESIGN.md §2): composed per-request so {{BASE_URL}} always reflects the
// serving config. Zip layout:
//   SKILL.md                       composed by skill/build-skill.ts (buildSkillMd(baseUrl))
//   scripts/**                     skill/scripts, {{BASE_URL}} baked in
//   scripts/lib/kernel/*.ts(x)     vendored repo /lib (zip is self-contained, no bun install of it)
//   scripts/lib/kernel/fonts/*     embedded OFL fonts for lib/doc.tsx
//   scripts/package.json           deps pinned to the exact root specifiers
//   scripts/bun.lock               root lockfile copy
// ZIP container is hand-rolled store-only (no compression dep; fonts dominate and are small).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { utf8 } from '../../lib/encoding.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PINNED_DEPS = ['@react-pdf/renderer', 'react', 'react-dom', 'qrcode'];
const TEXT_FILE = /\.(ts|tsx|md|json|txt|html|css)$/;
// scripts/ sits 3 levels below repo root, so an import with depth+3 `../` segments
// that lands in lib/ is a kernel import; the zip relocates the kernel to scripts/lib/kernel/
const SCRIPTS_DEPTH_TO_ROOT = 2;
const KERNEL_IMPORT = /(['"])((?:\.\.\/)+)lib\/([A-Za-z0-9._-]+\.tsx?)\1/g;

export function rewriteKernelImports(source: string, relPath: string): string {
  const depth = relPath.split('/').length - 1;
  return source.replace(KERNEL_IMPORT, (whole, quote: string, ups: string, file: string) => {
    if (ups.length / 3 !== depth + SCRIPTS_DEPTH_TO_ROOT) return whole;
    const prefix = depth === 0 ? './' : '../'.repeat(depth);
    return `${quote}${prefix}lib/kernel/${file}${quote}`;
  });
}

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  // Fixed timestamp keeps builds deterministic for a given input set
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = utf8(entry.path);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 filenames
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...parts, ...central, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      yield* walk(p);
    } else if (ent.isFile()) {
      yield p;
    }
  }
}

export async function buildSkillZip(baseUrl: string): Promise<Uint8Array> {
  // Dynamic import: the skill unit builds in parallel — its absence must not break server boot
  const mod = await import(join(REPO_ROOT, 'skill', 'build-skill.ts'));
  if (typeof mod.buildSkillMd !== 'function') {
    throw new Error('skill/build-skill.ts does not export buildSkillMd(baseUrl)');
  }
  const skillMd: string = await mod.buildSkillMd(baseUrl);
  const entries: ZipEntry[] = [{ path: 'SKILL.md', data: utf8(skillMd) }];

  const scriptsDir = join(REPO_ROOT, 'skill', 'scripts');
  for (const file of walk(scriptsDir)) {
    const rel = relative(scriptsDir, file).split(sep).join('/');
    // kernel + manifest are regenerated below; anything checked in under those names is stale
    if (rel.startsWith('lib/kernel/') || rel === 'package.json' || rel === 'bun.lock') continue;
    let data: Uint8Array = new Uint8Array(readFileSync(file));
    if (TEXT_FILE.test(rel)) {
      let text = new TextDecoder().decode(data).replaceAll('{{BASE_URL}}', baseUrl);
      if (/\.tsx?$/.test(rel)) text = rewriteKernelImports(text, rel);
      data = utf8(text);
    }
    entries.push({ path: `scripts/${rel}`, data });
  }

  const libDir = join(REPO_ROOT, 'lib');
  for (const name of readdirSync(libDir)) {
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
    entries.push({ path: `scripts/lib/kernel/${name}`, data: new Uint8Array(readFileSync(join(libDir, name))) });
  }
  const fontsDir = join(libDir, 'fonts');
  if (existsSync(fontsDir)) {
    for (const name of readdirSync(fontsDir)) {
      entries.push({ path: `scripts/lib/kernel/fonts/${name}`, data: new Uint8Array(readFileSync(join(fontsDir, name))) });
    }
  }

  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const dependencies: Record<string, string> = {};
  for (const dep of PINNED_DEPS) {
    const spec = rootPkg.dependencies?.[dep];
    if (spec) dependencies[dep] = spec;
  }
  entries.push({
    path: 'scripts/package.json',
    data: utf8(
      JSON.stringify({ name: 'kill-the-clipboard-scripts', private: true, type: 'module', dependencies }, null, 2) + '\n',
    ),
  });
  const rootLock = join(REPO_ROOT, 'bun.lock');
  if (existsSync(rootLock)) {
    entries.push({ path: 'scripts/bun.lock', data: new Uint8Array(readFileSync(rootLock)) });
  }

  return buildZip(entries);
}
