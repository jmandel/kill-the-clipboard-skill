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
//   stdout: one CreateShlOutput JSON object (includes `handoffMarkdown`, below).
//   stderr: human progress.
//   <outdir>/owner-link.txt   owner capability URL (embeds master secret M)
//   <outdir>/viewer-link.txt  viewer-prefixed shlink (read capability) — for preview/share,
//                             never the form presented for scanning
//   <outdir>/shlink.txt       bare shlink URI (embeds the encryption key)
//   <outdir>/qr.png           QR of the bare shlink
//   <outdir>/handoff.md       durable copy of stdout's `handoffMarkdown`
//   <outdir>/link-meta.json   non-secret metadata (id, label, exp, ...)
// stdout includes `handoffMarkdown` — the complete closing message (owner page as a
// markdown link, shlink as inline code). Paste it VERBATIM into the chat; the links
// must reach the patient as message text, never only as file attachments. The bare
// master secret / derived key / auth never appear standalone on stdout or in errors —
// they're script plumbing, read from the files by manage-shl.ts.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { generateMasterSecret, deriveAuth, deriveKey } from '../../lib/hkdf.ts';
import { encryptJWE } from '../../lib/jwe.ts';
import { buildShlink, buildOwnerLink, buildViewerLink } from '../../lib/shlink.ts';
import type {
  AddFileResponse,
  CreateLinkRequest,
  CreateLinkResponse,
  CreateShlOutput,
} from '../../lib/types.ts';
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
  // The capability rides the Authorization header (never the URL path, which proxies
  // log); the label goes up encrypted with the link key — the server never sees it.
  const labelEnc = label ? await encryptJWE(new TextEncoder().encode(label), key, { cty: 'text/plain' }) : undefined;
  const createReq: CreateLinkRequest = { flag, exp, maxUses, ...(labelEnc ? { labelEnc } : {}) };
  const createRes = await expectOk(
    await fetchRetry(`${server}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
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
    await fetchRetry(`${server}/api/manage/files`, {
      method: 'POST',
      headers: { 'content-type': BUNDLE_CONTENT_TYPE, authorization: `Bearer ${auth}` },
      body: jwe,
    }),
    'POST /api/manage/files',
  );
  const { fileId } = (await fileRes.json()) as AddFileResponse;
  if (!fileId) throw new Error('server did not return a fileId');

  const shlink = buildShlink({ url, key, exp, flag, label });
  const ownerLink = buildOwnerLink(server, masterSecret);
  // Viewer-prefixed form (docs/DESIGN.md decision 11): a preview/share artifact ONLY —
  // the QR and copy-link always carry the bare shlink.
  const viewerLink = buildViewerLink(server, shlink);

  const paths = {
    ownerLink: resolve(outDir, 'owner-link.txt'),
    shlink: resolve(outDir, 'shlink.txt'),
    viewerLink: resolve(outDir, 'viewer-link.txt'),
    qrPng: resolve(outDir, 'qr.png'),
    meta: resolve(outDir, 'link-meta.json'),
    handoff: resolve(outDir, 'handoff.md'),
  };

  progress('-> writing artifacts ...');
  await Bun.write(paths.ownerLink, ownerLink + '\n');
  await Bun.write(paths.shlink, shlink + '\n');
  await Bun.write(paths.viewerLink, viewerLink + '\n');
  await QRCode.toFile(paths.qrPng, shlink, { errorCorrectionLevel: 'M' });
  const handoffMarkdown = buildHandoff({ ownerLink, shlink, qrPng: paths.qrPng, exp, maxUses });
  await Bun.write(paths.handoff, handoffMarkdown);
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
    handoffMarkdown,
    artifacts: paths,
  };
  console.log(JSON.stringify(output));
}

/**
 * The closing chat message, pre-composed so the agent pastes it verbatim instead of
 * reconstructing it (where the owner link tends to drift into a file attachment).
 * Emitted on stdout (`handoffMarkdown`) AND written to handoff.md as the durable copy.
 */
function buildHandoff(args: {
  ownerLink: string;
  shlink: string;
  qrPng: string;
  exp: number;
  maxUses: number | null;
}): string {
  const expText = new Date(args.exp * 1000).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const lifetime =
    args.maxUses === null
      ? `The link works until ${expText}.`
      : `The link works until ${expText} or ${args.maxUses} opens, whichever comes first.`;
  return `You're set!

**[Your link setup & control page](${args.ownerLink})** — keep this one private. It shows the QR code to present at check-in, who's accessed your records, and buttons to extend or kill the link.

**To share:** show the QR from that page (also saved at ${args.qrPng} if you'd rather print it or save it to your photos). If a clinic's online check-in form asks for a SMART Health Link, paste this one:

\`${args.shlink}\`

At the clinic, they scan it and everything you chose lands in your chart, labeled as coming from you — and if they can't scan these yet, nothing's lost; you check in the usual way. ${lifetime}
`;
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(USAGE);
  process.exit(1);
});
