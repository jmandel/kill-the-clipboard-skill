// The zip container is hand-rolled (store-only); verify it against a reference unzip
// implementation: a minimal central-directory parser plus known CRC32 vectors.

import { describe, expect, test } from 'bun:test';
import { utf8, utf8Decode } from '../../lib/encoding.ts';
import { buildZip, crc32 } from './zip.ts';

function parseZip(zip: Uint8Array): { path: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocdAt = zip.length - 22;
  expect(v.getUint32(eocdAt, true)).toBe(0x06054b50);
  const count = v.getUint16(eocdAt + 10, true);
  let pos = v.getUint32(eocdAt + 16, true);
  const out: { path: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(pos, true)).toBe(0x02014b50);
    const crc = v.getUint32(pos + 16, true);
    const size = v.getUint32(pos + 24, true);
    const nameLen = v.getUint16(pos + 28, true);
    const extraLen = v.getUint16(pos + 30, true);
    const commentLen = v.getUint16(pos + 32, true);
    const localOffset = v.getUint32(pos + 42, true);
    const path = utf8Decode(zip.slice(pos + 46, pos + 46 + nameLen));
    const localNameLen = v.getUint16(localOffset + 26, true);
    const localExtraLen = v.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    out.push({ path, data: zip.slice(dataStart, dataStart + size), crc });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('zip container', () => {
  test('crc32 reference vector', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test('entries round-trip through the central directory', () => {
    const entries = [
      { path: 'SKILL.md', data: utf8('# hello\n') },
      { path: 'scripts/lib/kernel/jwe.ts', data: utf8('export {};\n') },
      { path: 'scripts/fonts/blob.bin', data: crypto.getRandomValues(new Uint8Array(4096)) },
    ];
    const zip = buildZip(entries);
    expect([zip[0], zip[1]]).toEqual([0x50, 0x4b]);
    const parsed = parseZip(zip);
    expect(parsed.map((p) => p.path)).toEqual(entries.map((e) => e.path));
    for (let i = 0; i < entries.length; i++) {
      expect(parsed[i]!.data).toEqual(entries[i]!.data);
      expect(parsed[i]!.crc).toBe(crc32(entries[i]!.data));
    }
  });
});
