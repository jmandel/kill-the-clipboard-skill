import { describe, expect, test } from 'bun:test';
import { b64url } from '../../../lib/encoding.ts';
import { deriveAuth, deriveKey } from '../../../lib/hkdf.ts';
import { buildShlink, parseShlink } from '../../../lib/shlink.ts';
import {
  authForSecret,
  deriveStatus,
  formatCountdown,
  payloadToShlink,
  rearmPatch,
  rebuildPayload,
  routeFragment,
  usesText,
  viewerLinkFor,
} from './derive.ts';

const M = new Uint8Array(32).fill(7);
const TOKEN = b64url(M); // 43 chars

describe('fragment → mode routing', () => {
  test('43-char base64url token routes to owner mode', () => {
    const r = routeFragment(TOKEN);
    expect(r.mode).toBe('owner');
    if (r.mode !== 'owner') throw new Error('unreachable');
    expect([...r.masterSecret]).toEqual([...M]);
    expect(r.api).toBeNull();
  });

  test('leading # is tolerated', () => {
    expect(routeFragment(`#${TOKEN}`).mode).toBe('owner');
  });

  test('owner token with &api= carries cross-host API base', () => {
    const r = routeFragment(`${TOKEN}&api=${encodeURIComponent('https://other.example')}`);
    if (r.mode !== 'owner') throw new Error(`expected owner, got ${r.mode}`);
    expect(r.api).toBe('https://other.example');
  });

  test('shlink fragment routes to viewer mode', () => {
    const shlink = buildShlink({ url: 'https://s.example/shl/x', key: b64url(new Uint8Array(32)), exp: 123, flag: 'U', label: 'hi' });
    const r = routeFragment(shlink);
    if (r.mode !== 'viewer') throw new Error(`expected viewer, got ${r.mode}`);
    expect(r.payload.url).toBe('https://s.example/shl/x');
    expect(r.payload.label).toBe('hi');
  });

  test('empty fragment routes to none', () => {
    expect(routeFragment('').mode).toBe('none');
    expect(routeFragment('#').mode).toBe('none');
  });

  test('garbage routes to invalid, not a throw', () => {
    expect(routeFragment('tooshort').mode).toBe('invalid');
    expect(routeFragment('shlink:/!!!not-base64url!!!').mode).toBe('invalid');
    expect(routeFragment(`${TOKEN}XYZ`).mode).toBe('invalid');
  });
});

describe('status derivation matrix', () => {
  const base = { active: true, exp: 2000, maxUses: 5 as number | null, uses: 2, purgedAt: null as string | null };
  const now = 1000;

  test('live when active, unexpired, under limit, unpurged', () => {
    expect(deriveStatus(base, now)).toBe('live');
  });
  test('expired when now >= exp', () => {
    expect(deriveStatus({ ...base, exp: 1000 }, now)).toBe('expired');
    expect(deriveStatus({ ...base, exp: 999 }, now)).toBe('expired');
  });
  test('exhausted when uses >= maxUses', () => {
    expect(deriveStatus({ ...base, uses: 5 }, now)).toBe('exhausted');
    expect(deriveStatus({ ...base, uses: 6 }, now)).toBe('exhausted');
  });
  test('unlimited maxUses never exhausts', () => {
    expect(deriveStatus({ ...base, maxUses: null, uses: 9999 }, now)).toBe('live');
  });
  test('paused beats expired/exhausted', () => {
    expect(deriveStatus({ ...base, active: false, exp: 0, uses: 99 }, now)).toBe('paused');
  });
  test('destroyed (purged) beats everything', () => {
    expect(deriveStatus({ ...base, active: false, purgedAt: '2026-01-01T00:00:00Z', exp: 0, uses: 99 }, now)).toBe('destroyed');
  });
});

describe('payload reconstruction', () => {
  const state = { url: 'https://s.example/shl/abc', exp: 1750000000, flag: 'U', label: 'Casey — visit summary' };

  test('rebuilt payload uses the HKDF-derived key and current state', async () => {
    const payload = await rebuildPayload(M, state);
    expect(payload.key).toBe(await deriveKey(M));
    expect(payload.url).toBe(state.url);
    expect(payload.exp).toBe(state.exp);
    expect(payload.flag).toBe('U');
    expect(payload.label).toBe(state.label);
  });

  test('auth derivation matches the kernel', async () => {
    expect(await authForSecret(M)).toBe(await deriveAuth(M));
  });

  test('null label is omitted, not serialized', async () => {
    const payload = await rebuildPayload(M, { ...state, label: null });
    expect('label' in payload).toBe(false);
    expect(parseShlink(payloadToShlink(payload)).label).toBeUndefined();
  });

  test('shlink round-trips through the kernel parser', async () => {
    const payload = await rebuildPayload(M, state);
    expect(parseShlink(payloadToShlink(payload))).toEqual(payload);
  });

  test('re-arm exp update propagates into the rebuilt QR payload', async () => {
    const now = 1750000000;
    const patch = rearmPatch({ uses: 5, maxUses: 5 }, 24, 5, now);
    const rearmedState = { ...state, exp: patch.exp! };
    const payload = await rebuildPayload(M, rearmedState);
    expect(payload.exp).toBe(now + 24 * 3600);
    expect(parseShlink(payloadToShlink(payload)).exp).toBe(now + 24 * 3600);
  });

  test('viewer link is the viewer-prefixed shlink on the page origin', async () => {
    const payload = await rebuildPayload(M, state);
    const link = viewerLinkFor('https://host.example', payload);
    expect(link).toBe(`https://host.example/s#${payloadToShlink(payload)}`);
    expect(routeFragment(link.split('#')[1]!).mode).toBe('viewer');
  });
});

describe('re-arm patch construction', () => {
  const now = 1_000_000;

  test('default: exp = now + 24h, allowance of 5 fresh uses on top of current count', () => {
    const p = rearmPatch({ uses: 5, maxUses: 5 }, undefined, undefined, now);
    expect(p.exp).toBe(now + 24 * 3600);
    expect(p.maxUses).toBe(10);
  });

  test('custom hours picker value', () => {
    expect(rearmPatch({ uses: 0, maxUses: 5 }, 72, 5, now).exp).toBe(now + 72 * 3600);
  });

  test('unlimited links stay unlimited', () => {
    expect(rearmPatch({ uses: 42, maxUses: null }, 24, null, now).maxUses).toBeNull();
  });

  test('re-armed link derives back to live', () => {
    const stale = { active: true, exp: now - 10, maxUses: 5, uses: 5, purgedAt: null };
    expect(deriveStatus(stale, now)).toBe('expired');
    const p = rearmPatch(stale, 24, 5, now);
    expect(deriveStatus({ ...stale, exp: p.exp!, maxUses: p.maxUses! }, now)).toBe('live');
  });
});

describe('display helpers', () => {
  test('countdown formats', () => {
    expect(formatCountdown(1000, 2000)).toBe('expired');
    expect(formatCountdown(2000, 1000)).toBe('16m');
    expect(formatCountdown(1000 + 3 * 3600 + 600, 1000)).toBe('3h 10m');
    expect(formatCountdown(1000 + 2 * 86400 + 3 * 3600, 1000)).toBe('2d 3h');
    expect(formatCountdown(1030, 1000)).toBe('under a minute');
  });
  test('uses text', () => {
    expect(usesText(2, 5)).toBe('2 of 5');
    expect(usesText(7, null)).toBe('7 (no limit)');
  });
});
