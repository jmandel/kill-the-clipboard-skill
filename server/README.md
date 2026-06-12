# kill-the-clipboard server

Single-process Bun server: SHL data plane + control plane + per-request `skill.zip` builder +
the `/s` handoff page (Bun HTML import of `app/index.html`). Storage is one SQLite file.
The server only ever holds ciphertext, `sha256(auth)`, and argon2id passcode hashes — keys
and plaintext never reach it.

## Run

```sh
bun run server/src/index.ts            # or: bun run server (from repo root)
```

Config resolution: `CONFIG_PATH` env (default `./config.json`, see `config.json.example`),
then `PORT` / `BASE_URL` env override. `DB_PATH` selects the SQLite file (default
`./data.sqlite`; tests use `:memory:`). `baseURL` must be short enough that
`<baseURL>/shl/<43-char id>` stays ≤128 chars (shlink payload spec limit).

```sh
CONFIG_PATH=server/config.json PORT=8000 BASE_URL=https://shl.example.org bun run server/src/index.ts
```

For production, see `kill-the-clipboard.service` (install notes in the file header).

## Routes

### Data plane (receiver-facing; signals nothing but 404 for any non-live link)

| Route | Behavior |
|---|---|
| `GET /shl/{id}?recipient=` | U-flag direct fetch → JWE (`application/jose`). `recipient` required (400 without). Increments `uses`; audited. |
| `POST /shl/{id}` | Manifest request `{recipient, passcode?, embeddedLengthMax?}`. Bad passcode → 401 `{remainingAttempts}` (lifetime budget 5, transaction-safe; 0 = permanent lockout until the owner sets a new passcode). Files ≤ `embeddedLengthMax` are embedded; others get ticketed `location` URLs. |
| `GET /shl/{id}/f/{fileId}?t=` | Ticketed file fetch → JWE. Tickets are stateless HMACs (secret persisted in the db, 5-min TTL); bad/expired ticket → 404. |

Liveness is derived, never stored: `active && now < exp && uses < maxUses && attempts > 0 && !purged`.
Re-arm = `PATCH` flipping whichever condition failed.

### Control plane (capability in `Authorization: Bearer <auth>` — never the URL; wrong auth is always 404, never 401)

| Route | Behavior |
|---|---|
| `POST /api/links` | `CreateLinkRequest` → `{id, url}`. Validates 43-char base64url auth (header), flag (`L?P?U?`, U excludes P), `exp`, `labelEnc` ≤2048 (client-encrypted JWE; server-opaque). |
| `GET /api/manage` | Full `ManageState`: derived `live`, file metadata, complete access log. |
| `PATCH /api/manage` | `{exp?, maxUses?, active?, passcode?, labelEnc?}`. `exp: null` = never expires (symmetric with `maxUses: null`; exempt from the retention sweeper — destroy is the retention event). Setting a passcode resets the attempt budget. `active:false` = reversible pause. |
| `GET /api/manage/events` | Signal-only SSE: an empty `change` event on every access/mutation; the client re-fetches via `GET /api/manage`. Same Bearer gate and 404 behavior; the stream carries no link data. |
| `POST /api/manage/files` | Raw JWE body (≤25 MB), Content-Type header recorded → `{fileId}`. U-flag links: exactly one file. |
| `PUT /api/manage/files/{fileId}` | Replace ciphertext (client re-encrypted: same key, new IV). |
| `DELETE /api/manage/files/{fileId}` | Rejected for the last file of an active U-flag link. |
| `DELETE /api/manage` | Destroy: immediate ciphertext purge + terminal deactivation; tombstone + audit log remain. |

CORS is data-plane only (`/shl/*` — third-party SHL viewers fetch manifests and files
cross-origin). The control plane advertises none; management is same-origin by design.

### Static / bundle

- `GET /` — landing page
- `GET /s` — handoff app (503 until `app/index.html` is built)
- `GET /skill.zip` — built per request: `SKILL.md` composed by `skill/build-skill.ts`, scripts
  with `{{BASE_URL}}` baked to the configured base, the repo `lib/` kernel + fonts vendored to
  `scripts/lib/kernel/`, and a pinned `scripts/package.json` + root `bun.lock` copy.
  503 `{error}` if the skill sources are absent.

## Retention

A sweeper (startup + hourly) nulls `files.ciphertext` `purgeAfterDays` after a link's `exp`
and sets `purged_at`. The link row and audit log remain so the owner sees an honest tombstone.
Re-uploading ciphertext (POST/PUT file) clears the tombstone; combined with a `PATCH` re-arm
that makes a purged link servable again.

## Tests

```sh
bun test server/src/
```

In-memory SQLite + ephemeral ports; covers the docs/DESIGN.md §9 server matrix including the
parallel passcode-guess race and end-to-end encrypt/decrypt through `lib/jwe.ts`.
