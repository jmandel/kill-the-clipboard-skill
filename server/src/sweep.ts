// Retention sweeper (docs/DESIGN.md §4, decision 14): ciphertext is purged purgeAfterDays after
// the link's exp; the link row + audit log remain as an honest tombstone (purged_at set).
// Re-arm works until purge; after purge the owner must re-upload (which clears the tombstone).
// Never-expiring links (exp NULL) are exempt: they hold ciphertext until destroyed — that
// is their point; the patient's destroy is the retention event.

import type { Database } from 'bun:sqlite';
import { epoch } from './db.ts';

export function sweep(db: Database, purgeAfterDays: number, now = epoch()): number {
  const cutoff = now - purgeAfterDays * 86_400;
  const run = db.transaction(() => {
    const rows = db
      .query('SELECT id FROM links WHERE purged_at IS NULL AND exp IS NOT NULL AND exp < ?')
      .all(cutoff) as { id: string }[];
    for (const { id } of rows) {
      db.query('UPDATE files SET ciphertext = NULL, updated_at = ? WHERE link_id = ?').run(now, id);
      db.query('UPDATE links SET purged_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    }
    return rows.length;
  });
  return run();
}

export function startSweeper(db: Database, purgeAfterDays: number, intervalMs = 3_600_000): ReturnType<typeof setInterval> {
  sweep(db, purgeAfterDays);
  const timer = setInterval(() => sweep(db, purgeAfterDays), intervalMs);
  timer.unref?.();
  return timer;
}
