// docs/DESIGN.md §9 server matrix: in-memory sqlite + ephemeral port, real HTTP through Bun.serve.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'bun';
type BunServer = Server<undefined>;
import type { Database } from 'bun:sqlite';
import { utf8, utf8Decode } from '../../lib/encoding.ts';
import { deriveAuth, deriveKey, generateMasterSecret } from '../../lib/hkdf.ts';
import { decryptJWE, encryptJWE } from '../../lib/jwe.ts';
import type { CreateLinkResponse, ManageState, Manifest, PasscodeError } from '../../lib/types.ts';
import type { ServerConfig } from './config.ts';
import { epoch, getServerSecret, openDb } from './db.ts';
import { createApp } from './index.ts';
import { sweep } from './sweep.ts';
import { Ticketer } from './tickets.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUNDLE = JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: [{ note: 'fixture' }] });

interface Ctx {
  server: BunServer;
  db: Database;
  config: ServerConfig;
  base: string;
}

const open: Ctx[] = [];

async function makeServer(): Promise<Ctx> {
  const db = openDb(':memory:');
  const config: ServerConfig = {
    server: { port: 0, baseURL: 'http://placeholder' },
    limits: { maxFileBytes: 26_214_400 },
    retention: { purgeAfterDays: 30 },
  };
  const server = await createApp(config, db);
  config.server.baseURL = `http://localhost:${server.port}`;
  const ctx = { server, db, config, base: config.server.baseURL };
  open.push(ctx);
  return ctx;
}

afterEach(() => {
  for (const ctx of open.splice(0)) ctx.server.stop(true);
});

interface MadeLink {
  m: Uint8Array;
  auth: string;
  key: string;
  id: string;
  url: string;
}

async function createLink(
  ctx: Ctx,
  opts: { flag?: string; exp?: number; maxUses?: number | null; passcode?: string; label?: string } = {},
): Promise<MadeLink> {
  const m = generateMasterSecret();
  const auth = await deriveAuth(m);
  const key = await deriveKey(m);
  const res = await fetch(`${ctx.base}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ auth, exp: epoch() + 86_400, ...opts }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as CreateLinkResponse;
  return { m, auth, key, id: body.id, url: body.url };
}

async function uploadFile(ctx: Ctx, link: MadeLink, plaintext = BUNDLE): Promise<{ fileId: string; jwe: string }> {
  const jwe = await encryptJWE(utf8(plaintext), link.key, { cty: 'application/fhir+json' });
  const res = await fetch(`${ctx.base}/api/manage/${link.auth}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/fhir+json' },
    body: jwe,
  });
  expect(res.status).toBe(200);
  const { fileId } = (await res.json()) as { fileId: string };
  return { fileId, jwe };
}

const manifest = (ctx: Ctx, id: string, body: object) =>
  fetch(`${ctx.base}/shl/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const manage = async (ctx: Ctx, auth: string): Promise<ManageState> => {
  const res = await fetch(`${ctx.base}/api/manage/${auth}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ManageState;
};

const patchLink = (ctx: Ctx, auth: string, patch: object) =>
  fetch(`${ctx.base}/api/manage/${auth}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

describe('round trip', () => {
  test('create → upload → direct GET → decrypt matches the original bundle', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { label: 'Casey Tester — visit summary' });
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBe(`${ctx.base}/shl/${link.id}`);
    expect(link.url.length).toBeLessThanOrEqual(128);
    await uploadFile(ctx, link);

    const res = await fetch(`${link.url}?recipient=${encodeURIComponent('Dr. Example Clinic')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/jose');
    const { plaintext, header } = await decryptJWE(await res.text(), link.key);
    expect(utf8Decode(plaintext)).toBe(BUNDLE);
    expect(header.cty).toBe('application/fhir+json');

    const state = await manage(ctx, link.auth);
    expect(state.uses).toBe(1);
    expect(state.live).toBe(true);
    expect(state.files).toHaveLength(1);
    expect(state.files[0]!.contentType).toBe('application/fhir+json');
  });

  test('direct GET without recipient → 400', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    await uploadFile(ctx, link);
    const res = await fetch(link.url);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('recipient');
  });
});

