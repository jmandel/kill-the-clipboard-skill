// Render a decrypted PatientSharedBundle for a recipient, with the same type-aware
// approach as the skill's FHIR->PDF renderer (an alternate React renderer): readable
// sections for discrete resources, document titles with open-in-new-tab buttons
// (browser blob URLs — no filesystem round-trip), and an open-the-FHIR action for
// the raw bundle. All input is hostile (real exports are messy).

import type { FhirBundle, FhirResource } from '../lib/fetchShl.ts';
import { b64ToBlobUrl } from '../lib/fetchShl.ts';

const cc = (v: any): string =>
  v?.text ?? v?.coding?.[0]?.display ?? (v?.coding?.[0]?.code ? `${v.coding[0].system?.split('/').pop() ?? 'code'} ${v.coding[0].code}` : '');
const when = (s: any): string => (typeof s === 'string' ? s.slice(0, 10) : '');
const qty = (v: any): string => (v?.value !== undefined ? `${v.value} ${v.unit ?? v.code ?? ''}`.trim() : '');

function obsValue(r: any): string {
  if (r.valueQuantity) return qty(r.valueQuantity);
  if (r.valueCodeableConcept) return cc(r.valueCodeableConcept);
  if (r.valueString) return r.valueString;
  if (typeof r.valueBoolean === 'boolean') return String(r.valueBoolean);
  if (r.valueInteger !== undefined) return String(r.valueInteger);
  if (r.valueRatio) return `${r.valueRatio.numerator?.value ?? '?'} : ${r.valueRatio.denominator?.value ?? '?'}`;
  if (r.component?.length) return r.component.map((c: any) => `${cc(c.code)} ${obsValue(c)}`.trim()).join(' · ');
  if (r.dataAbsentReason) return `(${cc(r.dataAbsentReason)})`;
  return '';
}

/** One readable line per resource; null falls through to the generic row. */
function describe(r: any): { primary: string; secondary: string } | null {
  switch (r.resourceType) {
    case 'Condition':
      return { primary: cc(r.code), secondary: [cc(r.clinicalStatus), when(r.onsetDateTime ?? r.recordedDate)].filter(Boolean).join(' · ') };
    case 'MedicationRequest':
      return {
        primary: cc(r.medicationCodeableConcept) || r.medicationReference?.display || 'Medication',
        secondary: [r.dosageInstruction?.[0]?.text, r.status, when(r.authoredOn)].filter(Boolean).join(' · '),
      };
    case 'Medication':
      return { primary: cc(r.code), secondary: '' };
    case 'AllergyIntolerance':
      return {
        primary: cc(r.code),
        secondary: [r.reaction?.[0]?.manifestation?.map(cc).join(', '), r.criticality && `criticality ${r.criticality}`, cc(r.clinicalStatus)]
          .filter(Boolean).join(' · '),
      };
    case 'Immunization':
      return { primary: cc(r.vaccineCode), secondary: [r.status, when(r.occurrenceDateTime) || r.occurrenceString].filter(Boolean).join(' · ') };
    case 'Observation':
      return { primary: cc(r.code), secondary: [obsValue(r), when(r.effectiveDateTime ?? r.issued)].filter(Boolean).join(' · ') };
    case 'Procedure':
      return { primary: cc(r.code), secondary: [r.status, when(r.performedDateTime) || when(r.performedPeriod?.start)].filter(Boolean).join(' · ') };
    case 'DiagnosticReport':
      return { primary: cc(r.code), secondary: [r.status, when(r.effectiveDateTime ?? r.issued)].filter(Boolean).join(' · ') };
    case 'Specimen':
      return { primary: cc(r.type) || 'Specimen', secondary: when(r.collection?.collectedDateTime) };
    default: {
      // generic best-effort: any human-meaningful string beats a bare type name
      const primary = cc(r.code) || r.description?.text || cc(r.description) || r.name?.[0]?.text || r.title || '';
      return primary ? { primary, secondary: r.status ?? '' } : null;
    }
  }
}

const SECTION_ORDER = [
  'Condition', 'MedicationRequest', 'Medication', 'AllergyIntolerance', 'Immunization',
  'Observation', 'Procedure', 'DiagnosticReport',
];
const SECTION_TITLE: Record<string, string> = {
  Condition: 'Problems', MedicationRequest: 'Medications', Medication: 'Medication details',
  AllergyIntolerance: 'Allergies', Immunization: 'Immunizations', Observation: 'Observations & results',
  Procedure: 'Procedures', DiagnosticReport: 'Reports',
};

