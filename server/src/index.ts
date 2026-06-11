#!/usr/bin/env bun
// kill-the-clipboard server: SHL data plane + control plane + skill.zip + handoff page.
// Plain Bun.serve with routes (CLAUDE.md hard rule). The data plane signals nothing but 404
// for any non-live link; passcode failures are the single 401 exception (spec-shaped).

import type { Server } from 'bun';
type BunServer = Server<undefined>;
import type { Database } from 'bun:sqlite';
import { b64url, utf8Decode } from '../../lib/encoding.ts';
import { authHash } from '../../lib/hkdf.ts';
import type {
  AccessAction,
  AccessOutcome,
  AddFileResponse,
  ApiError,
  CreateLinkRequest,
  CreateLinkResponse,
  ManagePatch,
  ManageState,
  Manifest,
  ManifestFile,
  ManifestRequest,
  PasscodeError,
} from '../../lib/types.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import * as store from './db.ts';
import { epoch, iso, type LinkRow } from './db.ts';
import { startSweeper } from './sweep.ts';
import { Ticketer } from './tickets.ts';
import { buildSkillZip } from './zip.ts';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } });
const err = (message: string, status: number): Response => json({ error: message } satisfies ApiError, status);
const notFound = (): Response => err('not found', 404);
const preflight = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });
const jose = (ciphertext: Uint8Array): Response =>
  new Response(ciphertext as Uint8Array<ArrayBuffer>, {
    headers: { 'content-type': 'application/jose', ...CORS_HEADERS },
  });

const AUTH_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const FLAG_SHAPE = /^L?P?U?$/; // alphabetical order + no repeats by construction
const PASSCODE_BUDGET = 5;

