// Fetch and decrypt an SHL in the browser — both flows the backend supports:
//   U-flag: GET payload.url?recipient=...            -> one JWE
//   manifest: POST payload.url {recipient, passcode?} -> {files:[{contentType,
//             location|embedded}]}, fetch + decrypt each
// A fetch is a REAL access — it consumes a use and appears in the owner's log.

import { decryptJWE } from '../../../lib/jwe.ts';
import type { ShlinkPayload } from '../../../lib/shlink.ts';

export interface FhirResource {
  resourceType: string;
  id?: string;
  [k: string]: unknown;
}

export interface FhirBundle extends FhirResource {
  resourceType: 'Bundle';
  entry?: { fullUrl?: string; resource?: FhirResource }[];
}

export class PasscodeRequiredError extends Error {
  constructor(public remainingAttempts: number | null, wrongGuess: boolean) {
    super(
      wrongGuess
        ? `That passcode wasn't accepted${remainingAttempts !== null ? ` (${remainingAttempts} attempts left before the link locks)` : ''}.`
        : 'This link is protected by a passcode.',
    );
  }
}

async function decryptToBundle(jwe: string, key: string): Promise<FhirBundle | null> {
  const { plaintext, header } = await decryptJWE(jwe, key);
  const cty = typeof header.cty === 'string' ? header.cty : 'application/fhir+json';
  if (!cty.startsWith('application/fhir+json')) return null; // SHCs etc. — not rendered here
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as FhirBundle;
  return parsed.resourceType === 'Bundle' ? parsed : { resourceType: 'Bundle', entry: [{ resource: parsed }] };
}

/** Returns every FHIR bundle the link carries (U-flag links carry exactly one). */
export async function fetchShlBundles(
  payload: ShlinkPayload,
  recipient: string,
  passcode?: string,
): Promise<FhirBundle[]> {
  const flags = payload.flag ?? '';

  if (flags.includes('U')) {
    const url = new URL(payload.url);
    url.searchParams.set('recipient', recipient);
    const res = await fetch(url);
    if (res.status === 404) throw new Error('The link is no longer available — it may have expired, hit its use limit, or been revoked.');
    if (!res.ok) throw new Error(`Fetch failed (HTTP ${res.status})`);
    const bundle = await decryptToBundle(await res.text(), payload.key);
    return bundle ? [bundle] : [];
  }

  if (flags.includes('P') && !passcode) throw new PasscodeRequiredError(null, false);

  const res = await fetch(payload.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient, ...(passcode ? { passcode } : {}) }),
  });
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { remainingAttempts?: number };
    throw new PasscodeRequiredError(body.remainingAttempts ?? null, Boolean(passcode));
  }
  if (res.status === 404) throw new Error('The link is no longer available — it may have expired, hit its use limit, or been revoked.');
  if (!res.ok) throw new Error(`Manifest request failed (HTTP ${res.status})`);

  const manifest = (await res.json()) as { files?: { contentType?: string; location?: string; embedded?: string }[] };
  const bundles: FhirBundle[] = [];
  for (const f of manifest.files ?? []) {
    const jwe = f.embedded ?? (f.location ? await (await fetch(f.location)).text() : null);
    if (!jwe) continue;
    const bundle = await decryptToBundle(jwe, payload.key);
    if (bundle) bundles.push(bundle);
  }
  return bundles;
}

export function b64ToBlobUrl(b64: string, contentType: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}
