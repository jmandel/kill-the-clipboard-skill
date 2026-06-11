// Shared HTTP plumbing for the SHL scripts (create-shl.ts, manage-shl.ts).
//
// Server URL precedence: explicit --server argument > config.json `baseUrl` next to this
// script ({{BASE_URL}} is baked in by the server's zip builder) > error.

import { join } from 'node:path';

export async function resolveServerUrl(cliArg?: string): Promise<string> {
  if (cliArg) return normalizeBaseUrl(cliArg);
  const file = Bun.file(join(import.meta.dir, 'config.json'));
  if (await file.exists()) {
    const cfg = (await file.json().catch(() => null)) as { baseUrl?: string } | null;
    const baseUrl = cfg?.baseUrl;
    if (typeof baseUrl === 'string' && baseUrl.length > 0 && !baseUrl.includes('{{')) {
      return normalizeBaseUrl(baseUrl);
    }
  }
  throw new Error(
    'no server URL configured: pass --server <url>, or use a skill zip built by the server (which bakes baseUrl into config.json)',
  );
}

export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid server URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`server URL must be http(s): ${raw}`);
  }
  return raw.replace(/\/+$/, '');
}

/** Repo convention: retry 5x with exponential backoff on HTTP >=500 / 429 only. */
export async function fetchRetry(url: string, init?: RequestInit, attempts = 5): Promise<Response> {
  let delayMs = 300;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || attempt >= attempts) return res;
    await Bun.sleep(delayMs);
    delayMs *= 2;
  }
}

/**
 * Throw an actionable error on non-2xx. `what` must be a redacted route label
 * (e.g. "PATCH /api/manage/{auth}") — never a real URL: manage URLs embed the
 * auth capability, which must not reach error messages or logs.
 */
export async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: string }).error ?? '';
  } catch {
    /* non-JSON error body */
  }
  throw new Error(`${what} failed (HTTP ${res.status}${detail ? `: ${detail}` : ''})`);
}
