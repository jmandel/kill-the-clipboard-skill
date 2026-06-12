// BundleView renders a decrypted bundle into readable sections (static markup test).

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FhirBundle } from '../lib/fetchShl.ts';
import { BundleView } from './BundleView.tsx';

const bundle: FhirBundle = {
  resourceType: 'Bundle',
  entry: [
    { resource: { resourceType: 'Patient', id: 'p', name: [{ text: 'Casey Tester' }], birthDate: '1980-02-29' } as any },
    { resource: { resourceType: 'Condition', id: 'c', code: { text: 'Post-concussion syndrome' }, clinicalStatus: { coding: [{ display: 'Active' }] } } as any },
    { resource: { resourceType: 'MedicationRequest', id: 'm', medicationCodeableConcept: { text: 'Nortriptyline 10 mg' }, dosageInstruction: [{ text: 'nightly' }], status: 'active' } as any },
    { resource: { resourceType: 'Observation', id: 'o', code: { text: 'Blood pressure' }, component: [{ code: { text: 'Systolic' }, valueQuantity: { value: 118, unit: 'mmHg' } }] } as any },
    { resource: { resourceType: 'DocumentReference', id: 'd', type: { text: 'MRI Brain — report' }, date: '2020-07-14', content: [{ attachment: { contentType: 'application/pdf', data: 'JVBERi0=' } }] } as any },
    // Source formats ride as-is (no PDF transcoding): HTML and RTF render in-browser…
    { resource: { resourceType: 'DocumentReference', id: 'd2', type: { text: 'Neurology consult' }, content: [{ attachment: { contentType: 'text/html', data: 'PGh0bWw+' } }] } as any },
    { resource: { resourceType: 'DocumentReference', id: 'd3', type: { text: 'Progress note' }, content: [{ attachment: { contentType: 'application/rtf', data: 'e1xydGYxfQ==' } }] } as any },
    // …while unrenderable types fall back to a download.
    { resource: { resourceType: 'DocumentReference', id: 'd4', type: { text: 'CT study' }, content: [{ attachment: { contentType: 'application/dicom', data: 'AAAA' } }] } as any },
    { resource: { resourceType: 'Goal', id: 'g', description: { text: 'walk daily' } } as any }, // falls back to generic row
  ],
};

describe('BundleView', () => {
  test('sections, patient header, document rows, fallback type', () => {
    const html = renderToStaticMarkup(<BundleView bundle={bundle} />);
    expect(html).toContain('Casey Tester');
    expect(html).toContain('DOB 1980-02-29');
    expect(html).toContain('Problems (1)');
    expect(html).toContain('Post-concussion syndrome');
    expect(html).toContain('Nortriptyline 10 mg');
    expect(html).toContain('Systolic 118 mmHg');
    expect(html).toContain('MRI Brain — report');
    expect(html).toContain('Open FHIR bundle (JSON)');
    expect(html).toContain('Goal (1)'); // unknown types still listed, never dropped
  });

  test('renderable formats get Open; unrenderable get Download', () => {
    const html = renderToStaticMarkup(<BundleView bundle={bundle} />);
    expect(html.split('Open ↗').length - 1).toBe(3); // pdf + html + rtf
    expect(html.split('>Download<').length - 1).toBe(1); // dicom
  });
});
