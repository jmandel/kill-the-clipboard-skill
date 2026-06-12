// Pure page logic: fragment → mode routing, status derivation, payload/QR rebuild,
// re-arm patch construction. No DOM — everything here is unit-testable headlessly.

import { deriveAuth, deriveKey } from '../../../lib/hkdf.ts';
import { decryptJWE, encryptJWE } from '../../../lib/jwe.ts';
import {
  buildShlink,
  buildViewerLink,
  parseFragment,
  type ShlinkPayload,
} from '../../../lib/shlink.ts';
import type { ManagePatch, ManageState } from '../../../lib/types.ts';

// --- Routing --------------------------------------------------------------------------

export type Route =
  | { mode: 'owner'; masterSecret: Uint8Array; api: string | null }
  | { mode: 'viewer'; payload: ShlinkPayload }
  | { mode: 'none' }
  | { mode: 'invalid'; reason: string };

/** Accepts location.hash verbatim (leading '#' or not, possibly empty). */
export function routeFragment(rawHash: string): Route {
  const frag = rawHash.replace(/^#/, '');
  if (frag === '') return { mode: 'none' };
  try {
    const parsed = parseFragment(frag);
    if (parsed.mode === 'owner') {
      return { mode: 'owner', masterSecret: parsed.masterSecret, api: parsed.api ?? null };
    }
    return { mode: 'viewer', payload: parsed.payload };
  } catch (e) {
    return { mode: 'invalid', reason: e instanceof Error ? e.message : String(e) };
  }
}

// --- Status derivation (docs/DESIGN.md §4: liveness is derived, never stored) --------------

export type LinkStatus = 'live' | 'paused' | 'expired' | 'exhausted' | 'destroyed';

export function deriveStatus(
  s: Pick<ManageState, 'active' | 'exp' | 'maxUses' | 'uses' | 'purgedAt'>,
  nowSec: number = Math.floor(Date.now() / 1000),
): LinkStatus {
  if (s.purgedAt !== null) return 'destroyed';
  if (!s.active) return 'paused';
  if (s.exp !== null && nowSec >= s.exp) return 'expired';
  if (s.maxUses !== null && s.uses >= s.maxUses) return 'exhausted';
  return 'live';
}

export const STATUS_TEXT: Record<LinkStatus, { title: string; detail: string }> = {
  live: { title: 'Live', detail: 'This link is active and can be scanned right now.' },
  paused: { title: 'Paused', detail: 'Sharing is paused. Resume to make the link work again.' },
  expired: { title: 'Expired', detail: 'The expiration time has passed. Re-arm to share again.' },
  exhausted: {
    title: 'Used up',
    detail: 'The link has reached its use limit. Re-arm to allow more uses.',
  },
  destroyed: {
    title: 'Destroyed',
    detail: 'This link was permanently destroyed and its data purged. It cannot be revived.',
  },
};

// --- Payload / QR reconstruction (docs/DESIGN.md §3: always rebuilt, never stored) ----------

export async function authForSecret(masterSecret: Uint8Array): Promise<string> {
  return deriveAuth(masterSecret);
}

export async function rebuildPayload(
  masterSecret: Uint8Array,
  state: Pick<ManageState, 'url' | 'exp' | 'flag'>,
  label: string | null,
): Promise<ShlinkPayload> {
  const key = await deriveKey(masterSecret);
  return {
    url: state.url,
    key,
    // Never-expiring links omit exp per the base SHL spec (it's a staleness hint)
    ...(state.exp !== null ? { exp: state.exp } : {}),
    flag: state.flag,
    ...(label != null && label !== '' ? { label } : {}),
  };
}

// The server stores the label only as a client-encrypted JWE (it typically names the
// patient); the owner page is the one place it gets decrypted. The shlink payload's
// plaintext label (spec-required, for receivers) is a separate, client-built copy.
export async function decryptLabel(masterSecret: Uint8Array, labelEnc: string | null): Promise<string | null> {
  if (!labelEnc) return null;
  try {
    const key = await deriveKey(masterSecret);
    const { plaintext } = await decryptJWE(labelEnc, key);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null; // unreadable blob: show nothing rather than garbage
  }
}

export async function encryptLabel(masterSecret: Uint8Array, label: string): Promise<string> {
  const key = await deriveKey(masterSecret);
  return encryptJWE(new TextEncoder().encode(label), key, { cty: 'text/plain' });
}

export function payloadToShlink(payload: ShlinkPayload): string {
  return buildShlink(payload);
}

/** View-only copy: the standard viewer-prefixed link to this same page. */
export function viewerLinkFor(pageOrigin: string, payload: ShlinkPayload): string {
  return buildViewerLink(pageOrigin, buildShlink(payload));
}

/**
 * Why a link would STILL be down after resuming — pause masks expiry/exhaustion in
 * deriveStatus, and a resume that doesn't restore service reads as "resume is broken"
 * (the data plane's privacy-preserving 404 can't say why). Field-tested failure mode.
 */
export function blockedBeyondPause(
  s: Pick<ManageState, 'exp' | 'maxUses' | 'uses'>,
  nowSec: number = Math.floor(Date.now() / 1000),
): 'expired' | 'exhausted' | null {
  if (s.exp !== null && nowSec >= s.exp) return 'expired';
  if (s.maxUses !== null && s.uses >= s.maxUses) return 'exhausted';
  return null;
}

// --- Re-arm ----------------------------------------------------------------------------

export const DEFAULT_REARM_HOURS = 24;
export const DEFAULT_USE_ALLOWANCE = 5;

// ManagePatch has no `uses` reset, so un-exhausting means raising maxUses: the new cap is
// current uses + a fresh allowance. Harmless if the server also resets uses (cap is a max).
// hours: null = remove the expiration entirely (never expires).
export function rearmPatch(
  state: Pick<ManageState, 'uses' | 'maxUses'>,
  hours: number | null = DEFAULT_REARM_HOURS,
  allowance: number | null = DEFAULT_USE_ALLOWANCE,
  nowSec: number = Math.floor(Date.now() / 1000),
): ManagePatch {
  return {
    exp: hours === null ? null : nowSec + Math.round(hours * 3600),
    maxUses: allowance === null ? null : state.uses + allowance,
  };
}

// --- Display helpers --------------------------------------------------------------------

export function formatCountdown(exp: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const delta = exp - nowSec;
  if (delta <= 0) return 'expired';
  const d = Math.floor(delta / 86400);
  const h = Math.floor((delta % 86400) / 3600);
  const m = Math.floor((delta % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return 'under a minute';
}

export function formatExp(exp: number): string {
  return new Date(exp * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function usesText(uses: number, maxUses: number | null): string {
  return maxUses === null ? `${uses} (no limit)` : `${uses} of ${maxUses}`;
}
