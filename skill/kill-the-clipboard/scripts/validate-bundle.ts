#!/usr/bin/env bun
/**
 * validate-bundle.ts — PatientSharedBundle conformance checker (DESIGN.md §8).
 *
 * Usage:
 *   validate-bundle.ts <bundle.json> [--rendered-ids rendered-ids.json] [--shl-payload payload.json]
 *
 * Options:
 *   --rendered-ids   Coverage manifest from render-fhir-pdf.ts. When provided and a
 *                    FHIR-Rendered PDF (LOINC 60591-5) is present, every non-DocumentReference
 *                    resource must be covered (error); without it, coverage is unverified (warning).
 *   --shl-payload    SHL payload JSON pre-flight (KTC: exp present, flag exactly "U",
 *                    label ≤80 chars, url ≤128 chars).
 *
 * Output (stdout): ValidateOutput JSON — {status, errors[], warnings[]}, each finding
 * {code, path, message}. Exit 0 on pass (warnings allowed), 1 iff errors, 2 on usage/IO failure.
 *
 * Error codes:
 *   bundle-type bundle-timestamp entry-count patient-count fullurl-not-urn fullurl-duplicate
 *   reference-dangling-urn reference-dangling-contained attachment-url attachment-no-data
 *   docref-status docref-type docref-category docref-subject docref-author docref-date
 *   docref-content-type docref-data-base64 rendered-coverage
 *   payload-exp payload-flag payload-label payload-url
 * Warning codes:
 *   meta-profile docref-pataast patient-demographics rendered-missing
 *   rendered-coverage-unverified reference-unresolved reference-external
 */

import type { ValidateOutput } from '../../../lib/types.ts';

const USAGE = 'usage: validate-bundle.ts <bundle.json> [--rendered-ids rendered-ids.json] [--shl-payload payload.json]';

function usageFail(msg: string): never {
  console.error(`validate-bundle: ${msg}\n${USAGE}`);
  process.exit(2);
}

type AnyObj = Record<string, unknown>;
type Finding = { code: string; path: string; message: string };

const URN_UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATIVE_REF = /^[A-Za-z]+\/[A-Za-z0-9.\-]{1,64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PS_CATEGORY_SYSTEM = 'https://cms.gov/fhir/CodeSystem/patient-shared-category';
const KTC_TYPES = new Set(['51855-5', '60591-5']);

function parseArgs(argv: string[]) {
  let bundlePath: string | undefined;
  let renderedIds: string | undefined;
  let shlPayload: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--rendered-ids') {
      renderedIds = argv[++i];
      if (renderedIds === undefined) usageFail('missing value for --rendered-ids');
    } else if (a === '--shl-payload') {
      shlPayload = argv[++i];
      if (shlPayload === undefined) usageFail('missing value for --shl-payload');
    } else if (a.startsWith('-')) {
      usageFail(`unknown argument: ${a}`);
    } else if (bundlePath === undefined) {
      bundlePath = a;
    } else {
      usageFail(`unexpected positional argument: ${a}`);
    }
  }
  if (!bundlePath) usageFail('bundle.json path is required');
  return { bundlePath, renderedIds, shlPayload };
}

async function readJson(path: string): Promise<unknown> {
  const f = Bun.file(path);
  if (!(await f.exists())) usageFail(`file not found: ${path}`);
  try {
    return JSON.parse(await f.text());
  } catch {
    usageFail(`not valid JSON: ${path}`);
  }
}

function walk(node: unknown, path: string, visit: (obj: AnyObj, path: string) => void): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
    return;
  }
  if (node && typeof node === 'object') {
    visit(node as AnyObj, path);
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, visit);
  }
}

function codings(cc: unknown): AnyObj[] {
  const arr = (cc as AnyObj)?.coding;
  return Array.isArray(arr) ? arr.filter((c): c is AnyObj => !!c && typeof c === 'object') : [];
}

function hasKtcType(res: AnyObj): boolean {
  return codings(res.type).some((c) => typeof c.code === 'string' && KTC_TYPES.has(c.code));
}

