// End-to-end tests for create-shl.ts / manage-shl.ts against an in-memory mock server
// implementing the lib/types.ts control-plane contract + the U-flag data plane.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactDecrypt } from 'jose';
import QRCode from 'qrcode';
import { b64url, b64urlDecode } from '../../../lib/encoding.ts';
import { authHash, deriveAuth, deriveKey } from '../../../lib/hkdf.ts';
import { decryptJWE } from '../../../lib/jwe.ts';
import { parseFragment, parseShlink } from '../../../lib/shlink.ts';
import type {
  AccessEntry,
  CreateLinkRequest,
  CreateShlOutput,
  ManagePatch,
  ManageState,
} from '../../../lib/types.ts';
import { normalizeBaseUrl, resolveServerUrl } from '../_resolve-server.ts';

const SCRIPTS_DIR = join(import.meta.dir, '..');
const CREATE = join(SCRIPTS_DIR, 'create-shl.ts');
const MANAGE = join(SCRIPTS_DIR, 'manage-shl.ts');

// --- Mock server ----------------------------------------------------------------------

interface MockFile {
  fileId: string;
  contentType: string;
  jwe: string;
  createdAt: number;
  updatedAt: number;
}

interface MockLink {
  id: string;
  authHash: string;
  flag: string;
  label: string | null;
  exp: number | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  purgedAt: number | null;
  createdAt: number;
  files: MockFile[];
  accessLog: { ts: number; recipient: string; action: string; outcome: string }[];
}

const links = new Map<string, MockLink>();

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function isLive(l: MockLink): boolean {
  return (
    l.active &&
    (l.exp === null || now() < l.exp) &&
    (l.maxUses === null || l.uses < l.maxUses) &&
    l.purgedAt === null &&
    l.files.length > 0
  );
}

function toManageState(l: MockLink, base: string): ManageState {
  return {
    id: l.id,
    url: `${base}/shl/${l.id}`,
    flag: l.flag,
    labelEnc: l.label,
    exp: l.exp,
    maxUses: l.maxUses,
    uses: l.uses,
    active: l.active,
    live: isLive(l),
    purgedAt: l.purgedAt === null ? null : new Date(l.purgedAt * 1000).toISOString(),
    passcodeAttemptsRemaining: null,
    createdAt: new Date(l.createdAt * 1000).toISOString(),
    files: l.files.map((f) => ({
      fileId: f.fileId,
      contentType: f.contentType,
      size: Buffer.byteLength(f.jwe),
      lastUpdated: new Date(f.updatedAt * 1000).toISOString(),
    })),
    accessLog: l.accessLog.map(
      (a) =>
        ({
          ts: new Date(a.ts * 1000).toISOString(),
          recipient: a.recipient,
          action: a.action,
          outcome: a.outcome,
        }) as AccessEntry,
    ),
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function findByAuth(authParam: string): Promise<MockLink | undefined> {
  const hash = await authHash(decodeURIComponent(authParam));
  return [...links.values()].find((l) => l.authHash === hash);
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

function startMockServer(): void {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;

      if (req.method === 'POST' && path === '/api/links') {
        const body = (await req.json()) as CreateLinkRequest;
        const auth = bearer;
        if (!auth || !('exp' in body)) return json({ error: 'auth (Authorization header) and exp required' }, 400);
        const link: MockLink = {
          id: randomToken(),
          authHash: await authHash(auth),
          flag: body.flag ?? 'U',
          label: body.labelEnc ?? null,
          exp: body.exp,
          maxUses: body.maxUses ?? null,
          uses: 0,
          active: true,
          purgedAt: null,
          createdAt: now(),
          files: [],
          accessLog: [],
        };
        links.set(link.id, link);
        return json({ id: link.id, url: `${baseUrl}/shl/${link.id}` });
      }

      // Header-first contract: /api/manage[/files[/:fileId]] with Authorization: Bearer.
      const manage = path.match(/^\/api\/manage(?:\/files(?:\/([^/]+))?)?$/);
      if (manage) {
        const [, fileId] = manage;
        if (!bearer) return json({ error: 'Authorization header required' }, 401);
        const link = await findByAuth(bearer);
        if (!link) return json({ error: 'unknown capability' }, 404);
        const isFilesRoute = path.includes('/files');

        if (!isFilesRoute) {
          if (req.method === 'GET') return json(toManageState(link, baseUrl));
          if (req.method === 'PATCH') {
            const patch = (await req.json()) as ManagePatch;
            if (patch.labelEnc !== undefined && patch.labelEnc.length > 2048) return json({ error: 'labelEnc too long' }, 400);
            if (patch.exp !== undefined) link.exp = patch.exp;
            if (patch.maxUses !== undefined) link.maxUses = patch.maxUses;
            if (patch.active !== undefined) link.active = patch.active;
            if (patch.labelEnc !== undefined) link.label = patch.labelEnc;
            return json(toManageState(link, baseUrl));
          }
          if (req.method === 'DELETE') {
            link.active = false;
            link.purgedAt = now();
            link.files = [];
            return json({ ok: true });
          }
        } else if (fileId === undefined && req.method === 'POST') {
          if (link.flag.includes('U') && link.files.length >= 1) {
            return json({ error: 'U-flag links carry exactly one file' }, 400);
          }
          const jwe = await req.text();
          const f: MockFile = {
            fileId: randomToken(),
            contentType: req.headers.get('content-type') ?? 'application/octet-stream',
            jwe,
            createdAt: now(),
            updatedAt: now(),
          };
          link.files.push(f);
          return json({ fileId: f.fileId });
        } else if (fileId !== undefined && req.method === 'PUT') {
          const f = link.files.find((x) => x.fileId === fileId);
          if (!f) return json({ error: 'no such file' }, 404);
          f.jwe = await req.text();
          f.updatedAt = now();
          return json({ fileId: f.fileId });
        }
        return json({ error: 'method not allowed' }, 405);
      }

      const shl = path.match(/^\/shl\/([^/]+)$/);
      if (shl && req.method === 'GET') {
        const link = links.get(shl[1]!);
        const recipient = url.searchParams.get('recipient');
        if (!link || !recipient || !isLive(link)) {
          link?.accessLog.push({ ts: now(), recipient: recipient ?? '', action: 'direct', outcome: 'inactive' });
          return new Response(null, { status: 404 });
        }
        link.uses++;
        link.accessLog.push({ ts: now(), recipient, action: 'direct', outcome: 'ok' });
        return new Response(link.files[0]!.jwe, { headers: { 'content-type': 'application/jose' } });
      }

      return json({ error: 'not found' }, 404);
    },
  });
  baseUrl = `http://localhost:${server.port}`;
}

