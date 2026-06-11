#!/usr/bin/env bun
// Create a SMART Health Link (KTC profile) from an assembled PatientSharedBundle.
//
// Usage:
//   create-shl.ts --bundle bundle.json --label "..." [--exp-hours 24] [--max-uses 5]
//                 [--flag U] [--server URL] -o <outdir>
//
// Options:
//   --bundle <path>     Validated PatientSharedBundle JSON (encrypted byte-for-byte as-is)
//   --label <text>      Receiver-facing label, <=80 chars (required; craft with the patient)
//   --exp-hours <n>     Link lifetime from now (default 24; KTC requires exp)
//   --max-uses <n>      Use budget (default 5); "unlimited" for no cap
//   --flag <flags>      SHL flags, alphabetical (default "U"; KTC requires U)
//   --server <url>      Override the baked/config server base URL
//   -o, --out <dir>     Output directory; must be empty or absent (never overwrites)
//
// Output:
//   stdout: one CreateShlOutput JSON object — file PATHS and non-secret metadata only.
//   stderr: human progress.
//   <outdir>/owner-link.txt   owner capability URL (contains master secret M) — SECRET
//   <outdir>/viewer-link.txt  viewer-prefixed shlink (read capability) — for preview/share,
//                             never the form presented for scanning
//   <outdir>/shlink.txt       bare shlink URI (contains the encryption key)   — SECRET
//   <outdir>/qr.png           QR of the bare shlink                           — SECRET
//   <outdir>/link-meta.json   non-secret metadata (id, label, exp, ...)
// The master secret, derived key/auth, shlink, and owner link NEVER appear on
// stdout/stderr or in error messages.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { generateMasterSecret, deriveAuth, deriveKey } from '../../../lib/hkdf.ts';
import { encryptJWE } from '../../../lib/jwe.ts';
import { buildShlink, buildOwnerLink, buildViewerLink } from '../../../lib/shlink.ts';
import type {
  AddFileResponse,
  CreateLinkRequest,
  CreateLinkResponse,
  CreateShlOutput,
} from '../../../lib/types.ts';
import { expectOk, fetchRetry, resolveServerUrl } from './_resolve-server.ts';

const USAGE = `Usage: create-shl.ts --bundle bundle.json --label "..." [--exp-hours 24] [--max-uses 5] [--flag U] [--server URL] -o <outdir>`;
const BUNDLE_CONTENT_TYPE = 'application/fhir+json';

function takeValue(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i === -1) continue;
    const v = args[i + 1];
    if (v === undefined) throw new Error(`${name} requires a value`);
    args.splice(i, 2);
    return v;
  }
  return undefined;
}

function progress(msg: string): void {
  console.error(msg);
}

async function main(): Promise<void> {
  const args = [...Bun.argv.slice(2)];
  const bundlePath = takeValue(args, '--bundle');
  const label = takeValue(args, '--label');
  const expHoursRaw = takeValue(args, '--exp-hours') ?? '24';
  const maxUsesRaw = takeValue(args, '--max-uses') ?? '5';
  const flag = takeValue(args, '--flag') ?? 'U';
  const serverArg = takeValue(args, '--server');
  const outDirRaw = takeValue(args, '-o', '--out');

  if (!bundlePath || !label || !outDirRaw) throw new Error('missing required option');
  if (args.length > 0) throw new Error(`unrecognized arguments: ${args.join(' ')}`);
  if (label.length > 80) throw new Error(`label exceeds 80 chars (${label.length})`);

  const expHours = Number(expHoursRaw);
  if (!Number.isFinite(expHours) || expHours <= 0) throw new Error(`invalid --exp-hours: ${expHoursRaw}`);
  let maxUses: number | null;
  if (maxUsesRaw === 'unlimited' || maxUsesRaw === 'none') {
    maxUses = null;
  } else {
    maxUses = Number(maxUsesRaw);
    if (!Number.isInteger(maxUses) || maxUses < 1) throw new Error(`invalid --max-uses: ${maxUsesRaw}`);
  }

  const server = await resolveServerUrl(serverArg);

  const bundleFile = Bun.file(bundlePath);
  if (!(await bundleFile.exists())) throw new Error(`bundle file not found: ${bundlePath}`);
  const bundleBytes = new Uint8Array(await bundleFile.arrayBuffer());
  try {
    JSON.parse(new TextDecoder().decode(bundleBytes));
  } catch {
    throw new Error(`bundle is not valid JSON: ${bundlePath}`);
  }

  const outDir = resolve(outDirRaw);
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new Error(`output directory is not empty, refusing to overwrite: ${outDir}`);
  }
  mkdirSync(outDir, { recursive: true });

  const masterSecret = generateMasterSecret();
  const auth = await deriveAuth(masterSecret);
  const key = await deriveKey(masterSecret);
  const exp = Math.floor(Date.now() / 1000 + expHours * 3600);

  progress(`-> registering link with ${server} ...`);
  const createReq: CreateLinkRequest = { auth, flag, exp, maxUses, label };
  const createRes = await expectOk(
    await fetchRetry(`${server}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createReq),
    }),
    'POST /api/links',
  );
  const { id, url } = (await createRes.json()) as CreateLinkResponse;

  progress('-> encrypting bundle (A256GCM, zip DEF) ...');
  const jwe = await encryptJWE(bundleBytes, key, { cty: BUNDLE_CONTENT_TYPE, deflate: true });
  const jweSize = Buffer.byteLength(jwe);

  progress(`-> uploading ciphertext (${jweSize} bytes) ...`);
  const fileRes = await expectOk(
    await fetchRetry(`${server}/api/manage/${auth}/files`, {
      method: 'POST',
      headers: { 'content-type': BUNDLE_CONTENT_TYPE },
      body: jwe,
    }),
    'POST /api/manage/{auth}/files',
  );
  const { fileId } = (await fileRes.json()) as AddFileResponse;
  if (!fileId) throw new Error('server did not return a fileId');

  const shlink = buildShlink({ url, key, exp, flag, label });
  const ownerLink = buildOwnerLink(server, masterSecret);
  // Viewer-prefixed form (DESIGN.md decision 11): a preview/share artifact ONLY —
  // the QR and copy-link always carry the bare shlink.
  const viewerLink = buildViewerLink(server, shlink);

  const paths = {
    ownerLink: resolve(outDir, 'owner-link.txt'),
    shlink: resolve(outDir, 'shlink.txt'),
    viewerLink: resolve(outDir, 'viewer-link.txt'),
    qrPng: resolve(outDir, 'qr.png'),
    meta: resolve(outDir, 'link-meta.json'),
  };

  progress('-> writing artifacts ...');
  await Bun.write(paths.ownerLink, ownerLink + '\n');
  await Bun.write(paths.shlink, shlink + '\n');
  await Bun.write(paths.viewerLink, viewerLink + '\n');
  await QRCode.toFile(paths.qrPng, shlink, { errorCorrectionLevel: 'M' });
  const meta = {
    id,
    label,
    flag,
    exp,
    expIso: new Date(exp * 1000).toISOString(),
    maxUses,
    server,
    file: { contentType: BUNDLE_CONTENT_TYPE, size: jweSize },
  };
  await Bun.write(paths.meta, JSON.stringify(meta, null, 2) + '\n');

  const output: CreateShlOutput = {
    status: 'created',
    id,
    label,
    flag,
    exp,
    maxUses,
    files: [{ contentType: BUNDLE_CONTENT_TYPE, size: jweSize }],
    artifacts: paths,
  };
  console.log(JSON.stringify(output));
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(USAGE);
  process.exit(1);
});
