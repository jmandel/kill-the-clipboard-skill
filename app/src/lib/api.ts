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
}
