#!/usr/bin/env bun
// Dev harness: serves the handoff page with a MOCK in-memory /api/manage so the page is
// manually testable without the real server. Seeds one link per status (live, expired,
// exhausted, paused, destroyed) and prints test URLs.
//
// Printing these links is fine ONLY because they are throwaway secrets for in-memory mock
// data that dies with this process — never do this with real links (CLAUDE.md).
//
// Usage: bun run app/src/dev.ts [--port 4801]

import indexHtml from '../index.html';
import { b64url } from '../../lib/encoding.ts';
import { deriveAuth, deriveKey, generateMasterSecret } from '../../lib/hkdf.ts';
import { buildOwnerLink, buildShlink, buildViewerLink } from '../../lib/shlink.ts';
import type { AccessEntry, ManagePatch, ManageState } from '../../lib/types.ts';

const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 4801);
const nowSec = () => Math.floor(Date.now() / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();

const store = new Map<string, ManageState>();

function computeLive(s: ManageState): boolean {
  return (
    s.active &&
    (s.exp === null || nowSec() < s.exp) &&
    (s.maxUses === null || s.uses < s.maxUses) &&
    s.purgedAt === null
  );
}

function sampleLog(n: number): AccessEntry[] {
  const outcomes: AccessEntry['outcome'][] = ['ok', 'ok', 'inactive'];
  return Array.from({ length: n }, (_, i) => ({
    ts: iso(nowSec() - (i + 1) * 3700),
    recipient: i % 2 === 0 ? 'Dr. Rivera — General Hospital' : 'Front desk check-in kiosk',
    action: 'direct',
    outcome: outcomes[i % outcomes.length]!,
  }));
}

interface Seed {
  name: string;
  tweak: (s: ManageState) => void;
}

const seeds: Seed[] = [
  { name: 'live', tweak: () => {} },
  { name: 'expired', tweak: (s) => { s.exp = nowSec() - 3600; } },
  { name: 'exhausted', tweak: (s) => { s.uses = s.maxUses ?? 5; } },
  { name: 'paused', tweak: (s) => { s.active = false; } },
  { name: 'destroyed', tweak: (s) => { s.active = false; s.purgedAt = iso(nowSec() - 60); s.files = []; } },
];

// --- mock data plane: a real encrypted bundle so the viewer's content view works ---
import { encryptJWE } from '../../lib/jwe.ts';

const TINY_PDF = `JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+`;

const MOCK_BUNDLE = {
  resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(),
  entry: [
    { fullUrl: 'urn:uuid:p1', resource: { resourceType: 'Patient', id: 'p1', name: [{ text: 'Casey Tester' }], birthDate: '1980-02-29', gender: 'female' } },
    { fullUrl: 'urn:uuid:c1', resource: { resourceType: 'Condition', id: 'c1', code: { text: 'Post-concussion syndrome' }, clinicalStatus: { coding: [{ code: 'active', display: 'Active' }] }, onsetDateTime: '2024-05-01' } },
    { fullUrl: 'urn:uuid:c2', resource: { resourceType: 'Condition', id: 'c2', code: { text: 'Migraine without aura' }, clinicalStatus: { coding: [{ display: 'Active' }] }, onsetDateTime: '2015-06-01' } },
    { fullUrl: 'urn:uuid:m1', resource: { resourceType: 'MedicationRequest', id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Nortriptyline 10 mg capsule' }, dosageInstruction: [{ text: '1 capsule nightly' }], authoredOn: '2026-03-02' } },
    { fullUrl: 'urn:uuid:a1', resource: { resourceType: 'AllergyIntolerance', id: 'a1', code: { text: 'Penicillin' }, criticality: 'high', reaction: [{ manifestation: [{ text: 'Anaphylaxis' }] }] } },
    { fullUrl: 'urn:uuid:o1', resource: { resourceType: 'Observation', id: 'o1', code: { text: 'Blood pressure' }, component: [{ code: { text: 'Systolic' }, valueQuantity: { value: 118, unit: 'mmHg' } }, { code: { text: 'Diastolic' }, valueQuantity: { value: 76, unit: 'mmHg' } }], effectiveDateTime: '2026-06-01' } },
    { fullUrl: 'urn:uuid:d1', resource: { resourceType: 'DocumentReference', id: 'd1', status: 'current', type: { text: 'Patient Story' }, date: new Date().toISOString(), content: [{ attachment: { contentType: 'application/pdf', data: TINY_PDF } }] } },
    { fullUrl: 'urn:uuid:d2', resource: { resourceType: 'DocumentReference', id: 'd2', status: 'current', type: { text: 'MRI Brain — report' }, date: '2020-07-14', content: [{ attachment: { contentType: 'text/plain', data: btoa('IMPRESSION: No acute intracranial abnormality.') } }] } },
  ],
};

const jweById = new Map<string, string>();

const base = `http://localhost:${port}`;
const lines: string[] = [];

for (const seed of seeds) {
  const m = generateMasterSecret();
  const auth = await deriveAuth(m);
  const key = await deriveKey(m);
  const id = b64url(crypto.getRandomValues(new Uint8Array(32)));
  jweById.set(id, await encryptJWE(new TextEncoder().encode(JSON.stringify(MOCK_BUNDLE)), key, { cty: 'application/fhir+json', deflate: true }));
  const plainLabel = `Casey Tester — mock ${seed.name} link`;
  const state: ManageState = {
    id,
    url: `${base}/shl/${id}`,
    flag: 'U',
    labelEnc: await encryptJWE(new TextEncoder().encode(plainLabel), key, { cty: 'text/plain' }),
    exp: nowSec() + 24 * 3600,
    maxUses: 5,
    uses: 2,
    active: true,
    live: true,
    purgedAt: null,
    passcodeAttemptsRemaining: null,
    createdAt: iso(nowSec() - 7200),
    files: [{ fileId: 'f1', contentType: 'application/jose', size: 48211, lastUpdated: iso(nowSec() - 7200) }],
    accessLog: sampleLog(seed.name === 'destroyed' ? 4 : 2),
  };
  seed.tweak(state);
  state.live = computeLive(state);
  store.set(auth, state);

  lines.push(`  ${seed.name.padEnd(10)} owner:  ${buildOwnerLink(base, m)}`);
  if (seed.name === 'live') {
    const shlink = buildShlink({ url: state.url, key, ...(state.exp !== null ? { exp: state.exp } : {}), flag: state.flag, label: plainLabel });
    lines.push(`  ${''.padEnd(10)} viewer: ${buildViewerLink(base, shlink)}`);
  }
}

// Data-plane only, matching production: the control plane is same-origin (no CORS).
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bearerOf(req: Request): string {
  return req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
}

function withState(auth: string, fn: (s: ManageState) => Response): Response {
  const s = store.get(auth);
  if (!s) return json({ error: 'no such link' }, 404);
  return fn(s);
}

// Signal-only change feed, mirroring the real server's /api/manage/events.
const watchers = new Map<string, Set<() => void>>();
function notifyWatchers(linkId: string): void {
  for (const fn of watchers.get(linkId) ?? []) fn();
}
function eventStream(linkId: string, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let cleanup = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const send = (s: string): void => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const onChange = () => send('event: change\ndata: {}\n\n');
      const set = watchers.get(linkId) ?? new Set<() => void>();
      set.add(onChange);
      watchers.set(linkId, set);
      const ping = setInterval(() => send(': ping\n\n'), 25_000);
      cleanup = () => {
        clearInterval(ping);
        set.delete(onChange);
        if (set.size === 0) watchers.delete(linkId);
        try {
          controller.close();
        } catch {}
      };
      signal.addEventListener('abort', () => cleanup());
      send('retry: 3000\n\n');
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}


Bun.serve({
  port,
  routes: {
    '/': () => Response.redirect('/m', 302),
    '/s': indexHtml,
    '/m': indexHtml,
    '/v': indexHtml,
    '/shl/:id': (req) => {
      const url = new URL(req.url);
      if (!url.searchParams.get('recipient')) {
        return new Response(JSON.stringify({ error: 'recipient required' }), {
          status: 400,
          headers: { 'content-type': 'application/json', ...CORS },
        });
      }
      const s = [...store.values()].find((x) => x.url.endsWith(`/shl/${req.params.id}`));
      if (!s || !computeLive(s)) return new Response(null, { status: 404, headers: CORS });
      s.uses += 1;
      s.accessLog.unshift({ ts: iso(nowSec()), recipient: url.searchParams.get('recipient')!, action: 'direct', outcome: 'ok' });
      notifyWatchers(s.id);
      return new Response(jweById.get(req.params.id) ?? '', { status: 200, headers: { 'content-type': 'application/jose', ...CORS } });
    },
    '/api/manage/events': {
      GET: (req) => {
        const s = store.get(bearerOf(req));
        if (!s) return json({ error: 'no such link' }, 404);
        return eventStream(s.id, req.signal);
      },
    },
    '/api/manage': {
      GET: (req) =>
        withState(bearerOf(req), (s) => {
          s.live = computeLive(s);
          return json(s);
        }),
      PATCH: async (req) => {
        const s = store.get(bearerOf(req));
        if (!s) return json({ error: 'no such link' }, 404);
        if (s.purgedAt !== null) return json({ error: 'link destroyed' }, 410);
        const patch = (await req.json()) as ManagePatch;
        if (patch.exp !== undefined) s.exp = patch.exp;
        if (patch.maxUses !== undefined) s.maxUses = patch.maxUses;
        if (patch.active !== undefined) s.active = patch.active;
        if (patch.labelEnc !== undefined) s.labelEnc = patch.labelEnc;
        s.live = computeLive(s);
        notifyWatchers(s.id);
        return json(s);
      },
      DELETE: (req) =>
        withState(bearerOf(req), (s) => {
          s.active = false;
          s.purgedAt = iso(nowSec());
          s.files = [];
          s.live = false;
          notifyWatchers(s.id);
          return json(s);
        }),
    },
  },
  development: true,
});

console.log(`mock handoff dev server on ${base}\n\nTest URLs (mock-only secrets):\n${lines.join('\n')}\n`);
