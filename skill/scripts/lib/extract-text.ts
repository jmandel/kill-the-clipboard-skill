// Text extraction for pre-existing attachments (attachment-to-pdf.ts).
// Best-effort, never throws: clinical note bodies arrive as RTF or HTML far more
// often than as clean text, and LINE STRUCTURE carries meaning in notes.

export type SourceType = 'pdf' | 'rtf' | 'html' | 'text';

/** Sniff content type from bytes; extension and explicit content-type win upstream. */
export function sniffType(bytes: Uint8Array): SourceType {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 512)).trimStart();
  if (head.startsWith('%PDF-')) return 'pdf';
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (/^<!doctype html|^<html|^<\?xml[^>]*>\s*<html|^<(div|body|p|table)\b/i.test(head)) return 'html';
  return 'text';
}

/**
 * RTF → text. Handles what matters for notes: \par|\line → newline, \tab → spacing,
 * \'hh and \uN escapes, bullets/dashes, and skipped non-content groups (font/color/
 * stylesheet tables, pictures, \* destinations). Everything else degrades to its
 * text content.
 */
export function rtfToText(rtf: string): string {
  const SKIP_GROUPS = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'themedata', 'datastore',
    'generator', 'header', 'footer', 'object', 'listtable', 'listoverridetable',
  ]);
  let out = '';
  let i = 0;
  let depth = 0;
  let skipDepth = 0;
  const skipStack: number[] = [];
  while (i < rtf.length) {
    const ch = rtf[i]!;
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      if (skipStack.length && skipStack[skipStack.length - 1] === depth) { skipStack.pop(); skipDepth--; }
      depth--; i++; continue;
    }
    if (ch === '\\') {
      const rest = rtf.slice(i + 1);
      if (rest[0] === "'") {
        if (skipDepth === 0) out += String.fromCharCode(parseInt(rest.slice(1, 3), 16) || 32);
        i += 4; continue;
      }
      if (rest[0] === '*') { skipStack.push(depth); skipDepth++; i += 2; continue; }
      if (rest[0] === '{' || rest[0] === '}' || rest[0] === '\\') {
        if (skipDepth === 0) out += rest[0];
        i += 2; continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rest);
      if (m) {
        const word = m[1]!;
        if (SKIP_GROUPS.has(word)) { skipStack.push(depth); skipDepth++; }
        else if (skipDepth === 0) {
          if (word === 'par' || word === 'line' || word === 'row') out += '\n';
          else if (word === 'tab' || word === 'cell') out += '  ';
          else if (word === 'u' && m[2]) {
            out += String.fromCodePoint(((Number(m[2]) % 65536) + 65536) % 65536);
            if (rtf[i + 1 + m[0].length] === '?') i++;
          } else if (word === 'bullet') out += '• ';
          else if (word === 'emdash') out += '—';
          else if (word === 'endash') out += '–';
        }
        i += 1 + m[0].length; continue;
      }
      i += 2; continue;
    }
    if (skipDepth === 0 && ch !== '\r' && ch !== '\n') out += ch;
    i++;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', bull: '•', middot: '·', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', micro: 'µ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent] ?? whole;
  });
}

/**
 * HTML → text with line structure: block elements break lines, <li> bullets,
 * <td>/<th> get cell spacing, script/style dropped, entities decoded.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<\/?(p|div|tr|table|ul|ol|h[1-6]|section|article|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
