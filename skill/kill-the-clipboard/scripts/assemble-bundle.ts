#!/usr/bin/env bun
/**
 * assemble-bundle.ts — build a conformant PatientSharedBundle (KTC profile, DESIGN.md §5)
 * from selected FHIR R4 resources plus optional Patient Story / FHIR-Rendered PDFs.
 *
 * This script OWNS bundle conformance: urn:uuid fullUrls, intra-bundle reference
 * rewriting, meta.profile stripping, and PatientSharedDocumentReference construction.
 * Agents must never hand-build DocumentReferences for the shared PDFs.
 *
 * Usage:
 *   assemble-bundle.ts --resources selected-resources.json [--story story.pdf]
 *                      [--rendered rendered.pdf] [--rendered-ids rendered-ids.json]
 *                      [--shared-date <ISO 8601>] -o bundle.json
 *
 * Options:
 *   --resources      JSON array of FHIR R4 resources; must contain exactly one Patient.
 *   --story          Patient Story PDF → DocumentReference typed LOINC 51855-5.
 *   --rendered       FHIR-Rendered PDF → DocumentReference typed LOINC 60591-5.
 *   --rendered-ids   Coverage manifest emitted by render-fhir-pdf.ts; cross-checked here
 *                    (gaps noted on stderr; validate-bundle.ts enforces).
 *   --shared-date    ISO 8601 instant for Bundle.timestamp and DocumentReference.date
 *                    (default: now).
 *   -o, --output     Output path for the assembled bundle JSON (required).
 *
 * Output (stdout): {"status":"assembled","entries":N,"docRefs":N,"output":"<path>"} —
 * counts and paths only, never resource content. stderr carries conformance notes.
 */

const USAGE =
  'usage: assemble-bundle.ts --resources selected-resources.json [--story story.pdf] ' +
  '[--rendered rendered.pdf] [--rendered-ids rendered-ids.json] [--shared-date ISO] -o bundle.json';

function usageFail(msg: string): never {
  console.error(`assemble-bundle: ${msg}\n${USAGE}`);
  process.exit(2);
}

function fail(msg: string): never {
  console.error(`assemble-bundle: ${msg}\n${USAGE}`);
  process.exit(1);
}

const FLAG_MAP: Record<string, string> = {
  '--resources': 'resources',
  '--story': 'story',
  '--rendered': 'rendered',
  '--rendered-ids': 'renderedIds',
  '--shared-date': 'sharedDate',
  '-o': 'output',
  '--output': 'output',
};

function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = FLAG_MAP[argv[i]!];
    if (!key) usageFail(`unknown argument: ${argv[i]}`);
    const val = argv[i + 1];
    if (val === undefined) usageFail(`missing value for ${argv[i]}`);
    opts[key] = val;
    i++;
  }
  if (!opts.resources) usageFail('--resources is required');
  if (!opts.output) usageFail('-o/--output is required');
  return opts;
}

type AnyObj = Record<string, unknown>;

function walkObjects(node: unknown, visit: (obj: AnyObj) => void): void {
  if (Array.isArray(node)) {
    for (const v of node) walkObjects(v, visit);
    return;
  }
  if (node && typeof node === 'object') {
    visit(node as AnyObj);
    for (const v of Object.values(node)) walkObjects(v, visit);
  }
}

// Relative literal reference form resolvable inside a bundle: ResourceType/id (no #fragment).
const RELATIVE_REF = /^[A-Za-z]+\/[A-Za-z0-9.\-]{1,64}$/;

async function readJson(path: string): Promise<unknown> {
  const f = Bun.file(path);
  if (!(await f.exists())) fail(`file not found: ${path}`);
  try {
    return JSON.parse(await f.text());
  } catch {
    fail(`not valid JSON: ${path}`);
  }
}

async function readPdf(path: string, kind: string): Promise<Uint8Array> {
  const f = Bun.file(path);
  if (!(await f.exists())) fail(`${kind} PDF not found: ${path}`);
  const bytes = await f.bytes();
  // %PDF magic — catches handing a markdown/json file where a PDF belongs.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    fail(`${kind} file is not a PDF (missing %PDF header): ${path}`);
  }
  return bytes;
}