/** The two patient-shared PDF kinds, recognized by LOINC, pin to the top of the list. */
function docLoinc(d: any): string {
  const codings = d?.type?.coding;
  if (!Array.isArray(codings)) return '';
  const c = codings.find((x: any) => x?.system === 'http://loinc.org' || x?.code);
  return c?.code ?? '';
}
function docBadge(d: any): string | null {
  const code = docLoinc(d);
  if (code === '51855-5') return '★ Patient story';
  if (code === '60591-5') return '☰ All shared records';
  return null;
}
function docRank(d: any): number {
  const code = docLoinc(d);
  return code === '51855-5' ? 0 : code === '60591-5' ? 1 : 2;
}

function openDoc(doc: any) {
  const att = doc.content?.[0]?.attachment;
  if (!att?.data) return;
  window.open(b64ToBlobUrl(att.data, att.contentType ?? 'application/octet-stream'), '_blank', 'noopener');
}

function openBundleJson(bundle: FhirBundle) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  window.open(url, '_blank', 'noopener');
}

export function BundleView({ bundle }: { bundle: FhirBundle }) {
  const resources: FhirResource[] = (bundle.entry ?? []).map((e) => e.resource).filter(Boolean) as FhirResource[];
  const patient: any = resources.find((r) => r.resourceType === 'Patient');
  const docs = resources.filter((r) => r.resourceType === 'DocumentReference');
  const rest = resources.filter((r) => r.resourceType !== 'Patient' && r.resourceType !== 'DocumentReference');

  const byType = new Map<string, FhirResource[]>();
  for (const r of rest) {
    const list = byType.get(r.resourceType) ?? [];
    list.push(r);
    byType.set(r.resourceType, list);
  }
  const order = [...SECTION_ORDER.filter((t) => byType.has(t)), ...[...byType.keys()].filter((t) => !SECTION_ORDER.includes(t))];
  // a group where no resource describes itself is noise as rows — show it as a count
  const collapsed = order.filter((t) => byType.get(t)!.every((r) => !describe(r)));
  const expanded = order.filter((t) => !collapsed.includes(t));

  const name = patient?.name?.[0];
  const display = name?.text ?? [name?.given?.join(' '), name?.family].filter(Boolean).join(' ');

  return (
    <div className="bundle-view">
      {patient && (
        <div className="pt-card">
          <div className="pt-name">{display || 'Patient'}</div>
          <div className="doc-meta">
            {[patient.birthDate && `DOB ${patient.birthDate}`, patient.gender].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}

      <div className="bundle-actions">
        <button type="button" className="btn-mini" onClick={() => openBundleJson(bundle)}>
          Open FHIR bundle (JSON)
        </button>
      </div>

      {docs.length > 0 && (
        <>
          <p className="eyebrow-label">Documents</p>
          <ul className="res-list">
            {[...docs]
              .sort((a: any, b: any) => docRank(a) - docRank(b))
              .map((d: any, i) => {
              const att = d.content?.[0]?.attachment;
              return (
                <li key={d.id ?? i} className="doc-row">
                  <span>
                    <span className="res-primary">
                      {docBadge(d) && <span className="doc-pill">{docBadge(d)}</span>}
                      {cc(d.type) || 'Document'}
                    </span>
                    <span className="res-secondary">{[when(d.date), att?.contentType].filter(Boolean).join(' · ')}</span>
                  </span>
                  {att?.data ? (
                    <button type="button" className="btn-mini" onClick={() => openDoc(d)}>Open ↗</button>
                  ) : (
                    <span className="res-secondary">(no content)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {expanded.map((type) => (
        <div key={type}>
          <p className="eyebrow-label">{SECTION_TITLE[type] ?? type} ({byType.get(type)!.length})</p>
          <ul className="res-list">
            {byType.get(type)!.map((r, i) => {
              const d = describe(r);
              return (
                <li key={r.id ?? i}>
                  <span className="res-primary">{d?.primary || r.resourceType}</span>
                  {d?.secondary && <span className="res-secondary">{d.secondary}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {collapsed.length > 0 && (
        <p className="doc-meta" style={{ marginTop: 12 }}>
          Also included: {collapsed.map((t) => `${byType.get(t)!.length} × ${t}`).join(', ')} — full
          detail in the FHIR bundle.
        </p>
      )}
    </div>
  );
}
