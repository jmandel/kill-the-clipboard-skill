// Control-plane client (docs/DESIGN.md §4). Same-origin by default; &api= fragment param
// overrides. The auth capability rides in the Authorization header — never the URL
// path (proxies and access logs retain paths) and never in error text.

import type { ApiError, ManagePatch, ManageState } from '../../../lib/types.ts';

export class ManageApi {
  private base: string;

  constructor(base: string | null) {
    this.base = (base ?? '').replace(/\/$/, '');
  }

  private url(): string {
    return `${this.base}/api/manage`;
  }

  private headers(auth: string, json = false): Record<string, string> {
    return { authorization: `Bearer ${auth}`, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let message = `request failed (${res.status})`;
      try {
        const body = (await res.json()) as ApiError;
        if (body?.error) message = body.error;
      } catch {}
      if (res.status === 404) message = 'Link not found — it may have been destroyed, or this owner link is stale.';
      throw new Error(message);
    }
    return (await res.json()) as T;
  }

  async get(auth: string): Promise<ManageState> {
    return this.parse<ManageState>(await fetch(this.url(), { headers: this.headers(auth) }));
  }

  async patch(auth: string, patch: ManagePatch): Promise<ManageState> {
    await this.parse<unknown>(
      await fetch(this.url(), {
        method: 'PATCH',
        headers: this.headers(auth, true),
        body: JSON.stringify(patch),
      }),
    );
    return this.get(auth);
  }

  async destroy(auth: string): Promise<ManageState> {
    await this.parse<unknown>(await fetch(this.url(), { method: 'DELETE', headers: this.headers(auth) }));
    return this.get(auth);
  }

  /**
   * Signal-only change feed: the server emits an empty `change` event whenever the
   * link's state or access log moves; the caller re-fetches via get(). Implemented
   * as fetch-streaming SSE because native EventSource can't carry the Authorization
   * header (and the capability never goes in a URL). Returns an unsubscribe fn;
   * reconnects with a flat 3s backoff until unsubscribed.
   */
  subscribe(auth: string, onChange: () => void): () => void {
    const ctrl = new AbortController();
    const loop = async (): Promise<void> => {
      while (!ctrl.signal.aborted) {
        try {
          const res = await fetch(`${this.base}/api/manage/events`, {
            headers: { ...this.headers(auth), accept: 'text/event-stream' },
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`events stream failed (${res.status})`);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              if (/^event: change$/m.test(frame)) onChange();
            }
          }
        } catch {
          // dropped connection or non-OK — fall through to retry
        }
        if (!ctrl.signal.aborted) await new Promise((r) => setTimeout(r, 3000));
      }
    };
    void loop();
    return () => ctrl.abort();
  }
}