const LANDING_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>kill-the-clipboard</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6;color:#1a202c}
h1{font-size:1.6rem}a{color:#2b6cb0}</style>
</head><body><main>
<h1>kill-the-clipboard</h1>
<p>An AI-agent skill and companion server for sharing your own health records the modern way:
your agent helps you pick the FHIR data that matters for a visit, writes a Patient Story PDF in
your words, renders a readable summary of every record, encrypts everything on your device, and
publishes it as a SMART Health Link QR code the front desk can scan — no clipboard required.
This server only ever stores ciphertext; keys never leave your machine.</p>
<p><a href="/skill.zip">Download the agent skill (skill.zip)</a></p>
</main></body></html>`;

function validFlag(flag: string): boolean {
  return FLAG_SHAPE.test(flag) && !(flag.includes('P') && flag.includes('U'));
}

export async function createApp(config: ServerConfig, db: Database): Promise<BunServer> {
  const ticketer = new Ticketer(store.getServerSecret(db));
  const base = () => config.server.baseURL;

  // The app unit fills app/index.html in parallel; absence must not break server boot
  let handoffApp: unknown = null;
  try {
    handoffApp = (await import('../../app/index.html')).default;
  } catch {
    handoffApp = null;
  }

  const requireLink = async (auth: string): Promise<LinkRow | null> =>
    store.getLinkByAuthHash(db, await authHash(auth));

  function manageState(link: LinkRow): ManageState {
    return {
      id: link.id,
      url: `${base()}/shl/${link.id}`,
      flag: link.flag,
      label: link.label,
      exp: link.exp,
      maxUses: link.max_uses,
      uses: link.uses,
      active: link.active === 1,
      live: store.isLive(link, epoch()),
      purgedAt: link.purged_at === null ? null : iso(link.purged_at),
      passcodeAttemptsRemaining: link.passcode_attempts_remaining,
      createdAt: iso(link.created_at),
      files: store.listFileMeta(db, link.id).map((f) => ({
        fileId: f.id,
        contentType: f.content_type,
        size: f.size,
        lastUpdated: iso(f.updated_at),
      })),
      accessLog: store.listAccesses(db, link.id).map((a) => ({
        ts: iso(a.ts),
        recipient: a.recipient,
        action: a.action as AccessAction,
        outcome: a.outcome as AccessOutcome,
      })),
    };
  }

  const server = Bun.serve({
    port: config.server.port,
    maxRequestBodySize: config.limits.maxFileBytes + 1_048_576,
    error(e) {
      return err(e instanceof Error ? e.message : 'internal error', 500);
    },
    routes: {
      '/': () => new Response(LANDING_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }),

      '/s': handoffApp
        ? (handoffApp as Response) // Bun HTMLBundle route value
        : () => err('handoff app not built yet', 503),

      '/skill.zip': async () => {
        try {
          const zip = await buildSkillZip(base());
          return new Response(zip as Uint8Array<ArrayBuffer>, {
            headers: {
              'content-type': 'application/zip',
              'content-disposition': 'attachment; filename="kill-the-clipboard-skill.zip"',
            },
          });
        } catch (e) {
          return err(`skill bundle unavailable: ${e instanceof Error ? e.message : e}`, 503);
        }
      },

      // --- Data plane -----------------------------------------------------------------

      '/shl/:id': {
        // U-flag direct fetch: ?recipient= is REQUIRED by the KTC profile
        GET: async (req) => {
          const id = req.params.id;
          const recipient = new URL(req.url).searchParams.get('recipient');
          if (!recipient) return err('recipient query parameter is required', 400);
          const link = store.getLinkById(db, id);
          if (!link) return notFound();
          const now = epoch();
          const inactive = () => {
            store.audit(db, id, recipient, 'direct', 'inactive', now);
            return notFound();
          };
          if (!link.flag.includes('U')) return inactive();
          if (!store.isLive(link, now)) return inactive();
          const file = store.listFilesWithCiphertext(db, id)[0];
          if (!file?.ciphertext) return inactive();
          if (!store.consumeUse(db, id, now)) return inactive();
          store.audit(db, id, recipient, 'direct', 'ok', now);
          return jose(file.ciphertext);
        },

        // Manifest request (non-U links; harmless on U links too)
        POST: async (req) => {
          const id = req.params.id;
          let body: ManifestRequest;
          try {
            body = (await req.json()) as ManifestRequest;
          } catch {
            return err('request body must be JSON', 400);
          }
          if (typeof body?.recipient !== 'string' || body.recipient.length === 0) {
            return err('recipient is required', 400);
          }
          if (
            body.embeddedLengthMax !== undefined &&
            (!Number.isInteger(body.embeddedLengthMax) || body.embeddedLengthMax < 0)
          ) {
            return err('embeddedLengthMax must be a non-negative integer', 400);
          }
          const link = store.getLinkById(db, id);
          if (!link) return notFound();
          const now = epoch();
          const inactive = () => {
            store.audit(db, id, body.recipient, 'manifest', 'inactive', now);
            return notFound();
          };
          if (!store.isLive(link, now)) return inactive();
          if (link.passcode_hash !== null) {
            const ok = typeof body.passcode === 'string' && (await Bun.password.verify(body.passcode, link.passcode_hash));
            if (!ok) {
              const remaining = store.decrementPasscodeBudget(db, id);
              if (remaining === null) return inactive(); // raced past lockout: budget already spent
              store.audit(db, id, body.recipient, 'manifest', 'bad-passcode', now);
              return json({ remainingAttempts: remaining } satisfies PasscodeError, 401);
            }
          }
          if (!store.consumeUse(db, id, now)) return inactive();
          store.audit(db, id, body.recipient, 'manifest', 'ok', now);

          const out: ManifestFile[] = [];
          for (const f of store.listFilesWithCiphertext(db, id)) {
            if (!f.ciphertext) continue;
            const meta = { contentType: f.content_type, lastUpdated: iso(f.updated_at) };
            if (body.embeddedLengthMax !== undefined && f.size <= body.embeddedLengthMax) {
              out.push({ ...meta, embedded: utf8Decode(f.ciphertext) });
            } else {
              const ticket = await ticketer.issue(id, f.id);
              out.push({ ...meta, location: `${base()}/shl/${id}/f/${f.id}?t=${encodeURIComponent(ticket)}` });
            }
          }
          return json({ files: out } satisfies Manifest);
        },
      },

      '/shl/:id/f/:fileId': {
        GET: async (req) => {
          const { id, fileId } = req.params;
          const t = new URL(req.url).searchParams.get('t');
          if (!t || !(await ticketer.verify(t, id, fileId))) return notFound();
          const file = store.getFile(db, id, fileId);
          if (!file?.ciphertext) return notFound();
          // recipient was captured on the manifest access; the ticket doesn't carry it
          store.audit(db, id, '', 'file', 'ok', epoch());
          return jose(file.ciphertext);
        },
      },

      // --- Control plane --------------------------------------------------------------

      '/api/links': {
        OPTIONS: preflight,
        POST: async (req) => {
          let body: CreateLinkRequest;
          try {
            body = (await req.json()) as CreateLinkRequest;
          } catch {
            return err('request body must be JSON', 400);
          }
          if (typeof body?.auth !== 'string' || !AUTH_SHAPE.test(body.auth)) {
            return err('auth must be 43-char base64url', 400);
          }
          const flag = body.flag === undefined ? 'U' : body.flag;
          if (typeof flag !== 'string' || !validFlag(flag)) {
            return err('flag must be an alphabetical subset of L,P,U; U and P cannot combine', 400);
          }
          if (!Number.isInteger(body.exp) || body.exp <= 0) {
            return err('exp (epoch seconds) is required', 400);
          }
          const maxUses = body.maxUses ?? null;
          if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
            return err('maxUses must be a positive integer or null', 400);
          }
          const label = body.label ?? null;
          if (label !== null && (typeof label !== 'string' || label.length > 80)) {
            return err('label must be a string of at most 80 chars', 400);
          }
          const hasP = flag.includes('P');
          if (hasP && (typeof body.passcode !== 'string' || body.passcode.length === 0)) {
            return err('P-flag links require a passcode', 400);
          }
          if (!hasP && body.passcode !== undefined) {
            return err('passcode is only valid with the P flag', 400);
          }

          const id = b64url(crypto.getRandomValues(new Uint8Array(32)));
          const url = `${base()}/shl/${id}`;
          if (url.length > 128) {
            return err('server baseURL too long: shlink payload url would exceed 128 chars', 500);
          }
          const passcodeHash = hasP ? await Bun.password.hash(body.passcode!, { algorithm: 'argon2id' }) : null;
          try {
            store.insertLink(db, {
              id,
              mgmtTokenHash: await authHash(body.auth),
              flag,
              label,
              exp: body.exp,
              maxUses,
              passcodeHash,
              passcodeAttemptsRemaining: hasP ? PASSCODE_BUDGET : null,
              now: epoch(),
            });
          } catch (e) {
            if (e instanceof Error && /UNIQUE/.test(e.message)) {
              return err('a link already exists for this auth capability', 409);
            }
            throw e;
          }
          return json({ id, url } satisfies CreateLinkResponse);
        },
      },

      '/api/manage/:auth': {
        OPTIONS: preflight,
        GET: async (req) => {
          const link = await requireLink(req.params.auth);
          if (!link) return notFound();
          return json(manageState(link));
        },
        PATCH: async (req) => {
          const link = await requireLink(req.params.auth);
          if (!link) return notFound();
          let patch: ManagePatch;
          try {
            patch = (await req.json()) as ManagePatch;
          } catch {
            return err('request body must be JSON', 400);
          }
          if ('exp' in patch && (!Number.isInteger(patch.exp) || patch.exp! <= 0)) {
            return err('exp must be epoch seconds', 400);
          }
          if ('maxUses' in patch && patch.maxUses !== null && (!Number.isInteger(patch.maxUses) || patch.maxUses! < 1)) {
            return err('maxUses must be a positive integer or null', 400);
          }
          if ('active' in patch && typeof patch.active !== 'boolean') {
            return err('active must be a boolean', 400);
          }
          if ('label' in patch && (typeof patch.label !== 'string' || patch.label.length > 80)) {
            return err('label must be a string of at most 80 chars', 400);
          }
          if ('passcode' in patch) {
            if (!link.flag.includes('P')) return err('passcode applies only to P-flag links', 400);
            if (typeof patch.passcode !== 'string' || patch.passcode.length === 0) {
              return err('passcode must be a non-empty string', 400);
            }
          }
          // Setting a passcode resets the attempt budget — that's the lockout re-arm path
          const passcodeHash =
            patch.passcode !== undefined
              ? await Bun.password.hash(patch.passcode, { algorithm: 'argon2id' })
              : link.passcode_hash;
          store.updateLink(db, link.id, {
            exp: patch.exp ?? link.exp,
            maxUses: 'maxUses' in patch ? (patch.maxUses ?? null) : link.max_uses,
            active: 'active' in patch ? (patch.active ? 1 : 0) : link.active,
            label: 'label' in patch ? patch.label! : link.label,
            passcodeHash,
            passcodeAttemptsRemaining:
              patch.passcode !== undefined ? PASSCODE_BUDGET : link.passcode_attempts_remaining,
            now: epoch(),
          });
          return json(manageState(store.getLinkById(db, link.id)!));
        },
        DELETE: async (req) => {
          const link = await requireLink(req.params.auth);
          if (!link) return notFound();
          store.purgeLink(db, link.id, epoch());
          return json(manageState(store.getLinkById(db, link.id)!));
        },
      },

      '/api/manage/:auth/files': {
        OPTIONS: preflight,
        POST: async (req) => {
          const link = await requireLink(req.params.auth);
          if (!link) return notFound();
          const body = new Uint8Array(await req.arrayBuffer());
          if (body.length === 0) return err('empty body', 400);
          if (body.length > config.limits.maxFileBytes) {
            return err(`file exceeds ${config.limits.maxFileBytes} byte limit`, 413);
          }
          if (link.flag.includes('U') && store.countFiles(db, link.id) >= 1) {
            return err('U-flag links carry exactly one file; PUT the existing file to replace it', 400);
          }
          const fileId = b64url(crypto.getRandomValues(new Uint8Array(16)));
          store.insertFile(db, {
            id: fileId,
            linkId: link.id,
            contentType: req.headers.get('content-type') ?? 'application/octet-stream',
            ciphertext: body,
            now: epoch(),
          });
          return json({ fileId } satisfies AddFileResponse);
        },
      },

      '/api/manage/:auth/files/:fileId': {
        OPTIONS: preflight,
        PUT: async (req) => {
          const link = await requireLink(req.params.auth);
          if (!link) return notFound();
          const file = store.getFile(db, link.id, req.params.fileId);
          if (!file) return notFound();
          const body = new Uint8Array(await req.arrayBuffer());
          if (body.length === 0) return err('empty body', 400);
          if (body.length > config.limits.maxFileBytes) {
            return err(`file exceeds ${config.limits.maxFileBytes} byte limit`, 413);
          }
          store.replaceFile(db, {
            id: file.id,
            linkId: link.id,
            contentType: req.headers.get('content-type') ?? file.content_type,
            ciphertext: body,
            now: epoch(),
          });
          return json({ fileId: file.id } satisfies AddFileResponse);
        },
        DELETE: async (req) => {
          const link = await requireLink(req.params.auth);
          if (!link) return notFound();
          const file = store.getFile(db, link.id, req.params.fileId);
          if (!file) return notFound();
          if (link.flag.includes('U') && link.active === 1 && store.countFiles(db, link.id) === 1) {
            return err('cannot delete the only file of an active U-flag link; pause or destroy it first', 400);
          }
          store.deleteFile(db, link.id, file.id);
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        },
      },
    },
    fetch() {
      return notFound();
    },
  });

  return server;
}

if (import.meta.main) {
  const config = await loadConfig();
  const db = store.openDb(process.env.DB_PATH ?? './data.sqlite');
  startSweeper(db, config.retention.purgeAfterDays);
  const server = await createApp(config, db);
  console.log(`kill-the-clipboard server on ${server.url} (public base: ${config.server.baseURL})`);
}
