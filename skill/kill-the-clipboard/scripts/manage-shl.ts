#!/usr/bin/env bun
// Manage an existing SMART Health Link via the owner capability.
//
// Usage:
//   manage-shl.ts <outdir|owner-link.txt> <verb> [options] [--server URL]
//
// Verbs:
//   status                       Link state (everything but the access log)
//   log                          Access log entries
//   re-arm [--exp-hours 24] [--max-uses 5]
//                                Extend exp to now+N hours and grant N MORE uses
//                                (server maxUses is set to uses + N)
//   pause | resume               Reversibly disable / re-enable serving
//   relabel <text>               Replace the label (<=80 chars)
//   replace --bundle new.json    Re-encrypt new content (same key, fresh IV) and
//                                replace the link's single file in place
//   destroy --yes                Permanently purge the link (irreversible)
//
// Options:
//   --server <url>   Override server base URL (default: baked config.json, else the
//                    origin embedded in the owner link)
//
// Output:
//   stdout: one JSON object per invocation; stderr: human progress.
//   The master secret, derived auth/key, owner link, and shlinks NEVER appear on
//   stdout/stderr or in error messages.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { deriveAuth, deriveKey } from '../../../lib/hkdf.ts';
import { encryptJWE } from '../../../lib/jwe.ts';
import { parseFragment } from '../../../lib/shlink.ts';
import type { ManagePatch, ManageState } from '../../../lib/types.ts';
import { expectOk, fetchRetry, resolveServerUrl } from './_resolve-server.ts';

const USAGE = `Usage: manage-shl.ts <outdir|owner-link.txt> <verb> [options] [--server URL]
Verbs: status | log | re-arm [--exp-hours 24] [--max-uses 5] | pause | resume |
       relabel <text> | replace --bundle new.json | destroy --yes`;
const BUNDLE_CONTENT_TYPE = 'application/fhir+json';

function takeValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new Error(`${name} requires a value`);
  args.splice(i, 2);
  return v;
}

function takeBool(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function progress(msg: string): void {
  console.error(msg);
}

async function loadOwnerSecret(target: string): Promise<{ masterSecret: Uint8Array; linkOrigin: string }> {
  let path = target;
  try {
    if (statSync(target).isDirectory()) path = join(target, 'owner-link.txt');
  } catch {
    throw new Error(`no such file or directory: ${target}`);
  }
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`owner link file not found: ${path}`);
  const ownerLink = (await file.text()).trim();
  const hashIdx = ownerLink.indexOf('#');
  if (hashIdx === -1) throw new Error(`not an owner link (no fragment): ${path}`);
  const parsed = parseFragment(ownerLink.slice(hashIdx + 1));
  if (parsed.mode !== 'owner') throw new Error(`not an owner link (viewer shlink found): ${path}`);
  const linkOrigin = ownerLink.slice(0, hashIdx).replace(/\/s$/, '');
  return { masterSecret: parsed.masterSecret, linkOrigin };
}

interface Ctx {
  server: string;
  auth: string;
  masterSecret: Uint8Array;
}

async function getState(ctx: Ctx): Promise<ManageState> {
  const res = await expectOk(
    await fetchRetry(`${ctx.server}/api/manage/${ctx.auth}`),
    'GET /api/manage/{auth}',
  );
  return (await res.json()) as ManageState;
}

