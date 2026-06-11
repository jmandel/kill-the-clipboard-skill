// SQLite access layer. Applies the frozen schema.sql plus a small kv table (server-local
// state like the ticket-signing secret — kept out of schema.sql because it is not part of
// the link data model).
//
// Concurrency-sensitive mutations (use consumption, passcode budget) are single conditional
// UPDATE statements so parallel requests can never overshoot a budget — the spec calls out
// the parallel-passcode-guess race explicitly.

import { Database } from 'bun:sqlite';
import schemaSql from './schema.sql' with { type: 'text' };

export const epoch = (): number => Math.floor(Date.now() / 1000);
export const iso = (sec: number): string => new Date(sec * 1000).toISOString();

export interface LinkRow {
  id: string;
  mgmt_token_hash: string;
  flag: string;
  label: string | null;
  exp: number;
  max_uses: number | null;
  uses: number;
  passcode_hash: string | null;
  passcode_attempts_remaining: number | null;
  active: number;
  created_at: number;
  updated_at: number;
  purged_at: number | null;
}

export interface FileRow {
  id: string;
  link_id: string;
  content_type: string;
  ciphertext: Uint8Array | null;
  size: number;
  created_at: number;
  updated_at: number;
}

export interface FileMetaRow {
  id: string;
  content_type: string;
  size: number;
  updated_at: number;
  has_ciphertext: number;
}

export interface AccessRow {
  ts: number;
  recipient: string;
  action: string;
  outcome: string;
}

export function openDb(path = ':memory:'): Database {
  const db = new Database(path, { create: true });
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schemaSql);
  db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v BLOB NOT NULL)');
  return db;
}

/** Ticket-signing secret persisted across restarts so issued location URLs survive a deploy. */
export function getServerSecret(db: Database): Uint8Array {
  const row = db.query('SELECT v FROM kv WHERE k = ?').get('ticket-secret') as { v: Uint8Array } | null;
  if (row) return new Uint8Array(row.v);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  db.query('INSERT INTO kv (k, v) VALUES (?, ?)').run('ticket-secret', secret);
  return secret;
}

export function isLive(link: LinkRow, now: number): boolean {
  return (
    link.active === 1 &&
    now < link.exp &&
    (link.max_uses === null || link.uses < link.max_uses) &&
    (link.passcode_attempts_remaining === null || link.passcode_attempts_remaining > 0) &&
    link.purged_at === null
  );
}

export function getLinkById(db: Database, id: string): LinkRow | null {
  return db.query('SELECT * FROM links WHERE id = ?').get(id) as LinkRow | null;
}

export function getLinkByAuthHash(db: Database, hashHex: string): LinkRow | null {
  return db.query('SELECT * FROM links WHERE mgmt_token_hash = ?').get(hashHex) as LinkRow | null;
}

export function insertLink(
  db: Database,
  l: {
    id: string;
    mgmtTokenHash: string;
    flag: string;
    label: string | null;
    exp: number;
    maxUses: number | null;
    passcodeHash: string | null;
    passcodeAttemptsRemaining: number | null;
    now: number;
  },
): void {
  db.query(
    `INSERT INTO links (id, mgmt_token_hash, flag, label, exp, max_uses, uses, passcode_hash,
                        passcode_attempts_remaining, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`,
  ).run(l.id, l.mgmtTokenHash, l.flag, l.label, l.exp, l.maxUses, l.passcodeHash, l.passcodeAttemptsRemaining, l.now, l.now);
}

/**
 * Atomically re-checks liveness and increments uses; returns false if the link raced to a
 * non-live state since it was read (e.g. two parallel requests at the last remaining use).
 */
export function consumeUse(db: Database, id: string, now: number): boolean {
  const res = db
    .query(
      `UPDATE links SET uses = uses + 1, updated_at = ?2
       WHERE id = ?1 AND active = 1 AND exp > ?2
         AND (max_uses IS NULL OR uses < max_uses)
         AND (passcode_attempts_remaining IS NULL OR passcode_attempts_remaining > 0)
         AND purged_at IS NULL`,
    )
    .run(id, now);
  return res.changes === 1;
}

/**
 * Lifetime budget: never goes below 0 no matter how many guesses run in parallel.
 * Returns remaining attempts after this failure, or null if the budget was already spent
 * (caller treats that as a non-live link → 404).
 */
