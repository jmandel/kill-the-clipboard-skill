// rtfToHtml: hostile-input RTF → escaped, styled HTML for the in-browser viewer.

import { describe, expect, test } from 'bun:test';
import { parseRtf, rtfToHtml } from './rtf.ts';

describe('rtfToHtml', () => {
  test('paragraphs, line breaks, and tabs', () => {
    const html = rtfToHtml('{\\rtf1\\ansi First line\\line second line\\par\\tab Indented para\\par}');
    expect(html).toBe('<p>First line<br>second line</p>\n<p><span class="tab"></span>Indented para</p>');
  });

  test('bold/italic/underline runs, toggled off with \\b0 and group close', () => {
    const html = rtfToHtml('{\\rtf1 plain {\\b bold {\\i bolditalic}} \\ul under\\ulnone done\\par}');
    expect(html).toContain('<strong>bold ');
    expect(html).toContain('<strong><em>bolditalic</em></strong>');
    expect(html).toContain('<u>under</u>done');
    const html2 = rtfToHtml('{\\rtf1 \\b on\\b0 off\\par}');
    expect(html2).toBe('<p><strong>on</strong>off</p>');
  });

  test('\\plain resets character formatting', () => {
    expect(rtfToHtml('{\\rtf1 \\b\\i both\\plain neither\\par}')).toBe('<p><strong><em>both</em></strong>neither</p>');
  });

  test('escapes: \\\'hh (cp1252 high range), \\uN with fallback, named specials', () => {
    const html = rtfToHtml("{\\rtf1 caf\\'e9 \\'93quoted\\'94 \\u8211?dash \\emdash\\bullet\\par}");
    expect(html).toContain('café');
    expect(html).toContain('“quoted”');
    expect(html).toContain('–dash');
    expect(html).toContain('—');
    expect(html).toContain('• ');
  });

  test("\\uN fallback can be a \\'hh escape (real Epic bullet pattern) — no double render", () => {
    // Epic notes encode bullets as u8226 followed by '95 — unicode bullet + cp1252 fallback.
    const html = rtfToHtml("{\\rtf1\\uc1 \\u8226 \\'95\\cell Marital status\\par}");
    expect(html).toContain('•');
    expect(html).not.toContain('••');
    const html0 = rtfToHtml('{\\rtf1\\uc0 \\u8226 no fallback\\par}');
    expect(html0).toContain('•no fallback');
  });

  test('skips non-content groups (font/color tables, pict, \\* destinations)', () => {
    const html = rtfToHtml(
      '{\\rtf1{\\fonttbl{\\f0 Calibri;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Epic}{\\pict 89504e47}Visible\\par}',
    );
    expect(html).toBe('<p>Visible</p>');
  });

  test('HTML-escapes text content — markup in RTF never survives as markup', () => {
    const html = rtfToHtml('{\\rtf1 <script>alert(1)</script> & "quotes"\\par}');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
  });

  test('blank paragraphs collapse; trailing unterminated text still emits', () => {
    expect(rtfToHtml('{\\rtf1 a\\par\\par\\par b}')).toBe('<p>a</p>\n<p>b</p>');
  });

  test('never throws on garbage', () => {
    for (const junk of ['', 'not rtf at all', '{\\rtf1 \\u', '{{{', '\\\\\\', "{\\rtf1 \\'zz}"]) {
      expect(() => rtfToHtml(junk)).not.toThrow();
    }
  });

  test('parseRtf merges same-style runs', () => {
    const paras = parseRtf('{\\rtf1 one two three\\par}');
    expect(paras).toHaveLength(1);
    expect(paras[0]).toHaveLength(1);
    expect(paras[0]![0]!.text).toBe('one two three');
  });
});