// --- Helpers --------------------------------------------------------------------------

async function runScript(script: string, args: string[]): Promise<{ out: string; err: string; code: number }> {
  const proc = Bun.spawn(['bun', script, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

let workDir: string;
let bundlePath: string;
let bundleBytes: Uint8Array;
let bundle2Path: string;
let bundle2Bytes: Uint8Array;

function makeBundle(noteText: string): string {
  return (
    JSON.stringify(
      {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: '2026-06-10T12:00:00Z',
        entry: [
          {
            fullUrl: 'urn:uuid:11111111-1111-4111-8111-111111111111',
            resource: { resourceType: 'Patient', name: [{ family: 'Tester', given: ['Casey'] }], birthDate: '1980-01-02', gender: 'other' },
          },
          {
            fullUrl: 'urn:uuid:22222222-2222-4222-8222-222222222222',
            resource: { resourceType: 'Condition', code: { text: noteText } },
          },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}

async function createLink(outName: string, extra: string[] = []): Promise<{ out: CreateShlOutput; outDir: string; raw: { out: string; err: string; code: number } }> {
  const outDir = join(workDir, outName);
  const raw = await runScript(CREATE, [
    '--bundle', bundlePath,
    '--label', 'Casey Tester — visit summary',
    '--server', baseUrl,
    '-o', outDir,
    ...extra,
  ]);
  expect(raw.code).toBe(0);
  return { out: JSON.parse(raw.out) as CreateShlOutput, outDir, raw };
}

async function fetchDataPlane(id: string): Promise<Response> {
  return fetch(`${baseUrl}/shl/${id}?recipient=${encodeURIComponent('Test Clinic')}`);
}

async function ownerSecretsFrom(outDir: string): Promise<{ m: Uint8Array; auth: string; key: string; ownerLink: string }> {
  const ownerLink = readFileSync(join(outDir, 'owner-link.txt'), 'utf8').trim();
  const parsed = parseFragment(ownerLink.slice(ownerLink.indexOf('#') + 1));
  if (parsed.mode !== 'owner') throw new Error('expected owner fragment');
  return { m: parsed.masterSecret, auth: await deriveAuth(parsed.masterSecret), key: await deriveKey(parsed.masterSecret), ownerLink };
}

beforeAll(() => {
  startMockServer();
  workDir = mkdtempSync(join(tmpdir(), 'ktc-shl-test-'));
  bundleBytes = new TextEncoder().encode(makeBundle('original content'));
  bundlePath = join(workDir, 'bundle.json');
  require('node:fs').writeFileSync(bundlePath, bundleBytes);
  bundle2Bytes = new TextEncoder().encode(makeBundle('REPLACED content — second revision'));
  bundle2Path = join(workDir, 'bundle2.json');
  require('node:fs').writeFileSync(bundle2Path, bundle2Bytes);
});

afterAll(() => {
  server?.stop(true);
  rmSync(workDir, { recursive: true, force: true });
});

// --- resolve-server -------------------------------------------------------------------

describe('_resolve-server', () => {
  test('explicit URL wins and is normalized', async () => {
    expect(await resolveServerUrl('http://example.test/')).toBe('http://example.test');
    expect(await resolveServerUrl('https://example.test/base///')).toBe('https://example.test/base');
  });

  test('unbaked config.json placeholder yields an actionable error', async () => {
    await expect(resolveServerUrl()).rejects.toThrow(/--server/);
  });

  test('rejects non-http(s) and garbage URLs', () => {
    expect(() => normalizeBaseUrl('ftp://example.test')).toThrow(/http/);
    expect(() => normalizeBaseUrl('not a url')).toThrow(/invalid/);
  });
});

// --- create-shl -----------------------------------------------------------------------

describe('create-shl', () => {
  test('full round-trip: create → data-plane GET → decrypt → byte-identical bundle', async () => {
    const { out, outDir } = await createLink('rt');

    expect(out.status).toBe('created');
    expect(Object.keys(out).sort()).toEqual(['artifacts', 'exp', 'files', 'flag', 'handoffMarkdown', 'id', 'label', 'maxUses', 'nextStep', 'status']);
    expect(out.flag).toBe('U');
    expect(out.maxUses).toBe(5);
    expect(out.label).toBe('Casey Tester — visit summary');
    expect(out.exp).toBeGreaterThan(Date.now() / 1000 + 23 * 3600);
    expect(out.files).toHaveLength(1);
    expect(out.files[0]!.contentType).toBe('application/fhir+json');
    expect(out.files[0]!.size).toBeGreaterThan(0);

    expect(out.artifacts.ownerLink.endsWith('owner-link.txt')).toBeTrue();
    expect(out.artifacts.shlink.endsWith('shlink.txt')).toBeTrue();
    expect(out.artifacts.viewerLink.endsWith('viewer-link.txt')).toBeTrue();
    expect(out.artifacts.qrPng.endsWith('qr.png')).toBeTrue();
    expect(out.artifacts.meta.endsWith('link-meta.json')).toBeTrue();
    expect(out.artifacts.handoff.endsWith('handoff.md')).toBeTrue();

    // handoffMarkdown is the verbatim closing message: owner page as a markdown link,
    // the VIEWER-PREFIXED share link as inline code (decision 11: any phone camera
    // scans it), lifetime filled in. Pasteable as-is; handoff.md = same text. The QR
    // lives on the owner page — the handoff never points at qr.png.
    const ownerLinkText = readFileSync(out.artifacts.ownerLink, 'utf8').trim();
    const viewerText = readFileSync(out.artifacts.viewerLink, 'utf8').trim();
    expect(out.handoffMarkdown).toContain(`**[Your link setup & control page](${ownerLinkText})**`);
    expect(out.handoffMarkdown).toContain(`\`${viewerText}\``);
    expect(out.handoffMarkdown).not.toContain('qr.png');
    expect(out.handoffMarkdown).toContain('5 opens');
    expect(readFileSync(out.artifacts.handoff, 'utf8')).toBe(out.handoffMarkdown);

    // nextStep restates the handoff rule in the output the agent actually reads.
    expect(out.nextStep).toContain('verbatim');
    expect(out.nextStep).toContain('QR');

    // Viewer-prefixed form (decision 11): page URL + '#' + the exact bare shlink.
    expect(viewerText).toBe(`${baseUrl}/v#${readFileSync(out.artifacts.shlink, 'utf8').trim()}`);

    // The QR encodes the viewer-prefixed share link (byte-compare against a fresh
    // render of the same string — node-qrcode PNG output is deterministic).
    const qr = readFileSync(out.artifacts.qrPng);
    expect(qr.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(qr.equals(await QRCode.toBuffer(viewerText, { errorCorrectionLevel: 'M' }))).toBeTrue();

    const meta = JSON.parse(readFileSync(out.artifacts.meta, 'utf8'));
    expect(meta.id).toBe(out.id);
    expect(meta.server).toBe(baseUrl);
    expect(JSON.stringify(meta)).not.toContain('shlink:');
    expect(JSON.stringify(meta)).not.toContain('#');

    const shlinkText = readFileSync(out.artifacts.shlink, 'utf8').trim();
    expect(shlinkText.startsWith('shlink:/')).toBeTrue();
    const payload = parseShlink(shlinkText);
    expect(payload.url).toBe(`${baseUrl}/shl/${out.id}`);
    expect(payload.url.length).toBeLessThanOrEqual(128);
    expect(payload.exp).toBe(out.exp!);
    expect(payload.flag).toBe('U');
    expect(payload.label).toBe(out.label!);

    // Privacy: the server-side copy of the label is an opaque JWE — the plaintext
    // (which names the patient) never reaches the server; only the owner can decrypt.
    const stored = [...links.values()][0]!;
    expect(stored.label).not.toContain('Casey');
    expect(stored.label!.split('.')).toHaveLength(5); // compact JWE
    const labelPlain = await decryptJWE(stored.label!, (await ownerSecretsFrom(outDir)).key);
    expect(new TextDecoder().decode(labelPlain.plaintext)).toBe(out.label!);

    const { key, ownerLink } = await ownerSecretsFrom(outDir);
    expect(payload.key).toBe(key);
    expect(ownerLink.startsWith(`${baseUrl}/m#`)).toBeTrue();

    const res = await fetchDataPlane(out.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/jose');
    const jwe = await res.text();
    const { plaintext, header } = await decryptJWE(jwe, key);
    expect(header.cty).toBe('application/fhir+json');
    // Uncompressed by default: receiver interop beats size (modern `jose` dropped JWE
    // zip support and hand-rolled SHL readers rarely inflate). --zip opts back in.
    expect(header.zip).toBeUndefined();
    expect(Buffer.from(plaintext).equals(Buffer.from(bundleBytes))).toBeTrue();
    // The interop point itself: vanilla jose must decrypt a default-created link.
    const { plaintext: viaJose } = await compactDecrypt(jwe, b64urlDecode(key));
    expect(Buffer.from(viaJose).equals(Buffer.from(bundleBytes))).toBeTrue();
  });

  test('--zip opts into JWE zip: DEF; our reader still inflates it', async () => {
    const { out, outDir } = await createLink('zip', ['--zip']);
    const { key } = await ownerSecretsFrom(outDir);
    const res = await fetchDataPlane(out.id);
    expect(res.status).toBe(200);
    const jwe = await res.text();
    const { plaintext, header } = await decryptJWE(jwe, key);
    expect(header.zip).toBe('DEF');
    expect(Buffer.from(plaintext).equals(Buffer.from(bundleBytes))).toBeTrue();
    expect(Buffer.byteLength(jwe)).toBeLessThan(bundleBytes.length); // compression actually happened
  });

  test('SECRETS: stdout carries the relay links; bare auth/key/M never appear standalone', async () => {
    const { out, outDir, raw } = await createLink('secrets');
    const { m, auth, key } = await ownerSecretsFrom(outDir);
    const ownerLink = readFileSync(join(outDir, 'owner-link.txt'), 'utf8').trim();
    const shlink = readFileSync(join(outDir, 'shlink.txt'), 'utf8').trim();

    // Relay secrets (patient deliverables): the handoff message IS the stdout payload.
    expect(out.handoffMarkdown).toContain(ownerLink);
    expect(out.handoffMarkdown).toContain(shlink);

    // Script-internal secrets: the derived auth and key never appear as standalone
    // strings anywhere (the shlink embeds the key only inside its base64url payload).
    for (const channel of [raw.out, raw.err]) {
      expect(channel).not.toContain(auth);
      expect(channel).not.toContain(key);
    }
    // The bare master secret appears ONLY embedded in the owner link, never on its own.
    const stripped = (raw.out + raw.err).replaceAll(ownerLink, '');
    expect(stripped).not.toContain(b64url(m));
  });

  test('--bare opts the QR and handoff into the raw shlink:/ form', async () => {
    const { out } = await createLink('bare', ['--bare']);
    const bareShlink = readFileSync(out.artifacts.shlink, 'utf8').trim();
    const viewerText = readFileSync(out.artifacts.viewerLink, 'utf8').trim();

    expect(out.handoffMarkdown).toContain(`\`${bareShlink}\``);
    expect(out.handoffMarkdown).not.toContain(viewerText);
    expect(out.handoffMarkdown).toContain('SHL-aware');

    const qr = readFileSync(out.artifacts.qrPng);
    expect(qr.equals(await QRCode.toBuffer(bareShlink, { errorCorrectionLevel: 'M' }))).toBeTrue();
  });

  test('--exp-hours never: payload omits exp, handoff says until-revoked, exp null end to end', async () => {
    const { out } = await createLink('never', ['--exp-hours', 'never']);
    expect(out.exp).toBeNull();
    const payload = parseShlink(readFileSync(out.artifacts.shlink, 'utf8').trim());
    expect('exp' in payload).toBeFalse();
    expect(out.handoffMarkdown).toContain('until');
    expect(out.handoffMarkdown).toContain('revoke');
    expect(out.handoffMarkdown).toContain('5 opens');
    const meta = JSON.parse(readFileSync(out.artifacts.meta, 'utf8'));
    expect(meta.exp).toBeNull();
    expect(meta.expIso).toBeNull();
    // the link serves: never-expired on the mock data plane
    expect((await fetchDataPlane(out.id)).status).toBe(200);
  });

  test('refuses to overwrite a non-empty outdir', async () => {
    const { outDir } = await createLink('no-overwrite');
    const second = await runScript(CREATE, [
      '--bundle', bundlePath,
      '--label', 'x',
      '--server', baseUrl,
      '-o', outDir,
    ]);
    expect(second.code).not.toBe(0);
    expect(second.err).toContain('not empty');
  });

  test('rejects missing bundle, overlong label, bad numbers', async () => {
    const missing = await runScript(CREATE, ['--bundle', join(workDir, 'nope.json'), '--label', 'x', '--server', baseUrl, '-o', join(workDir, 'e1')]);
    expect(missing.code).not.toBe(0);

    const longLabel = await runScript(CREATE, ['--bundle', bundlePath, '--label', 'L'.repeat(81), '--server', baseUrl, '-o', join(workDir, 'e2')]);
    expect(longLabel.code).not.toBe(0);
    expect(longLabel.err).toContain('80');

    const badHours = await runScript(CREATE, ['--bundle', bundlePath, '--label', 'x', '--exp-hours', '-1', '--server', baseUrl, '-o', join(workDir, 'e3')]);
    expect(badHours.code).not.toBe(0);
  });
});

// --- manage-shl -----------------------------------------------------------------------

describe('manage-shl', () => {
  let link: CreateShlOutput;
  let outDir: string;

  async function manage(args: string[]): Promise<{ out: string; err: string; code: number }> {
    return runScript(MANAGE, [outDir, ...args, '--server', baseUrl]);
  }

  beforeAll(async () => {
    const created = await createLink('managed', ['--exp-hours', '1']);
    link = created.out;
    outDir = created.outDir;
  });

  test('status: ManageState minus accessLog, plus ownerLink; no script-internal secrets', async () => {
    const r = await manage(['status']);
    expect(r.code).toBe(0);
    const state = JSON.parse(r.out);
    expect(state.id).toBe(link.id);
    expect(state.flag).toBe('U');
    expect(state.live).toBeTrue();
    expect(state.files).toHaveLength(1);
    expect('accessLog' in state).toBeFalse();
    expect(r.out).not.toContain('shlink:');
    // ownerLink is a relay secret — "give me my link again" works via status alone
    const ownerLinkText = readFileSync(join(outDir, 'owner-link.txt'), 'utf8').trim();
    expect(state.ownerLink).toBe(ownerLinkText);
    const { m, auth, key } = await ownerSecretsFrom(outDir);
    for (const secret of [auth, key]) expect(r.out + r.err).not.toContain(secret);
    expect((r.out + r.err).replaceAll(ownerLinkText, '')).not.toContain(b64url(m));
  });

  test('accepts the owner-link.txt file path as target too', async () => {
    const r = await runScript(MANAGE, [join(outDir, 'owner-link.txt'), 'status', '--server', baseUrl]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).id).toBe(link.id);
  });

  test('without --server, resolves the API base from the /m owner link origin', async () => {
    // No --server and no baked config.json → the owner link's origin is the fallback;
    // the /m page route must be stripped (regression: only legacy /s was).
    const r = await runScript(MANAGE, [outDir, 'status']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).id).toBe(link.id);
  });

  test('log: shows the data-plane access with recipient', async () => {
    expect((await fetchDataPlane(link.id)).status).toBe(200);
    const r = await manage(['log']);
    expect(r.code).toBe(0);
    const { id, accessLog } = JSON.parse(r.out);
    expect(id).toBe(link.id);
    expect(accessLog.length).toBeGreaterThanOrEqual(1);
    const last = accessLog[accessLog.length - 1];
    expect(last.recipient).toBe('Test Clinic');
    expect(last.action).toBe('direct');
    expect(last.outcome).toBe('ok');
  });

  test('re-arm: extends exp, grants more uses, prints the QR reminder', async () => {
    const r = await manage(['re-arm', '--exp-hours', '48', '--max-uses', '7']);
    expect(r.code).toBe(0);
    const o = JSON.parse(r.out);
    expect(o.status).toBe('re-armed');
    expect(o.exp).toBeGreaterThan(link.exp!);
    expect(o.expIso).toBe(new Date(o.exp * 1000).toISOString());
    expect(o.maxUses).toBe(o.uses + 7);
    expect(o.live).toBeTrue();
    expect(o.reminder).toContain('QR');
    expect(o.reminder.toLowerCase()).toContain('exp');
  });

  test('re-arm --exp-hours never removes the expiration', async () => {
    const r = await manage(['re-arm', '--exp-hours', 'never', '--max-uses', '3']);
    expect(r.code).toBe(0);
    const o = JSON.parse(r.out);
    expect(o.status).toBe('re-armed');
    expect(o.exp).toBeNull();
    expect(o.expIso).toBeNull();
    expect(o.live).toBeTrue();
  });

  test('pause: data plane 404s; resume: serving again', async () => {
    const p = await manage(['pause']);
    expect(p.code).toBe(0);
    expect(JSON.parse(p.out)).toMatchObject({ status: 'paused', active: false, live: false });
    expect((await fetchDataPlane(link.id)).status).toBe(404);

    const r = await manage(['resume']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ status: 'resumed', active: true, live: true });
    expect((await fetchDataPlane(link.id)).status).toBe(200);
  });

  test('relabel: updates label; rejects >80 chars', async () => {
    const r = await manage(['relabel', 'Casey Tester — updated label']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ status: 'relabeled', label: 'Casey Tester — updated label' });

    const tooLong = await manage(['relabel', 'L'.repeat(81)]);
    expect(tooLong.code).not.toBe(0);
    expect(tooLong.err).toContain('80');
  });

  test('replace: re-encrypts new bundle in place; round-trips byte-identically', async () => {
    const r = await manage(['replace', '--bundle', bundle2Path]);
    expect(r.code).toBe(0);
    const o = JSON.parse(r.out);
    expect(o.status).toBe('replaced');
    expect(o.fileId).toBeString();

    const res = await fetchDataPlane(link.id);
    expect(res.status).toBe(200);
    const { key } = await ownerSecretsFrom(outDir);
    const { plaintext } = await decryptJWE(await res.text(), key);
    expect(Buffer.from(plaintext).equals(Buffer.from(bundle2Bytes))).toBeTrue();
    expect(Buffer.from(plaintext).equals(Buffer.from(bundleBytes))).toBeFalse();
  });

  test('destroy: refuses without --yes, then purges; data plane 404s', async () => {
    const refused = await manage(['destroy']);
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain('--yes');
    expect((await fetchDataPlane(link.id)).status).toBe(200);

    const r = await manage(['destroy', '--yes']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ status: 'destroyed', id: link.id });
    expect((await fetchDataPlane(link.id)).status).toBe(404);

    const status = await manage(['status']);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.out)).toMatchObject({ live: false, active: false });
  });

  test('unknown verb and bad target fail with usage', async () => {
    const bad = await manage(['frobnicate']);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain('Usage');

    const noTarget = await runScript(MANAGE, [join(workDir, 'missing-dir'), 'status', '--server', baseUrl]);
    expect(noTarget.code).not.toBe(0);
  });
});