const PS_CATEGORY_SYSTEM = 'https://cms.gov/fhir/CodeSystem/patient-shared-category';
const V3_OBS_VALUE = 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue';

function makeDocRef(opts: {
  id: string;
  loinc: string;
  display: string;
  title: string;
  patientUrn: string;
  patientDisplay?: string;
  date: string;
  pdf: Uint8Array;
}): AnyObj {
  const subject: AnyObj = { reference: opts.patientUrn };
  if (opts.patientDisplay) subject.display = opts.patientDisplay;
  return {
    resourceType: 'DocumentReference',
    id: opts.id,
    meta: { security: [{ system: V3_OBS_VALUE, code: 'PATAST' }] },
    status: 'current',
    type: { coding: [{ system: 'http://loinc.org', code: opts.loinc, display: opts.display }], text: opts.display },
    category: [{ coding: [{ system: PS_CATEGORY_SYSTEM, code: 'patient-shared', display: 'Patient Shared' }] }],
    subject,
    date: opts.date,
    author: [{ ...subject }],
    content: [
      {
        attachment: {
          contentType: 'application/pdf',
          data: Buffer.from(opts.pdf).toString('base64'),
          title: opts.title,
        },
      },
    ],
  };
}

function renderedIdSet(parsed: unknown): Set<string> {
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as AnyObj)?.ids)
      ? ((parsed as AnyObj).ids as unknown[])
      : Array.isArray((parsed as AnyObj)?.renderedIds)
        ? ((parsed as AnyObj).renderedIds as unknown[])
        : null;
  if (!raw) fail('--rendered-ids must be a JSON array of ids or {"ids": [...]}');
  return new Set(raw.filter((x): x is string => typeof x === 'string'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const parsed = await readJson(opts.resources!);
  if (!Array.isArray(parsed)) fail('--resources must be a JSON array of FHIR resources');
  const resources = structuredClone(parsed) as AnyObj[];
  for (const [i, r] of resources.entries()) {
    if (!r || typeof r !== 'object' || typeof r.resourceType !== 'string') {
      fail(`resources[${i}] is not a FHIR resource (missing resourceType)`);
    }
  }

  const patients = resources.filter((r) => r.resourceType === 'Patient');
  if (patients.length !== 1) {
    fail(`selection must contain exactly one Patient resource (found ${patients.length})`);
  }
  const patient = patients[0]!;

  let dateIso: string;
  if (opts.sharedDate) {
    const d = new Date(opts.sharedDate);
    if (Number.isNaN(d.getTime())) usageFail(`--shared-date is not a parseable ISO 8601 date: ${opts.sharedDate}`);
    dateIso = d.toISOString();
  } else {
    dateIso = new Date().toISOString();
  }

  // KTC: resources SHOULD NOT carry meta.profile (applies to contained resources too).
  let stripped = 0;
  const stripProfile = (r: AnyObj) => {
    const meta = r.meta as AnyObj | undefined;
    if (meta && 'profile' in meta) {
      delete meta.profile;
      if (Object.keys(meta).length === 0) delete r.meta;
      stripped++;
    }
  };
  for (const r of resources) {
    stripProfile(r);
    if (Array.isArray(r.contained)) for (const c of r.contained) if (c && typeof c === 'object') stripProfile(c as AnyObj);
  }
  if (stripped > 0) console.error(`note: stripped meta.profile from ${stripped} resource(s)`);

  const entries = resources.map((resource) => ({ fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource }));
  const patientUrn = entries.find((e) => e.resource === patient)!.fullUrl;

  const refMap = new Map<string, string>();
  for (const e of entries) {
    const id = e.resource.id;
    if (typeof id === 'string' && id) {
      const key = `${e.resource.resourceType}/${id}`;
      if (refMap.has(key)) console.error(`note: duplicate resource identity ${key}; references resolve to the first occurrence`);
      else refMap.set(key, e.fullUrl);
    }
  }

  // Inputs may already use urn-form patient references (the fixture-corpus / prior-bundle
  // convention of one pre-assigned patient urn). With exactly one foreign urn and exactly
  // one Patient that mapping is unambiguous; anything else is left for the validator.
  const foreignUrns = new Set<string>();
  for (const e of entries) {
    walkObjects(e.resource, (o) => {
      if (typeof o.reference === 'string' && o.reference.startsWith('urn:uuid:')) foreignUrns.add(o.reference);
    });
  }
  const urnAlias = new Map<string, string>();
  if (foreignUrns.size === 1) {
    const only = [...foreignUrns][0]!;
    urnAlias.set(only, patientUrn);
    console.error(`note: input references use pre-assigned urn ${only}; rewriting to the Patient entry urn`);
  } else if (foreignUrns.size > 1) {
    console.error(
      `note: ${foreignUrns.size} distinct urn:uuid references in input cannot be mapped to bundle entries; ` +
        'validate-bundle.ts will flag them as dangling',
    );
  }

  let rewritten = 0;
  let unresolved = 0;
  for (const e of entries) {
    walkObjects(e.resource, (o) => {
      const ref = o.reference;
      if (typeof ref !== 'string' || ref.startsWith('#')) return;
      if (ref.startsWith('urn:uuid:')) {
        const alias = urnAlias.get(ref);
        if (alias) {
          o.reference = alias;
          rewritten++;
        }
        return;
      }
      const target = refMap.get(ref);
      if (target) {
        o.reference = target;
        rewritten++;
      } else if (RELATIVE_REF.test(ref)) {
        unresolved++;
      }
    });
  }
  console.error(`note: rewrote ${rewritten} intra-bundle reference(s) to entry urns`);
  if (unresolved > 0) {
    console.error(`note: ${unresolved} relative reference(s) point at resources not in the selection; left untouched`);
  }

  const patientName = patient.name as AnyObj[] | undefined;
  const n0 = patientName?.[0];
  const patientDisplay =
    typeof n0?.text === 'string'
      ? n0.text
      : [...((n0?.given as string[] | undefined) ?? []), n0?.family].filter((x) => typeof x === 'string').join(' ') ||
        undefined;

  const docRefEntries: { fullUrl: string; resource: AnyObj }[] = [];
  if (opts.story) {
    const pdf = await readPdf(opts.story, 'story');
    docRefEntries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: makeDocRef({
        id: 'doc-patient-story',
        loinc: '51855-5',
        display: 'Patient note',
        title: 'Patient Story',
        patientUrn,
        patientDisplay,
        date: dateIso,
        pdf,
      }),
    });
  }
  if (opts.rendered) {
    const pdf = await readPdf(opts.rendered, 'rendered');
    docRefEntries.push({
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: makeDocRef({
        id: 'doc-fhir-rendered',
        loinc: '60591-5',
        display: 'Patient summary Document',
        title: 'FHIR-Rendered Health Summary',
        patientUrn,
        patientDisplay,
        date: dateIso,
        pdf,
      }),
    });
  }

  if (opts.renderedIds) {
    const ids = renderedIdSet(await readJson(opts.renderedIds));
    const uncovered = resources.filter((r) => {
      if (r.resourceType === 'DocumentReference') return false;
      const id = typeof r.id === 'string' ? r.id : '';
      return !(ids.has(id) || ids.has(`${r.resourceType}/${id}`));
    });
    if (uncovered.length > 0) {
      console.error(
        `note: rendered-ids manifest does not cover ${uncovered.length} non-DocumentReference resource(s); ` +
          'the FHIR-Rendered PDF SHALL render every one — validate-bundle.ts will report this as an error',
      );
    }
  }

  const patientEntry = entries.find((e) => e.resource === patient)!;
  const bundle = {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: dateIso,
    entry: [patientEntry, ...entries.filter((e) => e !== patientEntry), ...docRefEntries],
  };

  if (bundle.entry.length < 2) {
    console.error('note: bundle has <2 entries; PatientSharedBundle requires the Patient plus at least one content entry');
  }

  await Bun.write(opts.output!, JSON.stringify(bundle, null, 2));

  console.log(
    JSON.stringify({
      status: 'assembled',
      entries: bundle.entry.length,
      docRefs: docRefEntries.length,
      output: opts.output,
    }),
  );
}

await main();

// Zero-import script: this keeps it a module so top-level await typechecks
export {};
