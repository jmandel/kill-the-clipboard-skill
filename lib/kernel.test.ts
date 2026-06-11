import { describe, expect, test } from 'bun:test';
import * as jose from 'jose';
import { b64url, b64urlDecode, utf8, utf8Decode } from './encoding.ts';
import { authHash, deriveAuth, deriveKey, generateMasterSecret, hkdf } from './hkdf.ts';
import { decryptJWE, encryptJWE } from './jwe.ts';
import { buildOwnerLink, buildShlink, buildViewerLink, parseFragment, parseShlink } from './shlink.ts';

const FIXED_M = new Uint8Array(32).map((_, i) => i); // 00 01 02 ... 1f

describe('encoding', () => {
  test('b64url round-trip, no padding chars', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(57));
    const enc = b64url(bytes);
    expect(enc).not.toMatch(/[+/=]/);
    expect(b64urlDecode(enc)).toEqual(bytes);
  });
  test('32 bytes → 43 chars', () => {
    expect(b64url(new Uint8Array(32))).toHaveLength(43);
  });
});

describe('hkdf derivation', () => {
  test('deterministic known-answer (frozen — a change here breaks every issued link)', async () => {
    expect(await deriveAuth(FIXED_M)).toBe('er-7nCzrbnNzKl0hpzRKDcmLzCjOrTRC1Vj3V38IIbE');
    expect(await deriveKey(FIXED_M)).toBe('_C07sIzxaxNZVrB93X4oFQkxROQuGgv2715U-p4qzG4');
  });
  test('auth and key are independent and 32 bytes each', async () => {
    const a = await hkdf(FIXED_M, 'ktc-shl/v1/auth');
    const k = await hkdf(FIXED_M, 'ktc-shl/v1/key');
    expect(a).toHaveLength(32);
    expect(k).toHaveLength(32);
    expect(b64url(a)).not.toBe(b64url(k));
  });
  test('fresh master secrets differ', () => {
    expect(b64url(generateMasterSecret())).not.toBe(b64url(generateMasterSecret()));
  });
  test('authHash is sha256 hex', async () => {
    const h = await authHash('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('jwe', () => {
  const key = b64url(new Uint8Array(32).map((_, i) => 255 - i));

  test('round-trip with cty', async () => {
    const pt = utf8(JSON.stringify({ resourceType: 'Bundle', type: 'collection' }));
    const jwe = await encryptJWE(pt, key, { cty: 'application/fhir+json' });
    expect(jwe.split('.')).toHaveLength(5);
    expect(jwe.split('.')[1]).toBe(''); // dir → empty encrypted key
    const { plaintext, header } = await decryptJWE(jwe, key);
    expect(utf8Decode(plaintext)).toContain('"Bundle"');
    expect(header.cty).toBe('application/fhir+json');
  });

  test('round-trip with zip DEF', async () => {
    const pt = utf8('x'.repeat(50_000));
    const jwe = await encryptJWE(pt, key, { deflate: true });
    expect(jwe.length).toBeLessThan(5_000); // actually compressed
    const { plaintext, header } = await decryptJWE(jwe, key);
    expect(header.zip).toBe('DEF');
    expect(plaintext).toHaveLength(50_000);
  });

  test('unique IV per encryption (same key, same plaintext)', async () => {
    const pt = utf8('same');
    const [a, b] = [await encryptJWE(pt, key), await encryptJWE(pt, key)];
    expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
  });

  test('jose can decrypt ours', async () => {
    const jwe = await encryptJWE(utf8('cross-check'), key, { cty: 'application/fhir+json' });
    const { plaintext, protectedHeader } = await jose.compactDecrypt(jwe, b64urlDecode(key));
    expect(utf8Decode(new Uint8Array(plaintext))).toBe('cross-check');
    expect(protectedHeader.enc).toBe('A256GCM');
  });

  test('we can decrypt jose (incl. zip DEF)', async () => {
    const deflateRaw = async (data: Uint8Array) =>
      new Uint8Array(
        await new Response(
          new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')),
        ).arrayBuffer(),
      );
    const enc = await new jose.CompactEncrypt(utf8('jose made this'))
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', zip: 'DEF' })
      .encrypt(b64urlDecode(key), { deflateRaw });
    const { plaintext } = await decryptJWE(enc, key);
    expect(utf8Decode(plaintext)).toBe('jose made this');
  });

  test('tamper detection', async () => {
    const jwe = await encryptJWE(utf8('secret'), key);
    const parts = jwe.split('.');
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith('AA') ? 'BB' : 'AA');
    expect(decryptJWE(parts.join('.'), key)).rejects.toThrow();
  });

  test('wrong key length rejected', async () => {
    expect(encryptJWE(utf8('x'), b64url(new Uint8Array(16)))).rejects.toThrow('32 bytes');
  });
});

describe('shlink', () => {
  const key = b64url(new Uint8Array(32));
  const payload = {
    url: 'https://ktc.example/shl/0000000000000000000000000000000000000000000',
    key,
    exp: 1781136000,
    flag: 'U',
    label: 'Casey Breadth-Tester — visit summary',
  };

  test('build/parse round-trip, bare and viewer-prefixed', () => {
    const link = buildShlink(payload);
    expect(link.startsWith('shlink:/')).toBe(true);
    expect(parseShlink(link)).toEqual(payload);
    expect(parseShlink(`https://viewer.example#${link}`)).toEqual(payload);
  });

  test('constraint enforcement', () => {
    expect(() => buildShlink({ ...payload, url: 'https://x/' + 'a'.repeat(130) })).toThrow('128');
    expect(() => buildShlink({ ...payload, label: 'x'.repeat(81) })).toThrow('80');
    expect(() => buildShlink({ ...payload, flag: 'PU' })).toThrow('combined');
    expect(() => buildShlink({ ...payload, flag: 'UL' })).toThrow('alphabetical');
    expect(() => buildShlink({ ...payload, key: 'short' })).toThrow();
  });

  test('owner/viewer fragments parse back', () => {
    const owner = buildOwnerLink('https://ktc.example/', FIXED_M);
    expect(owner).toBe(`https://ktc.example/s#${b64url(FIXED_M)}`);
    const po = parseFragment(owner.split('#')[1]!);
    if (po.mode !== 'owner') throw new Error('expected owner');
    expect(po.masterSecret).toEqual(FIXED_M);

    const viewer = buildViewerLink('https://ktc.example', buildShlink(payload));
    const pv = parseFragment(viewer.split('#')[1]!);
    if (pv.mode !== 'viewer') throw new Error('expected viewer');
    expect(pv.payload.label).toBe(payload.label);
  });

  test('owner fragment with api param', () => {
    const p = parseFragment(`${b64url(FIXED_M)}&api=${encodeURIComponent('https://other.example')}`);
    if (p.mode !== 'owner') throw new Error('expected owner');
    expect(p.api).toBe('https://other.example');
  });
});

describe('schema', () => {
  test('schema.sql applies cleanly to a fresh database', async () => {
    const { Database } = await import('bun:sqlite');
    const db = new Database(':memory:');
    db.exec(await Bun.file(new URL('../server/src/schema.sql', import.meta.url).pathname).text());
    db.exec(
      `INSERT INTO links (id, mgmt_token_hash, exp, created_at, updated_at) VALUES ('x', 'h', 1, 0, 0)`,
    );
    expect(db.query('SELECT flag, active, uses FROM links').get()).toEqual({ flag: 'U', active: 1, uses: 0 });
  });
});
