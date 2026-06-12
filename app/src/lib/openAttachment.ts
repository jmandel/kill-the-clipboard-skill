// Open DocumentReference attachments in a new tab without any filesystem round-trip.
// Bundles preserve source formats (PDF/HTML/RTF/text ride as their original bytes),
// so the viewer must render more than PDFs — and attachment bytes are UNTRUSTED.
//
// Security invariant: a blob URL inherits OUR origin, so attachment content must
// never execute as a top-level document — HTML (and SVG, which scripts when loaded
// as a document) would run with our origin. Every rendered attachment therefore
// opens as a shell page whose sandboxed iframe (sandbox="" — no scripts, opaque
// origin) holds the actual content:
//   sandbox — HTML/XHTML, images (incl. SVG), plain text: original bytes in the frame.
//   rtf     — converted to escaped HTML by our own renderer (rtf.ts) first, then
//             framed identically; the markup is ours, the text is escaped.
//   pdf     — the one direct open: browsers hand application/pdf blobs to their
//             isolated native viewer (which cannot script the page origin), and
//             sandboxed iframes are NOT reliably allowed to instantiate it.
// Anything else gets a download instead of an open.

import { rtfToHtml } from './rtf.ts';

export type OpenMode = 'pdf' | 'sandbox' | 'rtf';

export function openModeFor(contentType: string | undefined): OpenMode | null {
  const ct = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  if (ct === 'application/pdf') return 'pdf';
  if (ct === 'text/html' || ct === 'application/xhtml+xml' || ct === 'text/plain' || ct.startsWith('image/')) {
    return 'sandbox';
  }
  if (ct === 'application/rtf' || ct === 'text/rtf' || ct === 'application/x-rtf') return 'rtf';
  return null;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Shell whose sandboxed iframe renders untrusted document content inert. */
export function sandboxShellHtml(title: string, innerUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>html,body{margin:0;height:100%;background:#f3f4f6}iframe{border:0;display:block;width:100%;height:100%;background:#fff}</style>
</head><body><iframe sandbox="" src="${escapeHtml(innerUrl)}"></iframe></body></html>`;
}

/** Readable page around our own (already-escaped) rendered document fragment. */
export function docShellHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#fff;font:15px/1.55 Georgia,'Times New Roman',serif;color:#1a1d21}
main{max-width:760px;margin:0 auto;padding:40px 48px}
h1{font:600 17px/1.3 system-ui,sans-serif;border-bottom:1px solid #d6d9dd;padding-bottom:10px;margin:0 0 18px}
p{margin:0 0 .65em;white-space:pre-wrap}
.tab{display:inline-block;width:2.5em}
@media print{main{padding:0}}
</style>
</head><body><main><h1>${escapeHtml(title)}</h1>
${bodyHtml}
</main></body></html>`;
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const blobUrl = (parts: BlobPart[], type: string): string => URL.createObjectURL(new Blob(parts, { type }));

/** Blob URL ready for window.open, per the security invariant above. */
export function attachmentOpenUrl(data: string, contentType: string, mode: OpenMode, title: string): string {
  const bytes = b64ToBytes(data) as Uint8Array<ArrayBuffer>;
  const ct = contentType.split(';')[0]!.trim();
  if (mode === 'pdf') return blobUrl([bytes], 'application/pdf');
  if (mode === 'sandbox') return blobUrl([sandboxShellHtml(title, blobUrl([bytes], ct))], 'text/html');
  // RTF escapes are byte-oriented (\'hh is cp1252, handled in rtf.ts) — decode latin1.
  const rendered = docShellHtml(title, rtfToHtml(new TextDecoder('latin1').decode(bytes)));
  return blobUrl([sandboxShellHtml(title, blobUrl([rendered], 'text/html'))], 'text/html');
}

const DOWNLOAD_EXT: Record<string, string> = {
  'application/xml': 'xml', 'text/xml': 'xml', 'application/json': 'json',
  'application/fhir+json': 'json', 'application/dicom': 'dcm', 'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Filename for the download fallback when no mode can render the type. */
export function downloadName(title: string, contentType: string | undefined): string {
  const ct = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  const ext = DOWNLOAD_EXT[ct] ?? ct.split('/')[1]?.replace(/^x-|.*\+/, '') ?? 'bin';
  const stem = title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'document';
  return `${stem}.${ext}`;
}