function hasPatientSharedCategory(res: AnyObj): boolean {
  const cats = Array.isArray(res.category) ? res.category : [];
  return cats.some((cc) =>
    codings(cc).some((c) => c.code === 'patient-shared' && (c.system === undefined || c.system === PS_CATEGORY_SYSTEM)),
  );
}

function renderedIdSet(parsed: unknown): Set<string> {
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as AnyObj)?.ids)
      ? ((parsed as AnyObj).ids as unknown[])
      : Array.isArray((parsed as AnyObj)?.renderedIds)
        ? ((parsed as AnyObj).renderedIds as unknown[])
        : null;
  if (!raw) usageFail('--rendered-ids must be a JSON array of ids or {"ids": [...]}');
  return new Set(raw.filter((x): x is string => typeof x === 'string'));
}

async function main() {
  const { bundlePath, renderedIds, shlPayload } = parseArgs(process.argv.slice(2));
  const bundle = (await readJson(bundlePath)) as AnyObj;
  const ids = renderedIds !== undefined ? renderedIdSet(await readJson(renderedIds)) : undefined;
  const payload = shlPayload !== undefined ? ((await readJson(shlPayload)) as AnyObj) : undefined;

  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ code, path, message });
  const warn = (code: string, path: string, message: string) => warnings.push({ code, path, message });

  if (bundle?.resourceType !== 'Bundle' || bundle?.type !== 'collection') {
    err('bundle-type', 'Bundle.type', `Bundle must have resourceType "Bundle" and type "collection" (found type "${bundle?.type ?? 'none'}")`);
  }
  if (typeof bundle?.timestamp !== 'string' || bundle.timestamp.length === 0) {
    err('bundle-timestamp', 'Bundle.timestamp', 'Bundle.timestamp is required');
  }

  const entries: AnyObj[] = (Array.isArray(bundle?.entry) ? bundle.entry : []).filter(
    (e: unknown): e is AnyObj => !!e && typeof e === 'object',
  );
  if (entries.length < 2) {
    err('entry-count', 'Bundle.entry', `PatientSharedBundle requires at least 2 entries — one Patient plus content (found ${entries.length})`);
  }

  const resourceOf = (e: AnyObj): AnyObj | undefined =>
    e.resource && typeof e.resource === 'object' ? (e.resource as AnyObj) : undefined;

  const patientEntries = entries.filter((e) => resourceOf(e)?.resourceType === 'Patient');
  if (patientEntries.length !== 1) {
    err('patient-count', 'Bundle.entry', `PatientSharedBundle requires exactly one Patient entry (found ${patientEntries.length})`);
  }
  const patientUrn =
    patientEntries.length === 1 && typeof patientEntries[0]!.fullUrl === 'string'
      ? (patientEntries[0]!.fullUrl as string)
      : undefined;

  const urnSet = new Set<string>();
  entries.forEach((e, i) => {
    const fu = e.fullUrl;
    if (typeof fu !== 'string' || !URN_UUID.test(fu)) {
      err('fullurl-not-urn', `Bundle.entry[${i}].fullUrl`, 'every entry fullUrl must be a urn:uuid');
      return;
    }
    if (urnSet.has(fu)) err('fullurl-duplicate', `Bundle.entry[${i}].fullUrl`, 'duplicate fullUrl across entries');
    urnSet.add(fu);
  });

  entries.forEach((e, i) => {
    const res = resourceOf(e);
    if (!res) return;
    const base = `Bundle.entry[${i}].resource`;
    const containedIds = new Set(
      (Array.isArray(res.contained) ? res.contained : [])
        .map((c: unknown) => (c && typeof c === 'object' ? (c as AnyObj).id : undefined))
        .filter((x: unknown): x is string => typeof x === 'string'),
    );

    walk(res, base, (o, p) => {
      // meta.profile SHOULD NOT appear on any resource, contained included.
      if (typeof o.resourceType === 'string' && o.meta && typeof o.meta === 'object') {
        const profile = (o.meta as AnyObj).profile;
        if (Array.isArray(profile) && profile.length > 0) {
          warn('meta-profile', `${p}.meta.profile`, 'resources in a PatientSharedBundle SHOULD NOT carry meta.profile');
        }
      }

      // Inline-attachment rule is bundle-WIDE: anything Attachment-shaped, anywhere.
      if (typeof o.contentType === 'string' && !('resourceType' in o)) {
        if (typeof o.url === 'string') {
          err('attachment-url', `${p}.url`, 'attachments must be inline; attachment.url is unreachable for SHL receivers');
        }
        if (typeof o.data !== 'string' || o.data.length === 0) {
          err('attachment-no-data', p, 'attachment must carry inline base64 data');
        }
      }

      const ref = o.reference;
      if (typeof ref !== 'string' || ref === '#') return;
      if (ref.startsWith('#')) {
        if (!containedIds.has(ref.slice(1))) {
          err('reference-dangling-contained', `${p}.reference`, `contained reference "${ref}" has no matching contained resource`);
        }
        return;
      }
      if (ref.startsWith('urn:uuid:')) {
        if (!urnSet.has(ref)) {
          err('reference-dangling-urn', `${p}.reference`, `urn reference does not match any entry fullUrl`);
        }
        return;
      }
      if (/^https?:\/\//.test(ref) || ref.startsWith('urn:')) {
        warn('reference-external', `${p}.reference`, 'external reference will be unresolvable for SHL receivers');
        return;
      }
      if (RELATIVE_REF.test(ref)) {
        warn('reference-unresolved', `${p}.reference`, `relative reference "${ref}" does not resolve inside the bundle`);
        return;
      }
      warn('reference-unresolved', `${p}.reference`, 'reference does not resolve inside the bundle');
    });
  });

  if (patientEntries.length === 1) {
    const p = resourceOf(patientEntries[0]!)!;
    const i = entries.indexOf(patientEntries[0]!);
    const names = Array.isArray(p.name) ? p.name : [];
    const hasName = names.some((n: unknown) => {
      const nn = n as AnyObj;
      return typeof nn?.text === 'string' || typeof nn?.family === 'string' || Array.isArray(nn?.given);
    });
    const missing = [
      ...(hasName ? [] : ['name']),
      ...(typeof p.birthDate === 'string' ? [] : ['birthDate']),
      ...(typeof p.gender === 'string' ? [] : ['gender']),
    ];
    if (missing.length > 0) {
      warn(
        'patient-demographics',
        `Bundle.entry[${i}].resource`,
        `Patient is missing matching demographics: ${missing.join(', ')} — receivers need name, birthDate, gender at minimum`,
      );
    }
  }

  // PatientSharedDocumentReference profile checks apply to any DocumentReference that claims
  // KTC-hood by type (51855-5 / 60591-5) or by patient-shared category; other DocumentReferences
  // (patient-included existing documents) only face the bundle-wide rules.
  entries.forEach((e, i) => {
    const res = resourceOf(e);
    if (res?.resourceType !== 'DocumentReference') return;
    const base = `Bundle.entry[${i}].resource`;
    const typed = hasKtcType(res);
    const categorized = hasPatientSharedCategory(res);
    if (!typed && !categorized) return;

    if (res.status !== 'current') {
      err('docref-status', `${base}.status`, `PatientSharedDocumentReference.status must be "current" (found "${res.status ?? 'none'}")`);
    }
    if (!typed) {
      err('docref-type', `${base}.type`, 'type must be LOINC 51855-5 (Patient Story) or 60591-5 (FHIR-Rendered)');
    }
    if (!categorized) {
      err('docref-category', `${base}.category`, `category must include ${PS_CATEGORY_SYSTEM}#patient-shared`);
    }
    if (patientUrn) {
      if ((res.subject as AnyObj)?.reference !== patientUrn) {
        err('docref-subject', `${base}.subject`, 'subject must reference the bundle Patient entry urn');
      }
      const authors = Array.isArray(res.author) ? res.author : [];
      if (!authors.some((a: unknown) => (a as AnyObj)?.reference === patientUrn)) {
        err('docref-author', `${base}.author`, 'author must include the bundle Patient entry urn');
      }
    }
    if (typeof res.date !== 'string' || res.date.length === 0) {
      err('docref-date', `${base}.date`, 'date is required');
    }
    const security = (res.meta as AnyObj)?.security;
    const hasPataast = Array.isArray(security) && security.some((c: unknown) => (c as AnyObj)?.code === 'PATAST');
    if (!hasPataast) {
      warn('docref-pataast', `${base}.meta.security`, 'meta.security SHOULD include v3-ObservationValue#PATAST');
    }
    const contents = Array.isArray(res.content) ? res.content : [];
    if (contents.length === 0) {
      err('docref-content-type', `${base}.content`, 'content with an application/pdf attachment is required');
    }
    contents.forEach((c: unknown, ci: number) => {
      const att = (c as AnyObj)?.attachment as AnyObj | undefined;
      const ap = `${base}.content[${ci}].attachment`;
      if (att?.contentType !== 'application/pdf') {
        err('docref-content-type', `${ap}.contentType`, `attachment contentType must be application/pdf (found "${att?.contentType ?? 'none'}")`);
      }
      if (typeof att?.data === 'string' && att.data.length > 0) {
        const compact = att.data.replace(/\s+/g, '');
        if (compact.length % 4 !== 0 || !BASE64.test(compact)) {
          err('docref-data-base64', `${ap}.data`, 'attachment data is not valid base64');
        }
      }
      // Missing data / url-based attachments already fire the bundle-wide attachment rules.
    });
  });

  const docRefResources = entries.map(resourceOf).filter((r): r is AnyObj => r?.resourceType === 'DocumentReference');
  const hasRendered = docRefResources.some((r) => codings(r.type).some((c) => c.code === '60591-5'));
  const discrete = entries.filter((e) => {
    const t = resourceOf(e)?.resourceType;
    return typeof t === 'string' && t !== 'Patient' && t !== 'DocumentReference';
  });
  if (discrete.length > 0 && !hasRendered) {
    warn(
      'rendered-missing',
      'Bundle',
      'discrete resources are present but there is no FHIR-Rendered PDF (LOINC 60591-5) — the profile SHOULD include one',
    );
  }
  if (hasRendered) {
    if (ids) {
      entries.forEach((e, i) => {
        const res = resourceOf(e);
        if (!res || res.resourceType === 'DocumentReference') return;
        const id = typeof res.id === 'string' ? res.id : '';
        const covered =
          (id && (ids.has(id) || ids.has(`${res.resourceType}/${id}`))) ||
          (typeof e.fullUrl === 'string' && ids.has(e.fullUrl));
        if (!covered) {
          err(
            'rendered-coverage',
            `Bundle.entry[${i}].resource`,
            `${res.resourceType}/${id || '(no id)'} is not covered by the rendered-ids manifest — the FHIR-Rendered PDF SHALL render every non-DocumentReference resource`,
          );
        }
      });
    } else {
      warn(
        'rendered-coverage-unverified',
        'Bundle',
        'FHIR-Rendered PDF present but no --rendered-ids manifest supplied; rendering coverage not verified',
      );
    }
  }

  if (payload) {
    if (typeof payload.exp !== 'number') {
      err('payload-exp', 'payload.exp', 'KTC requires exp (epoch seconds) in the SHL payload');
    }
    if (payload.flag !== 'U') {
      err('payload-flag', 'payload.flag', `KTC requires flag "U" exactly (found "${payload.flag ?? 'none'}")`);
    }
    if (typeof payload.label === 'string' && payload.label.length > 80) {
      err('payload-label', 'payload.label', `label exceeds 80 chars (${payload.label.length})`);
    }
    if (typeof payload.url !== 'string' || payload.url.length > 128) {
      err('payload-url', 'payload.url', 'payload url must be present and ≤128 chars');
    }
  }

  const out: ValidateOutput = { status: errors.length > 0 ? 'fail' : 'pass', errors, warnings };
  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

await main();
