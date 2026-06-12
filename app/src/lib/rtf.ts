// RTF → safe HTML for the in-browser document viewer. Clinical note bodies arrive as
// RTF constantly (Epic note exports especially) and SHL receivers get no filesystem —
// so the static viewer renders RTF itself. Scope: what notes actually use — paragraphs
// and line breaks, bold/italic/underline/strike runs, tabs/bullets/dashes, \'hh and
// \uN escapes, cp1252 high range — with every non-content group (font/color tables,
// pictures, metadata) skipped. All text is HTML-escaped; the output never contains
// markup from the source document, so it is safe to render same-origin.

interface CharStyle {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
}

interface Run extends CharStyle {
  text: string;
}

const SKIP_GROUPS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'themedata', 'datastore',
  'generator', 'header', 'footer', 'object', 'listtable', 'listoverridetable',
  'xmlnstbl', 'rsidtbl', 'mmathPr', 'wgrffmtfilter',
]);

// 0x80–0x9F differ between latin1 and windows-1252; RTF \'hh escapes mean cp1252.
const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Parse RTF into paragraphs of styled runs. Never throws on hostile input. */
export function parseRtf(rtf: string): Run[][] {
  const paras: Run[][] = [];
  let cur: Run[] = [];
  let style: CharStyle = { b: false, i: false, u: false, s: false };
  const styleStack: CharStyle[] = [];
  let depth = 0;
  let skipDepth = 0;
  const skipStack: number[] = [];
  // \ucN = how many fallback characters follow each \uN (group-scoped, default 1).
  let uc = 1;
  const ucStack: number[] = [];

  // One skip entry per group: `{\*\generator ...}` would otherwise push twice
  // (once for \*, once for the destination word) but pop only once on `}`.
  const beginSkip = () => {
    if (skipStack[skipStack.length - 1] === depth) return;
    skipStack.push(depth);
    skipDepth++;
  };
  const emit = (t: string) => {
    if (!t || skipDepth > 0) return;
    const last = cur[cur.length - 1];
    if (last && last.b === style.b && last.i === style.i && last.u === style.u && last.s === style.s) {
      last.text += t;
    } else {
      cur.push({ text: t, ...style });
    }
  };
  const endPara = () => {
    if (skipDepth > 0) return;
    paras.push(cur);
    cur = [];
  };

  let i = 0;
  while (i < rtf.length) {
    const ch = rtf[i]!;
    if (ch === '{') {
      depth++;
      styleStack.push({ ...style });
      ucStack.push(uc);
      i++;
      continue;
    }
    if (ch === '}') {
      if (skipStack.length && skipStack[skipStack.length - 1] === depth) {
        skipStack.pop();
        skipDepth--;
      }
      style = styleStack.pop() ?? { b: false, i: false, u: false, s: false };
      uc = ucStack.pop() ?? 1;
      depth--;
      i++;
      continue;
    }
    if (ch === '\\') {
      const rest = rtf.slice(i + 1);
      if (rest[0] === "'") {
        const code = parseInt(rest.slice(1, 3), 16);
        if (Number.isFinite(code)) emit(CP1252[code] ?? String.fromCharCode(code));
        i += 4;
        continue;
      }
      if (rest[0] === '*') {
        beginSkip();
        i += 2;
        continue;
      }
      if (rest[0] === '{' || rest[0] === '}' || rest[0] === '\\') {
        emit(rest[0]);
        i += 2;
        continue;
      }
      if (rest[0] === '~') { emit(' '); i += 2; continue; }
      if (rest[0] === '-' || rest[0] === '_') { emit('-'); i += 2; continue; }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rest);
      if (m) {
        const word = m[1]!;
        const num = m[2] !== undefined ? Number(m[2]) : undefined;
        const on = num !== 0; // \b vs \b0 toggle convention
        if (SKIP_GROUPS.has(word)) beginSkip();
        else if (word === 'par' || word === 'row' || word === 'sect' || word === 'page') endPara();
        else if (word === 'line') emit('\n');
        else if (word === 'tab' || word === 'cell') emit('\t');
        else if (word === 'bullet') emit('• ');
        else if (word === 'emdash') emit('—');
        else if (word === 'endash') emit('–');
        else if (word === 'lquote') emit('‘');
        else if (word === 'rquote') emit('’');
        else if (word === 'ldblquote') emit('“');
        else if (word === 'rdblquote') emit('”');
        else if (word === 'b') style = { ...style, b: on };
        else if (word === 'i') style = { ...style, i: on };
        else if (word === 'ul') style = { ...style, u: on };
        else if (word === 'ulnone') style = { ...style, u: false };
        else if (word === 'strike') style = { ...style, s: on };
        else if (word === 'plain') style = { b: false, i: false, u: false, s: false };
        else if (word === 'uc' && num !== undefined) uc = Math.max(0, num);
        else if (word === 'u' && num !== undefined) {
          emit(String.fromCodePoint(((num % 65536) + 65536) % 65536));
          // \uN is followed by `uc` ANSI fallback characters that must be skipped —
          // each is a plain char OR a full \'hh escape (Epic bullets: u8226 then '95,
          // which double-rendered before this skip).
          let j = i + 1 + m[0].length;
          for (let left = uc; left > 0 && j < rtf.length; left--) {
            if (rtf[j] === '\\' && rtf[j + 1] === "'") j += 4;
            else if (rtf[j] === '{' || rtf[j] === '}' || rtf[j] === '\\') break;
            else j++;
          }
          i = j;
          continue;
        }
        i += 1 + m[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch !== '\r' && ch !== '\n') emit(ch);
    i++;
  }
  if (cur.length > 0) paras.push(cur);
  return paras;
}

function renderRun(r: Run): string {
  let h = escapeHtml(r.text)
    .replace(/\n/g, '<br>')
    .replace(/\t/g, '<span class="tab"></span>');
  if (r.s) h = `<s>${h}</s>`;
  if (r.u) h = `<u>${h}</u>`;
  if (r.i) h = `<em>${h}</em>`;
  if (r.b) h = `<strong>${h}</strong>`;
  return h;
}

/** RTF body → HTML fragment (paragraphs of escaped, styled runs). */
export function rtfToHtml(rtf: string): string {
  return parseRtf(rtf)
    .map((runs) => runs.filter((r) => r.text !== ''))
    .filter((runs) => runs.some((r) => r.text.trim() !== '' || r.text.includes('\t')))
    .map((runs) => `<p>${runs.map(renderRun).join('')}</p>`)
    .join('\n');
}
