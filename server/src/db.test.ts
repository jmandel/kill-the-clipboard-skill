// Storage-layer tests: the exp-nullable migration (2026-06-12) and never-expires
// liveness. The migration must carry a real pre-migration database forward without
// losing a row — production was NOT wiped for this change.

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeUse, epoch, isLive, openDb, type LinkRow } from './db.ts';
import { sweep } from './sweep.ts';

// The links DDL exactly as it shipped BEFORE exp became nullable.
const OLD_SCHEMA = `
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  mgmt_token_hash TEXT NOT NULL UNIQUE,
  flag TEXT NOT NULL DEFAULT 'U',
  label_enc TEXT,
  exp INTEGER NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  passcode_hash TEXT,
  passcode_attempts_remaining INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  purged_at INTEGER
);
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  ciphertext BLOB,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_files_link ON files(link_id);
CREATE TABLE accesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('direct','manifest','file')),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','bad-passcode','inactive'))
);
`;

describe('exp-nullable migration', () => {
  test('rebuilds an old NOT NULL database in place, preserving every row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktc-migrate-'));
    const path = join(dir, 'old.sqlite');
    try {
      const now = epoch();
      const old = new Database(path, { create: true });
      old.exec(OLD_SCHEMA);
      old.query(
        `INSERT INTO links (id, mgmt_token_hash, flag, exp, max_uses, uses, created_at, updated_at)
         VALUES ('link-1', 'hash-1', 'U', ?1, 5, 2, ?1, ?1)`,
      ).run(now + 3600);
      old.query(
        `INSERT INTO files (id, link_id, content_type, ciphertext, size, created_at, updated_at)
         VALUES ('file-1', 'link-1', 'application/fhir+json', X'AABB', 2, ?1, ?1)`,
      ).run(now);
      old.query(`INSERT INTO accesses (link_id, ts, recipient, action, outcome) VALUES ('link-1', ?1, 'Dr. Before', 'direct', 'ok')`).run(now);
      old.close();

      const db = openDb(path);
      const nn = db.query(`SELECT "notnull" AS nn FROM pragma_table_info('links') WHERE name = 'exp'`).get() as { nn: number };
      expect(nn.nn).toBe(0);

      const link = db.query('SELECT * FROM links WHERE id = ?').get('link-1') as LinkRow;
      expect(link.exp).toBe(now + 3600);
      expect(link.uses).toBe(2);
      expect(link.mgmt_token_hash).toBe('hash-1');
      expect((db.query('SELECT COUNT(*) AS n FROM files WHERE link_id = ?').get('link-1') as { n: number }).n).toBe(1);
      expect((db.query('SELECT recipient FROM accesses WHERE link_id = ?').get('link-1') as { recipient: string }).recipient).toBe('Dr. Before');

      // the migrated table accepts null exp, and a second open is a no-op
      db.query(`UPDATE links SET exp = NULL WHERE id = 'link-1'`).run();
      db.close();
      const again = openDb(path);
      expect((again.query('SELECT exp FROM links WHERE id = ?').get('link-1') as { exp: number | null }).exp).toBeNull();
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('never-expires (exp NULL)', () => {
  const baseLink = (over: Partial<LinkRow>): LinkRow => ({
    id: 'x', mgmt_token_hash: 'h', flag: 'U', label_enc: null, exp: null, max_uses: null,
    uses: 0, passcode_hash: null, passcode_attempts_remaining: null, active: 1,
    created_at: 0, updated_at: 0, purged_at: null, ...over,
  });

  test('isLive treats null exp as never-expiring', () => {
    expect(isLive(baseLink({}), epoch() + 100 * 365 * 86_400)).toBeTrue(); // a century out
    expect(isLive(baseLink({ active: 0 }), epoch())).toBeFalse();
    expect(isLive(baseLink({ max_uses: 1, uses: 1 }), epoch())).toBeFalse();
  });

  test('consumeUse works against a null-exp link', () => {
    const db = openDb();
    const now = epoch();
    db.query(
      `INSERT INTO links (id, mgmt_token_hash, flag, exp, max_uses, uses, created_at, updated_at)
       VALUES ('n1', 'h1', 'U', NULL, NULL, 0, ?1, ?1)`,
    ).run(now);
    expect(consumeUse(db, 'n1', now)).toBeTrue();
    db.close();
  });

  test('sweeper never purges a null-exp link, however old', () => {
    const db = openDb();
    const longAgo = epoch() - 400 * 86_400;
    db.query(
      `INSERT INTO links (id, mgmt_token_hash, flag, exp, created_at, updated_at, uses)
       VALUES ('forever', 'h2', 'U', NULL, ?1, ?1, 0)`,
    ).run(longAgo);
    db.query(
      `INSERT INTO links (id, mgmt_token_hash, flag, exp, created_at, updated_at, uses)
       VALUES ('stale', 'h3', 'U', ?1, ?1, ?1, 0)`,
    ).run(longAgo);
    expect(sweep(db, 30)).toBe(1); // only the stale finite-exp link
    expect((db.query(`SELECT purged_at FROM links WHERE id = 'forever'`).get() as { purged_at: number | null }).purged_at).toBeNull();
    expect((db.query(`SELECT purged_at FROM links WHERE id = 'stale'`).get() as { purged_at: number | null }).purged_at).not.toBeNull();
    db.close();
  });
});