describe('404 matrix (each existing-link case audits outcome=inactive)', () => {
  async function expectInactive404(ctx: Ctx, link: MadeLink): Promise<void> {
    const res = await fetch(`${link.url}?recipient=matrix`);
    expect(res.status).toBe(404);
    const state = await manage(ctx, link.auth);
    const last = state.accessLog.at(-1)!;
    expect(last.action).toBe('direct');
    expect(last.outcome).toBe('inactive');
    expect(last.recipient).toBe('matrix');
  }

  test('unknown id → 404', async () => {
    const ctx = await makeServer();
    const res = await fetch(`${ctx.base}/shl/${'A'.repeat(43)}?recipient=x`);
    expect(res.status).toBe(404);
  });

  test('expired', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { exp: epoch() - 10 });
    await uploadFile(ctx, link);
    await expectInactive404(ctx, link);
  });

  test('exhausted', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { maxUses: 1 });
    await uploadFile(ctx, link);
    expect((await fetch(`${link.url}?recipient=first`)).status).toBe(200);
    await expectInactive404(ctx, link);
  });

  test('paused via PATCH {active:false}, resumable', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    await uploadFile(ctx, link);
    expect((await patchLink(ctx, link.auth, { active: false })).status).toBe(200);
    await expectInactive404(ctx, link);
    expect((await patchLink(ctx, link.auth, { active: true })).status).toBe(200);
    expect((await fetch(`${link.url}?recipient=back`)).status).toBe(200);
  });

  test('destroyed via DELETE manage → terminal, tombstone visible to owner', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    await uploadFile(ctx, link);
    const del = await fetch(`${ctx.base}/api/manage/${link.auth}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    await expectInactive404(ctx, link);
    const state = await manage(ctx, link.auth);
    expect(state.active).toBe(false);
    expect(state.live).toBe(false);
    expect(state.purgedAt).not.toBeNull();
  });

  test('purged by sweeper → 404 + tombstone, ciphertext gone', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { exp: epoch() - 31 * 86_400 });
    await uploadFile(ctx, link);
    expect(sweep(ctx.db, 30)).toBe(1);
    await expectInactive404(ctx, link);
    const state = await manage(ctx, link.auth);
    expect(state.purgedAt).not.toBeNull();
    const row = ctx.db.query('SELECT ciphertext FROM files WHERE link_id = ?').get(link.id) as {
      ciphertext: Uint8Array | null;
    };
    expect(row.ciphertext).toBeNull();
  });

  test('sweeper leaves links inside the retention window alone', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { exp: epoch() - 86_400 });
    await uploadFile(ctx, link);
    expect(sweep(ctx.db, 30)).toBe(0);
    expect((await manage(ctx, link.auth)).purgedAt).toBeNull();
  });
});

describe('manifest + passcode', () => {
  test('manifest happy path with location, then ticketed file fetch', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: '' });
    const { jwe } = await uploadFile(ctx, link);
    const res = await manifest(ctx, link.id, { recipient: 'Front Desk' });
    expect(res.status).toBe(200);
    const m = (await res.json()) as Manifest;
    expect(m.files).toHaveLength(1);
    expect(m.files[0]!.contentType).toBe('application/fhir+json');
    expect(m.files[0]!.embedded).toBeUndefined();
    expect(m.files[0]!.location).toStartWith(`${ctx.base}/shl/${link.id}/f/`);

    const fileRes = await fetch(m.files[0]!.location!);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toBe('application/jose');
    expect(await fileRes.text()).toBe(jwe);
  });

  test('embeddedLengthMax honored: large cap embeds, small cap gives location', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: '' });
    const { jwe } = await uploadFile(ctx, link);

    const big = (await (await manifest(ctx, link.id, { recipient: 'r', embeddedLengthMax: 10_000_000 })).json()) as Manifest;
    expect(big.files[0]!.embedded).toBe(jwe);
    expect(big.files[0]!.location).toBeUndefined();
    const { plaintext } = await decryptJWE(big.files[0]!.embedded!, link.key);
    expect(utf8Decode(plaintext)).toBe(BUNDLE);

    const small = (await (await manifest(ctx, link.id, { recipient: 'r', embeddedLengthMax: 10 })).json()) as Manifest;
    expect(small.files[0]!.embedded).toBeUndefined();
    expect(small.files[0]!.location).toBeDefined();
  });

  test('manifest without recipient → 400; unknown link → 404', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: '' });
    await uploadFile(ctx, link);
    expect((await manifest(ctx, link.id, {})).status).toBe(400);
    expect((await manifest(ctx, 'B'.repeat(43), { recipient: 'x' })).status).toBe(404);
  });

  test('bad passcode → 401 {remainingAttempts}; correct passcode → manifest', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: 'P', passcode: 'open sesame' });
    await uploadFile(ctx, link);

    const bad = await manifest(ctx, link.id, { recipient: 'r', passcode: 'wrong' });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as PasscodeError).remainingAttempts).toBe(4);

    const good = await manifest(ctx, link.id, { recipient: 'r', passcode: 'open sesame' });
    expect(good.status).toBe(200);

    const state = await manage(ctx, link.auth);
    expect(state.passcodeAttemptsRemaining).toBe(4);
    expect(state.accessLog.map((a) => a.outcome)).toEqual(['bad-passcode', 'ok']);
  });

  test('10 parallel wrong guesses never exceed the lifetime budget of 5', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: 'P', passcode: 'hunter2!' });
    await uploadFile(ctx, link);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => manifest(ctx, link.id, { recipient: 'attacker', passcode: 'nope' })),
    );
    const unauthorized = results.filter((r) => r.status === 401);
    const gone = results.filter((r) => r.status === 404);
    expect(unauthorized).toHaveLength(5);
    expect(gone).toHaveLength(5);
    const remaining = (await Promise.all(unauthorized.map(async (r) => ((await r.json()) as PasscodeError).remainingAttempts))).sort();
    expect(remaining).toEqual([0, 1, 2, 3, 4]);

    // Lockout is permanent: even the correct passcode is 404 now
    expect((await manifest(ctx, link.id, { recipient: 'r', passcode: 'hunter2!' })).status).toBe(404);
    const state = await manage(ctx, link.auth);
    expect(state.passcodeAttemptsRemaining).toBe(0);
    expect(state.live).toBe(false);
    expect(state.accessLog.filter((a) => a.outcome === 'bad-passcode')).toHaveLength(5);

    // PATCH {passcode} resets the budget — the lockout re-arm path
    expect((await patchLink(ctx, link.auth, { passcode: 'hunter3!' })).status).toBe(200);
    expect((await manifest(ctx, link.id, { recipient: 'r', passcode: 'hunter3!' })).status).toBe(200);
  });
});

describe('tickets', () => {
  test('expired and forged tickets → 404', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: '' });
    const { fileId } = await uploadFile(ctx, link);

    const real = new Ticketer(getServerSecret(ctx.db));
    const valid = await real.issue(link.id, fileId);
    expect((await fetch(`${ctx.base}/shl/${link.id}/f/${fileId}?t=${encodeURIComponent(valid)}`)).status).toBe(200);

    const expired = await real.issue(link.id, fileId, -10);
    expect((await fetch(`${ctx.base}/shl/${link.id}/f/${fileId}?t=${encodeURIComponent(expired)}`)).status).toBe(404);

    const forged = await new Ticketer(crypto.getRandomValues(new Uint8Array(32))).issue(link.id, fileId);
    expect((await fetch(`${ctx.base}/shl/${link.id}/f/${fileId}?t=${encodeURIComponent(forged)}`)).status).toBe(404);

    // A ticket for one file does not open another
    expect((await fetch(`${ctx.base}/shl/${link.id}/f/other-file?t=${encodeURIComponent(valid)}`)).status).toBe(404);

    expect((await fetch(`${ctx.base}/shl/${link.id}/f/${fileId}`)).status).toBe(404);
    expect((await fetch(`${ctx.base}/shl/${link.id}/f/${fileId}?t=garbage`)).status).toBe(404);
  });
});

describe('U-flag file-count enforcement', () => {
  test('second POST rejected; DELETE of last file rejected while active', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    const { fileId, jwe } = await uploadFile(ctx, link);

    const second = await fetch(`${ctx.base}/api/manage/${link.auth}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/fhir+json' },
      body: jwe,
    });
    expect(second.status).toBe(400);

    const del = await fetch(`${ctx.base}/api/manage/${link.auth}/files/${fileId}`, { method: 'DELETE' });
    expect(del.status).toBe(400);

    // Paused link may drop its file
    await patchLink(ctx, link.auth, { active: false });
    const delPaused = await fetch(`${ctx.base}/api/manage/${link.auth}/files/${fileId}`, { method: 'DELETE' });
    expect(delPaused.status).toBe(204);
    expect((await manage(ctx, link.auth)).files).toHaveLength(0);
  });

  test('PUT replaces ciphertext in place (same key, new IV)', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    const { fileId } = await uploadFile(ctx, link);
    const updated = JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: [{ note: 'v2' }] });
    const jwe2 = await encryptJWE(utf8(updated), link.key, { cty: 'application/fhir+json' });
    const put = await fetch(`${ctx.base}/api/manage/${link.auth}/files/${fileId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/fhir+json' },
      body: jwe2,
    });
    expect(put.status).toBe(200);
    const res = await fetch(`${link.url}?recipient=clinic`);
    const { plaintext } = await decryptJWE(await res.text(), link.key);
    expect(utf8Decode(plaintext)).toBe(updated);
  });
});

describe('re-arm', () => {
  test('expired → 404, PATCH exp restores 200', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { exp: epoch() - 10 });
    await uploadFile(ctx, link);
    expect((await fetch(`${link.url}?recipient=r`)).status).toBe(404);
    expect((await patchLink(ctx, link.auth, { exp: epoch() + 3600 })).status).toBe(200);
    expect((await fetch(`${link.url}?recipient=r`)).status).toBe(200);
  });

  test('exhausted → 404, PATCH maxUses restores 200', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { maxUses: 1 });
    await uploadFile(ctx, link);
    await fetch(`${link.url}?recipient=r`);
    expect((await fetch(`${link.url}?recipient=r`)).status).toBe(404);
    expect((await patchLink(ctx, link.auth, { maxUses: 5 })).status).toBe(200);
    expect((await fetch(`${link.url}?recipient=r`)).status).toBe(200);
  });
});

describe('audit log', () => {
  test('entries carry exact ts/recipient/action/outcome in order', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    await uploadFile(ctx, link);
    await fetch(`${link.url}?recipient=${encodeURIComponent('Dr. Pat Granite')}`);
    await patchLink(ctx, link.auth, { active: false });
    await fetch(`${link.url}?recipient=${encodeURIComponent('Dr. Pat Granite')}`);

    const state = await manage(ctx, link.auth);
    expect(state.accessLog).toHaveLength(2);
    const [ok, inactive] = state.accessLog;
    expect(ok).toMatchObject({ recipient: 'Dr. Pat Granite', action: 'direct', outcome: 'ok' });
    expect(inactive).toMatchObject({ recipient: 'Dr. Pat Granite', action: 'direct', outcome: 'inactive' });
    expect(ok!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Date.parse(ok!.ts)).toBeLessThanOrEqual(Date.parse(inactive!.ts));
  });

  test('manifest + ticketed file fetch are both audited', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx, { flag: '' });
    await uploadFile(ctx, link);
    const m = (await (await manifest(ctx, link.id, { recipient: 'Clinic Kiosk' })).json()) as Manifest;
    await fetch(m.files[0]!.location!);
    const state = await manage(ctx, link.auth);
    expect(state.accessLog.map((a) => [a.action, a.outcome, a.recipient])).toEqual([
      ['manifest', 'ok', 'Clinic Kiosk'],
      ['file', 'ok', ''],
    ]);
  });
});

describe('control plane validation + capability lookup', () => {
  test('wrong auth → 404 (not 401; no oracle distinguishing wrong vs absent)', async () => {
    const ctx = await makeServer();
    const link = await createLink(ctx);
    await uploadFile(ctx, link);
    const wrong = await deriveAuth(generateMasterSecret());
    for (const [path, init] of [
      [`/api/manage/${wrong}`, undefined],
      [`/api/manage/${wrong}`, { method: 'PATCH', body: '{}' }],
      [`/api/manage/${wrong}`, { method: 'DELETE' }],
      [`/api/manage/${wrong}/files`, { method: 'POST', body: 'x' }],
      ['/api/manage/short', undefined],
    ] as const) {
      const res = await fetch(`${ctx.base}${path}`, init as RequestInit | undefined);
      expect(res.status).toBe(404);
    }
  });

  test('create rejects bad auth, long label, invalid flags, U+P, missing exp', async () => {
    const ctx = await makeServer();
    const auth = await deriveAuth(generateMasterSecret());
    const post = (body: object) =>
      fetch(`${ctx.base}/api/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const exp = epoch() + 3600;
    expect((await post({ auth: 'tooshort', exp })).status).toBe(400);
    expect((await post({ auth, exp, labelEnc: 'x'.repeat(2049) })).status).toBe(400); // blob bound
    expect((await post({ auth: await deriveAuth(generateMasterSecret()), exp, labelEnc: 'eyJfake.jwe.blob' })).status).toBe(200); // opaque — server never inspects
    expect((await post({ auth, exp, flag: 'X' })).status).toBe(400);
    expect((await post({ auth, exp, flag: 'UP' })).status).toBe(400); // non-alphabetical
    expect((await post({ auth, exp, flag: 'PU', passcode: 'p' })).status).toBe(400); // U excludes P
    expect((await post({ auth, exp: undefined })).status).toBe(400);
    expect((await post({ auth, exp, flag: 'P' })).status).toBe(400); // P without passcode
    expect((await post({ auth, exp, passcode: 'p' })).status).toBe(400); // passcode without P
    expect((await post({ auth, exp, flag: 'LU' })).status).toBe(200);
  });

  test('duplicate auth registration → 409', async () => {
    const ctx = await makeServer();
    const auth = await deriveAuth(generateMasterSecret());
    const body = JSON.stringify({ auth, exp: epoch() + 3600 });
    const post = () =>
      fetch(`${ctx.base}/api/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(409);
  });

  test('oversize upload → 413', async () => {
    const ctx = await makeServer();
    ctx.config.limits.maxFileBytes = 64;
    const link = await createLink(ctx);
    const res = await fetch(`${ctx.base}/api/manage/${link.auth}/files`, {
      method: 'POST',
      body: 'x'.repeat(65),
    });
    expect(res.status).toBe(413);
  });

  test('CORS: preflight + headers on manage responses', async () => {
    const ctx = await makeServer();
    const pre = await fetch(`${ctx.base}/api/links`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    const link = await createLink(ctx);
    const res = await fetch(`${ctx.base}/api/manage/${link.auth}`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('static + bundle routes', () => {
  test('landing page serves HTML naming the project and the skill zip', async () => {
    const ctx = await makeServer();
    const res = await fetch(`${ctx.base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('kill-the-clipboard');
    expect(html).toContain('/skill.zip');
  });

  test('/skill.zip: 200 zip when the skill unit exists, 503 {error} otherwise', async () => {
    const ctx = await makeServer();
    const res = await fetch(`${ctx.base}/skill.zip`);
    if (existsSync(join(REPO_ROOT, 'skill', 'build-skill.ts'))) {
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // 'PK'
    } else {
      expect(res.status).toBe(503);
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string');
    }
  });

  test('/s: handoff app when built, 503 placeholder otherwise', async () => {
    const ctx = await makeServer();
    const res = await fetch(`${ctx.base}/s`);
    if (existsSync(join(REPO_ROOT, 'app', 'index.html'))) {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(503);
    }
  });
});
