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
    expect(html).toContain('Open ↗');
    expect(html).toContain('Open FHIR bundle (JSON)');
    expect(html).toContain('Goal (1)'); // unknown types still listed, never dropped
  });
});
