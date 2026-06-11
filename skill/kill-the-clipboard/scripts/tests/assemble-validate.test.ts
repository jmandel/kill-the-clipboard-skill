// End-to-end tests for assemble-bundle.ts + validate-bundle.ts (DESIGN.md §5, §8).
//
// Positive path: a selection composed from the breadth corpus (constant patient + PAMI
// spread + documents family + supporting closure) plus real tiny PDFs rendered through
// lib/doc.tsx assembles into a bundle that validates with zero errors.
// Negative path: tests/fixtures/invalid/* — one bundle per validator code, each asserted
// to fire precisely (expected.json is the manifest).

import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { page, para, renderDoc, section, storyTheme, summaryTheme } from '../../../../lib/doc.tsx';

const REPO = join(import.meta.dir, '../../../..');
const SCRIPTS = join(REPO, 'skill/kill-the-clipboard/scripts');
const CORPUS = join(REPO, 'tests/fixtures/uscore');
const INVALID = join(REPO, 'tests/fixtures/invalid');
const ASSEMBLE = join(SCRIPTS, 'assemble-bundle.ts');
const VALIDATE = join(SCRIPTS, 'validate-bundle.ts');

const CONSTANT_URN = 'urn:uuid:00000000-b4ea-4d01-9871-000000000001';
const URN_V4 = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(script: string, args: string[]) {
  const r = Bun.spawnSync({ cmd: ['bun', script, ...args], stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const fixture = (rel: string) => JSON.parse(readFileSync(join(CORPUS, rel), 'utf8'));

// Closure chosen so every relative reference except the deliberate Epic-quirk practitioner
// (Practitioner/eM5CWtq15N0WJeuCet5BJlQ3, see medications/NOTES.md) resolves in-bundle.
const SELECTION_FILES = [
  'patient/patient-constant.json',
  'problems/condition-hypertension-active.json',
  'problems/condition-food-insecurity-health-concern.json',
  'medications/medicationrequest-active-coded.json',
  'medications/medicationrequest-onhold-plan-external.json',
  'medications/medicationrequest-stopped-contained.json',
  'medications/medicationdispense-completed.json',
  'medications/medication-metformin-er.json',
  'allergies/allergyintolerance-peanut-active-low.json',
  'immunizations/immunization-covid-completed.json',
  'immunizations/immunization-flu-completed.json',
  'documents/documentreference-progress-note.json',
  'documents/diagnosticreport-note-cardiology.json',
  'encounters/encounter-imp-hospitalization.json',
  'encounters/encounter-amb-office.json',
  'encounters/location-breadth-hospital.json',
  'encounters/location-breadth-clinic.json',
  'supporting/practitioner-sample-renderer.json',
  'supporting/practitioner-sample-hospitalist.json',
  'supporting/organization-breadth-test-medical.json',
];

const SYNTH_OBSERVATION = {
  resourceType: 'Observation',
  id: 'obs-synth-relref',
  meta: { profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-simple-observation'] },
  status: 'final',
  code: { text: 'Synthesized relative-reference probe' },
  subject: { reference: 'Patient/patient-constant', display: 'Casey Breadth-Tester' },
  valueString: 'present',
};

const SHARED_DATE = '2026-06-12T09:00:00.000Z';

const dir = mkdtempSync(join(tmpdir(), 'ktc-assemble-test-'));
const storyPdf = join(dir, 'story.pdf');
const renderedPdf = join(dir, 'rendered.pdf');
const selectionPath = join(dir, 'selected-resources.json');
const renderedIdsPath = join(dir, 'rendered-ids.json');
const bundlePath = join(dir, 'bundle.json');

let selection: any[] = [];
let bundle: any;
let assembleOut: any;

type Entry = { fullUrl: string; resource: any };
const entries = (): Entry[] => bundle.entry as Entry[];
const findResource = (pred: (r: any) => boolean): Entry | undefined => entries().find((e) => pred(e.resource));
const byId = (id: string) => findResource((r) => r.id === id);
const patientEntry = () => findResource((r) => r.resourceType === 'Patient')!;

beforeAll(async () => {
  await renderDoc(
    [page(storyTheme, [section(storyTheme, 'My Story'), para(storyTheme, 'A tiny but real patient story PDF.')], { key: 'p' })],
    { title: 'Patient Story' },
    storyPdf,
  );
  await renderDoc(
    [page(summaryTheme, [section(summaryTheme, 'Summary'), para(summaryTheme, 'A tiny but real FHIR-rendered PDF.')], { key: 'p' })],
    { title: 'FHIR-Rendered Summary' },
    renderedPdf,
  );

  selection = [...SELECTION_FILES.map(fixture), structuredClone(SYNTH_OBSERVATION)];
  await Bun.write(selectionPath, JSON.stringify(selection));
  await Bun.write(
    renderedIdsPath,
    JSON.stringify(selection.filter((r) => r.resourceType !== 'DocumentReference').map((r) => r.id)),
  );

  const r = run(ASSEMBLE, [
    '--resources', selectionPath,
    '--story', storyPdf,
    '--rendered', renderedPdf,
    '--rendered-ids', renderedIdsPath,
    '--shared-date', SHARED_DATE,
    '-o', bundlePath,
  ]);
  if (r.code !== 0) throw new Error(`assemble failed: ${r.stderr}`);
  assembleOut = JSON.parse(r.stdout);
  bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
});

describe('assemble-bundle.ts', () => {
  test('stdout is the assembled contract with counts only — no PHI', () => {
    expect(Object.keys(assembleOut).sort()).toEqual(['docRefs', 'entries', 'output', 'status']);
    expect(assembleOut.status).toBe('assembled');
    expect(assembleOut.docRefs).toBe(2);
    expect(assembleOut.entries).toBe(selection.length + 2);
    expect(assembleOut.output).toBe(bundlePath);
  });

  test('bundle is a collection with timestamp and the Patient first', () => {
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.timestamp).toBe(SHARED_DATE);
    expect(entries().length).toBe(selection.length + 2);
    expect(entries()[0]!.resource.resourceType).toBe('Patient');
  });

  test('every fullUrl is a unique random urn:uuid v4', () => {
    const urns = entries().map((e) => e.fullUrl);
    for (const u of urns) expect(u).toMatch(URN_V4);
    expect(new Set(urns).size).toBe(urns.length);
  });

  test('meta.profile is stripped everywhere and noted on stderr', () => {
    for (const e of entries()) expect(e.resource.meta?.profile).toBeUndefined();
    const obs = byId('obs-synth-relref')!.resource;
    expect(obs.meta).toBeUndefined();
  });

  test('pre-assigned constant patient urn references are rewritten to the Patient entry urn', () => {
    const patUrn = patientEntry().fullUrl;
    expect(byId('condition-hypertension-active')!.resource.subject.reference).toBe(patUrn);
    expect(byId('immunization-covid-completed')!.resource.patient.reference).toBe(patUrn);
    expect(JSON.stringify(bundle)).not.toContain(CONSTANT_URN);
  });

  test('relative Patient/patient-constant reference is rewritten to the Patient entry urn', () => {
    expect(byId('obs-synth-relref')!.resource.subject.reference).toBe(patientEntry().fullUrl);
  });

  test('Type/id references between selected resources are rewritten to entry urns', () => {
    const metforminUrn = byId('medication-metformin-er')!.fullUrl;
    const onhold = byId('medicationrequest-onhold-plan-external')!.resource;
    expect(JSON.stringify(onhold)).toContain(metforminUrn);

    const mrUrn = byId('medicationrequest-active-coded')!.fullUrl;
    const dispense = byId('medicationdispense-completed')!.resource;
    expect(JSON.stringify(dispense)).toContain(mrUrn);
    expect(JSON.stringify(dispense)).not.toContain('MedicationRequest/medicationrequest-active-coded');
  });

  test('contained and unresolvable external references are left untouched', () => {
    const stopped = JSON.stringify(byId('medicationrequest-stopped-contained')!.resource);
    expect(stopped).toContain('#med-contained-amoxicillin');
    expect(stopped).toContain('Practitioner/eM5CWtq15N0WJeuCet5BJlQ3');
    const flu = JSON.stringify(byId('immunization-flu-completed')!.resource);
    expect(flu).toContain('#performer-practitioner');
  });

  test('story DocumentReference is built exactly per the KTC profile', () => {
    const story = findResource((r) => r.resourceType === 'DocumentReference' && r.id === 'doc-patient-story')!.resource;
    const patUrn = patientEntry().fullUrl;
    expect(story.status).toBe('current');
    expect(story.type.coding[0]).toMatchObject({ system: 'http://loinc.org', code: '51855-5' });
    expect(story.category[0].coding[0]).toMatchObject({
      system: 'https://cms.gov/fhir/CodeSystem/patient-shared-category',
      code: 'patient-shared',
    });
    expect(story.subject.reference).toBe(patUrn);
    expect(story.author[0].reference).toBe(patUrn);
    expect(story.date).toBe(SHARED_DATE);
    expect(story.meta.security[0]).toMatchObject({
      system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue',
      code: 'PATAST',
    });
    const att = story.content[0].attachment;
    expect(att.contentType).toBe('application/pdf');
    expect(att.data).toBe(Buffer.from(readFileSync(storyPdf)).toString('base64'));
  });

  test('rendered DocumentReference carries LOINC 60591-5 and the rendered PDF bytes', () => {
    const rendered = findResource((r) => r.resourceType === 'DocumentReference' && r.id === 'doc-fhir-rendered')!.resource;
    expect(rendered.type.coding[0].code).toBe('60591-5');
    expect(rendered.status).toBe('current');
    expect(rendered.content[0].attachment.data).toBe(Buffer.from(readFileSync(renderedPdf)).toString('base64'));
  });

  test('assembles without PDFs: zero docRefs, resources only', async () => {
    const out = join(dir, 'bundle-nopdf.json');
    const r = run(ASSEMBLE, ['--resources', selectionPath, '-o', out]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.docRefs).toBe(0);
    expect(j.entries).toBe(selection.length);
  });

  test('rejects a selection with zero Patients', async () => {
    const p = join(dir, 'no-patient.json');
    await Bun.write(p, JSON.stringify(selection.filter((r) => r.resourceType !== 'Patient')));
    const r = run(ASSEMBLE, ['--resources', p, '-o', join(dir, 'x.json')]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('exactly one Patient');
  });

  test('rejects a selection with two Patients', async () => {
    const p = join(dir, 'two-patients.json');
    const extra = structuredClone(selection[0]);
    extra.id = 'patient-duplicate';
    await Bun.write(p, JSON.stringify([...selection, extra]));
    const r = run(ASSEMBLE, ['--resources', p, '-o', join(dir, 'x.json')]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('exactly one Patient');
  });

  test('rejects a non-PDF story file', async () => {
    const fake = join(dir, 'fake.pdf');
    await Bun.write(fake, 'just markdown, not a pdf');
    const r = run(ASSEMBLE, ['--resources', selectionPath, '--story', fake, '-o', join(dir, 'x.json')]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('not a PDF');
  });

  test('usage failure on missing required args', () => {
    const r = run(ASSEMBLE, ['--resources', selectionPath]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
});

describe('validate-bundle.ts on the assembled bundle', () => {
  test('passes with zero errors; only the documented Epic-quirk warning remains', () => {
    const r = run(VALIDATE, [bundlePath, '--rendered-ids', renderedIdsPath]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('pass');
    expect(out.errors).toEqual([]);
    const codes = new Set(out.warnings.map((w: any) => w.code));
    expect([...codes].every((c) => c === 'reference-unresolved')).toBe(true);
  });

  test('rendered coverage gap is an error when --rendered-ids is provided', async () => {
    const partial = join(dir, 'rendered-ids-partial.json');
    const ids = selection.filter((r) => r.resourceType !== 'DocumentReference').map((r) => r.id);
    await Bun.write(partial, JSON.stringify(ids.slice(0, 3)));
    const r = run(VALIDATE, [bundlePath, '--rendered-ids', partial]);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('fail');
    expect(out.errors.every((e: any) => e.code === 'rendered-coverage')).toBe(true);
    expect(out.errors.length).toBe(ids.length - 3);
  });

  test('without --rendered-ids, coverage is only a warning', () => {
    const r = run(VALIDATE, [bundlePath]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.warnings.map((w: any) => w.code)).toContain('rendered-coverage-unverified');
  });

  test('SHL payload pre-flight: conformant payload passes', () => {
    const r = run(VALIDATE, [bundlePath, '--rendered-ids', renderedIdsPath, '--shl-payload', join(INVALID, 'payload-good.json')]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).errors).toEqual([]);
  });

  test('SHL payload pre-flight: missing exp, wrong flag, long label, long url all fire', () => {
    const r = run(VALIDATE, [bundlePath, '--rendered-ids', renderedIdsPath, '--shl-payload', join(INVALID, 'payload-bad.json')]);
    expect(r.code).toBe(1);
    const codes = JSON.parse(r.stdout).errors.map((e: any) => e.code).sort();
    expect(codes).toEqual(['payload-exp', 'payload-flag', 'payload-label', 'payload-url']);
  });
});

describe('validate-bundle.ts negative fixtures', () => {
  const expected: Record<string, { errors: string[]; warnings?: string[] }> = JSON.parse(
    readFileSync(join(INVALID, 'expected.json'), 'utf8'),
  );

  for (const [file, exp] of Object.entries(expected)) {
    test(`${file} → errors [${exp.errors.join(', ') || 'none'}]${exp.warnings ? ` warnings [${exp.warnings.join(', ')}]` : ''}`, () => {
      const r = run(VALIDATE, [join(INVALID, file)]);
      const out = JSON.parse(r.stdout);
      const errorCodes = [...new Set(out.errors.map((e: any) => e.code))].sort();
      expect(errorCodes).toEqual([...exp.errors].sort());
      expect(r.code).toBe(exp.errors.length > 0 ? 1 : 0);
      expect(out.status).toBe(exp.errors.length > 0 ? 'fail' : 'pass');
      for (const w of exp.warnings ?? []) {
        expect(out.warnings.map((x: any) => x.code)).toContain(w);
      }
    });
  }

  test('unreadable input is a usage failure (exit 2), not a validation result', () => {
    const r = run(VALIDATE, [join(INVALID, 'does-not-exist.json')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
});