async function patchState(ctx: Ctx, patch: ManagePatch): Promise<void> {
  await expectOk(
    await fetchRetry(`${ctx.server}/api/manage/${ctx.auth}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'PATCH /api/manage/{auth}',
  );
}

async function main(): Promise<void> {
  const args = [...Bun.argv.slice(2)];
  const serverArg = takeValue(args, '--server');
  const expHoursRaw = takeValue(args, '--exp-hours');
  const maxUsesRaw = takeValue(args, '--max-uses');
  const bundlePath = takeValue(args, '--bundle');
  const yes = takeBool(args, '--yes');

  const [target, verb, ...rest] = args;
  if (!target || !verb) throw new Error('missing <outdir|owner-link.txt> or <verb>');

  const { masterSecret, linkOrigin } = await loadOwnerSecret(target);
  let server: string;
  try {
    server = await resolveServerUrl(serverArg);
  } catch {
    server = await resolveServerUrl(linkOrigin);
  }
  const ctx: Ctx = { server, auth: await deriveAuth(masterSecret), masterSecret };

  const emit = (o: unknown) => console.log(JSON.stringify(o));

  switch (verb) {
    case 'status': {
      const { accessLog: _omitted, ...state } = await getState(ctx);
      emit(state);
      break;
    }
    case 'log': {
      const state = await getState(ctx);
      emit({ id: state.id, accessLog: state.accessLog });
      break;
    }
    case 're-arm': {
      const expHours = Number(expHoursRaw ?? '24');
      if (!Number.isFinite(expHours) || expHours <= 0) throw new Error(`invalid --exp-hours: ${expHoursRaw}`);
      const moreUses = Number(maxUsesRaw ?? '5');
      if (!Number.isInteger(moreUses) || moreUses < 1) throw new Error(`invalid --max-uses: ${maxUsesRaw}`);
      const before = await getState(ctx);
      const exp = Math.floor(Date.now() / 1000 + expHours * 3600);
      const maxUses = before.uses + moreUses;
      progress(`-> extending exp to +${expHours}h, granting ${moreUses} more uses ...`);
      await patchState(ctx, { exp, maxUses });
      const after = await getState(ctx);
      emit({
        status: 're-armed',
        id: after.id,
        exp: after.exp,
        expIso: new Date(after.exp * 1000).toISOString(),
        maxUses: after.maxUses,
        uses: after.uses,
        live: after.live,
        reminder:
          'REMINDER: previously rendered QR images and shlink.txt embed the OLD exp in their payload. Regenerate them from the create-shl output directory or the owner page so receivers see the new expiry.',
      });
      break;
    }
    case 'pause':
    case 'resume': {
      const active = verb === 'resume';
      await patchState(ctx, { active });
      const state = await getState(ctx);
      emit({ status: active ? 'resumed' : 'paused', id: state.id, active: state.active, live: state.live });
      break;
    }
    case 'relabel': {
      const label = rest[0];
      if (label === undefined) throw new Error('relabel requires the new label text');
      if (label.length > 80) throw new Error(`label exceeds 80 chars (${label.length})`);
      await patchState(ctx, { label });
      const state = await getState(ctx);
      emit({ status: 'relabeled', id: state.id, label: state.label });
      break;
    }
    case 'replace': {
      if (!bundlePath) throw new Error('replace requires --bundle <new.json>');
      const file = Bun.file(bundlePath);
      if (!(await file.exists())) throw new Error(`bundle file not found: ${bundlePath}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error(`bundle is not valid JSON: ${bundlePath}`);
      }
      const state = await getState(ctx);
      const fileMeta = state.files[0];
      if (!fileMeta) throw new Error('link has no file to replace (purged?)');
      const key = await deriveKey(ctx.masterSecret);
      progress('-> re-encrypting with the original key (fresh IV) ...');
      const jwe = await encryptJWE(bytes, key, { cty: BUNDLE_CONTENT_TYPE, deflate: true });
      await expectOk(
        await fetchRetry(`${ctx.server}/api/manage/${ctx.auth}/files/${fileMeta.fileId}`, {
          method: 'PUT',
          headers: { 'content-type': BUNDLE_CONTENT_TYPE },
          body: jwe,
        }),
        'PUT /api/manage/{auth}/files/{fileId}',
      );
      emit({
        status: 'replaced',
        id: state.id,
        fileId: fileMeta.fileId,
        contentType: BUNDLE_CONTENT_TYPE,
        size: Buffer.byteLength(jwe),
      });
      break;
    }
    case 'destroy': {
      if (!yes) throw new Error('destroy is irreversible; pass --yes to confirm');
      const state = await getState(ctx);
      await expectOk(
        await fetchRetry(`${ctx.server}/api/manage/${ctx.auth}`, { method: 'DELETE' }),
        'DELETE /api/manage/{auth}',
      );
      emit({ status: 'destroyed', id: state.id });
      break;
    }
    default:
      throw new Error(`unknown verb: ${verb}`);
  }
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(USAGE);
  process.exit(1);
});
