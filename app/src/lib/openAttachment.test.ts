// openAttachment: mode dispatch + the sandbox security invariant (pure parts only;
// blob/window plumbing is exercised in the browser).

import { describe, expect, test } from 'bun:test';
import { b64ToBytes, docShellHtml, downloadName, openModeFor, sandboxShellHtml } from './openAttachment.ts';

describe('openModeFor', () => {
  test('PDF is the only direct open', () => {
    expect(openModeFor('application/pdf')).toBe('pdf');
    expect(openModeFor('application/pdf; charset=binary')).toBe('pdf');
  });

  test('markup-capable and inert-but-blob-risky types are sandboxed', () => {
    expect(openModeFor('text/html')).toBe('sandbox');
    expect(openModeFor('application/xhtml+xml')).toBe('sandbox');
    expect(openModeFor('text/plain')).toBe('sandbox');
    expect(openModeFor('image/png')).toBe('sandbox');
    expect(openModeFor('image/svg+xml')).toBe('sandbox'); // SVG scripts as a document — must never open top-level
    expect(openModeFor('TEXT/HTML; charset=utf-8')).toBe('sandbox');
  });

  test('RTF gets the in-app renderer', () => {
    expect(openModeFor('application/rtf')).toBe('rtf');
    expect(openModeFor('text/rtf')).toBe('rtf');
    expect(openModeFor('application/x-rtf')).toBe('rtf');
  });

  test('everything else is download-only', () => {
    expect(openModeFor('application/dicom')).toBeNull();
    expect(openModeFor('application/msword')).toBeNull();
    expect(openModeFor(undefined)).toBeNull();
    expect(openModeFor('')).toBeNull();
  });
});

describe('shells', () => {
  test('sandbox shell uses a fully sandboxed iframe and escapes the title', () => {
    const html = sandboxShellHtml('<img src=x onerror=alert(1)>', 'blob:null/abc');
    expect(html).toContain('<iframe sandbox="" src="blob:null/abc">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('doc shell escapes the title and embeds the (pre-escaped) body verbatim', () => {
    const html = docShellHtml('Note & "Co"', '<p>safe body</p>');
    expect(html).toContain('Note &amp; &quot;Co&quot;');
    expect(html).toContain('<p>safe body</p>');
  });
});

describe('helpers', () => {
  test('b64ToBytes handles standard and url-safe alphabets and whitespace', () => {
    expect(new TextDecoder().decode(b64ToBytes('aGVsbG8='))).toBe('hello');
    expect(new TextDecoder().decode(b64ToBytes('aGVs\nbG8='))).toBe('hello');
    expect(b64ToBytes('_-8=')).toEqual(new Uint8Array([0xff, 0xef]));
  });

  test('downloadName derives a safe filename and extension', () => {
    expect(downloadName('MRI Brain — report', 'application/dicom')).toBe('MRI Brain  report.dcm');
    expect(downloadName('note', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('note.docx');
    expect(downloadName('', undefined)).toBe('document.bin');
    expect(downloadName('x', 'application/fhir+json')).toBe('x.json');
  });
});