export function decrementPasscodeBudget(db: Database, id: string): number | null {
  const row = db
    .query(
      `UPDATE links SET passcode_attempts_remaining = passcode_attempts_remaining - 1, updated_at = ?2
       WHERE id = ?1 AND passcode_attempts_remaining > 0
       RETURNING passcode_attempts_remaining`,
    )
    .get(id, epoch()) as { passcode_attempts_remaining: number } | null;
  return row ? row.passcode_attempts_remaining : null;
}

export function audit(db: Database, linkId: string, recipient: string, action: string, outcome: string, ts: number): void {
  db.query('INSERT INTO accesses (link_id, ts, recipient, action, outcome) VALUES (?, ?, ?, ?, ?)').run(
    linkId,
    ts,
    recipient,
    action,
    outcome,
  );
}

export function listAccesses(db: Database, linkId: string): AccessRow[] {
  return db.query('SELECT ts, recipient, action, outcome FROM accesses WHERE link_id = ? ORDER BY id ASC').all(linkId) as AccessRow[];
}

export function countFiles(db: Database, linkId: string): number {
  const row = db.query('SELECT COUNT(*) AS n FROM files WHERE link_id = ?').get(linkId) as { n: number };
  return row.n;
}

export function listFileMeta(db: Database, linkId: string): FileMetaRow[] {
  return db
    .query(
      `SELECT id, content_type, size, updated_at, (ciphertext IS NOT NULL) AS has_ciphertext
       FROM files WHERE link_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(linkId) as FileMetaRow[];
}

export function listFilesWithCiphertext(db: Database, linkId: string): FileRow[] {
  return db.query('SELECT * FROM files WHERE link_id = ? AND ciphertext IS NOT NULL ORDER BY created_at ASC, id ASC').all(linkId) as FileRow[];
}

export function getFile(db: Database, linkId: string, fileId: string): FileRow | null {
  return db.query('SELECT * FROM files WHERE id = ? AND link_id = ?').get(fileId, linkId) as FileRow | null;
}

/** Fresh ciphertext clears any purge tombstone — re-upload after purge revives the link (with re-arm). */
export function insertFile(
  db: Database,
  f: { id: string; linkId: string; contentType: string; ciphertext: Uint8Array; now: number },
): void {
  const tx = db.transaction(() => {
    db.query('INSERT INTO files (id, link_id, content_type, ciphertext, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      f.id,
      f.linkId,
      f.contentType,
      f.ciphertext,
      f.ciphertext.length,
      f.now,
      f.now,
    );
    db.query('UPDATE links SET purged_at = NULL, updated_at = ? WHERE id = ?').run(f.now, f.linkId);
  });
  tx();
}

export function replaceFile(
  db: Database,
  f: { id: string; linkId: string; contentType: string; ciphertext: Uint8Array; now: number },
): void {
  const tx = db.transaction(() => {
    db.query('UPDATE files SET ciphertext = ?, size = ?, content_type = ?, updated_at = ? WHERE id = ? AND link_id = ?').run(
      f.ciphertext,
      f.ciphertext.length,
      f.contentType,
      f.now,
      f.id,
      f.linkId,
    );
    db.query('UPDATE links SET purged_at = NULL, updated_at = ? WHERE id = ?').run(f.now, f.linkId);
  });
  tx();
}

export function deleteFile(db: Database, linkId: string, fileId: string): void {
  db.query('DELETE FROM files WHERE id = ? AND link_id = ?').run(fileId, linkId);
}

export function updateLink(
  db: Database,
  id: string,
  v: {
    exp: number;
    maxUses: number | null;
    active: number;
    label: string | null;
    passcodeHash: string | null;
    passcodeAttemptsRemaining: number | null;
    now: number;
  },
): void {
  db.query(
    `UPDATE links SET exp = ?, max_uses = ?, active = ?, label = ?, passcode_hash = ?,
                      passcode_attempts_remaining = ?, updated_at = ? WHERE id = ?`,
  ).run(v.exp, v.maxUses, v.active, v.label, v.passcodeHash, v.passcodeAttemptsRemaining, v.now, id);
}

/** Owner destroy: ciphertext gone immediately, link terminally inactive; audit tombstone remains. */
export function purgeLink(db: Database, id: string, now: number): void {
  const tx = db.transaction(() => {
    db.query('UPDATE files SET ciphertext = NULL, updated_at = ? WHERE link_id = ?').run(now, id);
    db.query('UPDATE links SET active = 0, purged_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  });
  tx();
}
