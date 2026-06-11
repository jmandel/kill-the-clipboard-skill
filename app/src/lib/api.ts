// Control-plane client (docs/DESIGN.md §4). Same-origin by default; &api= fragment param
// overrides. The auth capability rides in the path, never in logs or error text.

import type { ApiError, ManagePatch, ManageState } from '../../../lib/types.ts';

export class ManageApi {
  private base: string;

  constructor(base: string | null) {
    this.base = (base ?? '').replace(/\/$/, '');
  }

  private url(auth: string): string {
    return `${this.base}/api/manage/${auth}`;
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
    return this.parse<ManageState>(await fetch(this.url(auth)));
  }

  async patch(auth: string, patch: ManagePatch): Promise<ManageState> {
    await this.parse<unknown>(
      await fetch(this.url(auth), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    );
    return this.get(auth);
  }

  async destroy(auth: string): Promise<ManageState> {
    await this.parse<unknown>(await fetch(this.url(auth), { method: 'DELETE' }));
    return this.get(auth);
  }
}
