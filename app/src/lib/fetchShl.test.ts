// fetchShlBundles against an in-test server: U-flag direct, manifest with embedded
// and location files, and the passcode dance (P flag, 401 remainingAttempts).

import { afterAll, describe, expect, test } from 'bun:test';
import { b64url, utf8 } from '../../../lib/encoding.ts';
import { encryptJWE } from '../../../lib/jwe.ts';
import type { ShlinkPayload } from '../../../lib/shlink.ts';
import { fetchShlBundles, PasscodeRequiredError } from './fetchShl.ts';

const key = b64url(crypto.getRandomValues(new Uint8Array(32)));
const bundle = { resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] };
const jwe = await encryptJWE(utf8(JSON.stringify(bundle)), key, { cty: 'application/fhir+json', deflate: true });

let base = '';
const server: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  routes: {
    '/u/file': (req) =>
      new URL(req.url).searchParams.get('recipient')
        ? new Response(jwe, { headers: { 'content-type': 'application/jose' } })
        : new Response(null, { status: 400 }),
    '/m/embedded': { POST: () => Response.json({ files: [{ contentType: 'application/fhir+json', embedded: jwe }] }) },
    '/m/located': {
      POST: () => Response.json({ files: [{ contentType: 'application/fhir+json', location: `${base}/u/ticketed` }] }),
    },
    '/u/ticketed': () => new Response(jwe, { headers: { 'content-type': 'application/jose' } }),
    '/m/passcoded': {
      POST: async (req) => {
        const body = (await req.json()) as { passcode?: string };
        if (body.passcode !== 'sesame') return Response.json({ remainingAttempts: 3 }, { status: 401 });
        return Response.json({ files: [{ contentType: 'application/fhir+json', embedded: jwe }] });
      },
    },
    '/u/gone': () => new Response(null, { status: 404 }),
  },
});
base = `http://localhost:${server.port}`;
afterAll(() => server.stop(true));

const payload = (url: string, flag: string): ShlinkPayload => ({ url, key, flag, exp: Math.floor(Date.now() / 1000) + 3600 });

describe('fetchShlBundles', () => {
  test('U-flag direct fetch decrypts the bundle', async () => {
    const out = await fetchShlBundles(payload(`${base}/u/file`, 'U'), 'Test Recipient');
    expect(out).toHaveLength(1);
    expect(out[0]!.entry?.[0]?.resource?.resourceType).toBe('Patient');
  });

  test('manifest flow with embedded file', async () => {
    const out = await fetchShlBundles(payload(`${base}/m/embedded`, ''), 'Test Recipient');
    expect(out).toHaveLength(1);
  });

  test('manifest flow with location file', async () => {
    const out = await fetchShlBundles(payload(`${base}/m/located`, 'L'), 'Test Recipient');
    expect(out).toHaveLength(1);
  });

  test('P flag without passcode asks before fetching; wrong passcode surfaces attempts', async () => {
    const p = payload(`${base}/m/passcoded`, 'LP');
    await expect(fetchShlBundles(p, 'T')).rejects.toBeInstanceOf(PasscodeRequiredError);
    const wrong = fetchShlBundles(p, 'T', 'nope');
    await expect(wrong).rejects.toThrow('3 attempts left');
    const out = await fetchShlBundles(p, 'T', 'sesame');
    expect(out).toHaveLength(1);
  });

  test('404 explains expiry/revocation', async () => {
    await expect(fetchShlBundles(payload(`${base}/u/gone`, 'U'), 'T')).rejects.toThrow('no longer available');
  });
});
