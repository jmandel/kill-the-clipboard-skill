#!/usr/bin/env bun
// Create a SMART Health Link (KTC profile) from an assembled PatientSharedBundle.
//
// Usage:
//   create-shl.ts --bundle bundle.json --label "..." [--exp-hours 24] [--max-uses 5]
//                 [--flag U] [--bare] [--server URL] -o <outdir>
//
// Options:
//   --bundle <path>     Validated PatientSharedBundle JSON (encrypted byte-for-byte as-is)
//   --label <text>      Receiver-facing label, <=80 chars (required; craft with the patient)
//   --exp-hours <n>     Link lifetime from now (default 24), or "never" for a link
//                       that lives until revoked. NOTE: "never" omits exp from the
//                       payload — valid base SHL, but NOT KTC-conformant (KTC requires
//                       exp); keep a finite expiry for clinic check-in links.
//   --max-uses <n>      Use budget (default 5); "unlimited" for no cap
//   --flag <flags>      SHL flags, alphabetical (default "U"; KTC requires U)
//   --bare              QR + handoff carry the bare shlink:/ URI instead of the
//                       viewer-prefixed URL. Opt-in only: bare URIs scan only in
//                       SHL-aware apps, while the viewer-prefixed default opens from
//                       any phone camera AND still carries the embedded shlink:/ for
//                       SHL-aware scanners.
//   --zip               Compress the bundle before encryption (JWE zip: DEF — spec-legal
//                       MAY, ~6x smaller ciphertext). KNOWN COMPATIBILITY ISSUES: some
//                       receivers can't inflate it (hand-rolled decryptors; modern
//                       `jose` dropped zip support) — avoid unless there's a specific
//                       reason, e.g. a very large bundle AND a receiver known to cope.
//                       Readers we ship always inflate either way.
//   --server <url>      Override the baked/config server base URL
//   -o, --out <dir>     Output directory; must be empty or absent (never overwrites)
//
// Output:
//   stdout: one CreateShlOutput JSON object (includes `handoffMarkdown`, below).
//   stderr: human progress.
//   <outdir>/owner-link.txt   owner capability URL (embeds master secret M)
//   <outdir>/viewer-link.txt  viewer-prefixed shlink (read capability) — the DEFAULT
//                             share/QR form; works from any phone camera
//   <outdir>/shlink.txt       bare shlink URI (embeds the encryption key)
//   <outdir>/qr.png           QR of the share link (viewer-prefixed; bare with --bare)
//   <outdir>/handoff.md       durable copy of stdout's `handoffMarkdown`
//   <outdir>/link-meta.json   non-secret metadata (id, label, exp, ...)
// stdout includes `handoffMarkdown` — the complete closing message (owner page as a
// markdown link, share link as inline code). Paste it VERBATIM into the chat; the
// links must reach the patient as message text, never only as file attachments — and
// the QR lives on the owner page, so there is nothing to render or attach yourself.
// The bare master secret / derived key / auth never appear standalone on stdout or
// in errors — they're script plumbing, read from the files by manage-shl.ts.

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

const USAGE = `Usage: create-shl.ts --bundle bundle.json --label "..." [--exp-hours 24] [--max-uses 5] [--flag U] [--bare] [--zip] [--server URL] -o <outdir>`;
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

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
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
  const bare = takeFlag(args, '--bare');
  const zip = takeFlag(args, '--zip');
  const serverArg = takeValue(args, '--server');
  const outDirRaw = takeValue(args, '-o', '--out');

  if (!bundlePath || !label || !outDirRaw) throw new Error('missing required option');
  if (args.length > 0) throw new Error(`unrecognized arguments: ${args.join(' ')}`);
  if (label.length > 80) throw new Error(`label exceeds 80 chars (${label.length})`);

  let expHours: number | null;
  if (expHoursRaw === 'never') {
    expHours = null;
  } else {
    expHours = Number(expHoursRaw);
    if (!Number.isFinite(expHours) || expHours <= 0) throw new Error(`invalid --exp-hours: ${expHoursRaw}`);
  }
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
  const exp = expHours === null ? null : Math.floor(Date.now() / 1000 + expHours * 3600);

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

  progress(`-> encrypting bundle (A256GCM${zip ? ', zip DEF' : ''}) ...`);
  const jwe = await encryptJWE(bundleBytes, key, { cty: BUNDLE_CONTENT_TYPE, deflate: zip });
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

  // Never-expiring links omit exp from the payload (base SHL; exp is a staleness hint)
  const shlink = buildShlink({ url, key, ...(exp !== null ? { exp } : {}), flag, label });
  const ownerLink = buildOwnerLink(server, masterSecret);
  // Viewer-prefixed form (docs/DESIGN.md decision 11): the DEFAULT share/QR form —
  // any phone camera resolves it, and SHL-aware scanners extract the embedded
  // shlink:/ substring per spec. --bare opts into the raw URI.
  const viewerLink = buildViewerLink(server, shlink);
  const shareLink = bare ? shlink : viewerLink;

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
  await QRCode.toFile(paths.qrPng, shareLink, { errorCorrectionLevel: 'M' });
  const handoffMarkdown = buildHandoff({ ownerLink, shareLink, bare, exp, maxUses });
  await Bun.write(paths.handoff, handoffMarkdown);
  const meta = {
    id,
    label,
    flag,
    exp,
    expIso: exp === null ? null : new Date(exp * 1000).toISOString(),
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
    nextStep:
      'Paste handoffMarkdown verbatim as the body of your closing chat message — both links must appear ' +
      'as message text (owner page as a clickable markdown link, share link as inline code), never only ' +
      "as file paths or attachments. Do not render or attach a QR image; the patient's control page shows the live QR.",
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
  shareLink: string;
  bare: boolean;
  exp: number | null;
  maxUses: number | null;
}): string {
  const expText =
    args.exp === null
      ? null
      : new Date(args.exp * 1000).toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  const lifetime =
    expText === null
      ? args.maxUses === null
        ? 'The link works until you revoke it from your control page.'
        : `The link works for ${args.maxUses} opens, or until you revoke it from your control page.`
      : args.maxUses === null
        ? `The link works until ${expText}.`
        : `The link works until ${expText} or ${args.maxUses} opens, whichever comes first.`;
  const scanNote = args.bare
    ? ' (bare SHL format — needs an SHL-aware scanner)'
    : ' — any phone camera can scan it';
  return `You're set!

**[Your link setup & control page](${args.ownerLink})** — keep this one private. It shows the QR code to present at check-in, who's accessed your records, and buttons to extend or kill the link.

**To share:** open your control page and show the QR at check-in${scanNote}. If a clinic's online check-in form asks for a SMART Health Link, paste this one:

\`${args.shareLink}\`

At the clinic, they scan it and everything you chose lands in your chart, labeled as coming from you — and if they can't scan these yet, nothing's lost; you check in the usual way. ${lifetime}
`;
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(USAGE);
  process.exit(1);
});
