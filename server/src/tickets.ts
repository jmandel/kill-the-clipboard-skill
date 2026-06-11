// Stateless location-URL tickets (DESIGN.md §4): HMAC-SHA256(serverSecret, linkId|fileId|exp).
// No server-side ticket state — the secret lives in the kv table, so tickets survive restarts.
// TTL well under the spec's 1-hour cap on manifest location URLs.

import { b64url, b64urlDecode, utf8 } from '../../lib/encoding.ts';
import { epoch } from './db.ts';

export const TICKET_TTL_SECONDS = 300;

export class Ticketer {
  #key: Promise<CryptoKey>;

  constructor(secret: Uint8Array) {
    this.#key = crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
  }

  async issue(linkId: string, fileId: string, ttlSeconds = TICKET_TTL_SECONDS, now = epoch()): Promise<string> {
    const exp = now + ttlSeconds;
    const mac = await crypto.subtle.sign('HMAC', await this.#key, utf8(`${linkId}|${fileId}|${exp}`) as BufferSource);
    return `${exp}.${b64url(new Uint8Array(mac))}`;
  }

  async verify(ticket: string, linkId: string, fileId: string, now = epoch()): Promise<boolean> {
    const dot = ticket.indexOf('.');
    if (dot < 1) return false;
    const exp = Number(ticket.slice(0, dot));
    if (!Number.isSafeInteger(exp) || exp <= now) return false;
    let mac: Uint8Array;
    try {
      mac = b64urlDecode(ticket.slice(dot + 1));
    } catch {
      return false;
    }
    // crypto.subtle.verify is constant-time; never compare MACs with ===
    return crypto.subtle.verify('HMAC', await this.#key, mac as BufferSource, utf8(`${linkId}|${fileId}|${exp}`) as BufferSource);
  }
}
