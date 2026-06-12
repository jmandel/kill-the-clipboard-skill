-- kill-the-clipboard server schema (DESIGN.md §4).
-- Liveness is DERIVED, never stored:
--   live = active AND (exp IS NULL OR now < exp) AND (max_uses IS NULL OR uses < max_uses)
--          AND (passcode_attempts_remaining IS NULL OR passcode_attempts_remaining > 0)
--          AND purged_at IS NULL
-- Any false → data plane responds 404 (spec).

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,                  -- 43-char base64url entropy; public data-plane path segment
  mgmt_token_hash TEXT NOT NULL UNIQUE, -- sha256(auth) hex; auth itself never stored
  flag TEXT NOT NULL DEFAULT 'U',
  label_enc TEXT,             -- label as a client-encrypted JWE; server-opaque (NULL = none)
  exp INTEGER,                          -- epoch seconds; NULL = never expires (symmetric with max_uses)
  max_uses INTEGER,                     -- NULL = unlimited
  uses INTEGER NOT NULL DEFAULT 0,
  passcode_hash TEXT,                   -- Bun.password (argon2id); NULL unless P flag
  passcode_attempts_remaining INTEGER,  -- lifetime budget; decremented in a transaction
  active INTEGER NOT NULL DEFAULT 1,    -- PATCH {active:false} = reversible pause
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  purged_at INTEGER                     -- set by sweeper when ciphertext deleted; tombstone remains
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  ciphertext BLOB,                      -- NULLed by retention sweeper at purge
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_link ON files(link_id);

-- Server-local state (e.g. the HMAC ticket-signing secret persisted across restarts).
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS accesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('direct','manifest','file')),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','bad-passcode','inactive'))
);
CREATE INDEX IF NOT EXISTS idx_accesses_link ON accesses(link_id, ts);
