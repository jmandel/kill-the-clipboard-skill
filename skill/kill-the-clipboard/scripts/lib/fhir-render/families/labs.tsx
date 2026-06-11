// labs family — Laboratory & Clinical Results (DESIGN.md §7, contract ../README.md).
// One results table: DiagnosticReports are bold grouping rows with their member
// Observations indented beneath (result entries that don't resolve to a shared resource
// still get a display-only row, so the report reads complete); standalone Observations
// interleave with report groups, all most-recent-first. Specimens fold into a compact
// trailing table. Epic's system-less "Lab" category coding routes here by design.
import type * as React from "react";
import type { FamilyRenderer } from "../types.ts";
import { badge, para, table, type Cell, type Column, type Span, type Theme } from "../engine.ts";

const LAB_OBS_CATEGORIES = new Set(["laboratory", "lab", "imaging", "procedure", "clinical-test"]);
const LAB_REPORT_CATEGORIES = new Set(["lab", "laboratory"]);

const categoryStrings = (r: any): string[] =>
  (Array.isArray(r?.category) ? r.category : [])
    .flatMap((c: any) => [...(Array.isArray(c?.coding) ? c.coding.map((x: any) => x?.code) : []), c?.text])
    .filter((x: any): x is string => typeof x === "string");

const concept = (cc: any): string => {
  if (typeof cc?.text === "string" && cc.text) return cc.text;
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  for (const c of codings) if (typeof c?.display === "string" && c.display) return c.display;
  for (const c of codings) if (typeof c?.code === "string" && c.code) return c.code;
  return "";
};

const fmtDate = (v: any): string => (typeof v === "string" ? v.slice(0, 10) : "");

const quantity = (q: any): string => {
  if (q == null || typeof q !== "object") return "";
  const value = q.value != null ? String(q.value) : "";
  const unit = typeof q.unit === "string" && q.unit ? q.unit : typeof q.code === "string" ? q.code : "";
  const cmp = typeof q.comparator === "string" ? q.comparator : "";
  return `${cmp}${value}${unit ? ` ${unit}` : ""}`.trim();
};

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const noteText = (r: any, max = 300): string =>
  truncate(
    (Array.isArray(r?.note) ? r.note : [])
      .map((n: any) => n?.text)
      .filter((x: any): x is string => typeof x === "string" && x.length > 0)
      .join(" "),
    max,
  );

// Boolean lab values are presence tests; bare "true" is meaningless next to the test name.
function valueSpans(src: any): Span[] {
  if (src?.valueQuantity != null) return [{ text: quantity(src.valueQuantity) || "—" }];
  if (src?.valueCodeableConcept != null) return [{ text: concept(src.valueCodeableConcept) || "—" }];
  if (typeof src?.valueString === "string") return [{ text: src.valueString }];
  if (typeof src?.valueBoolean === "boolean") return [{ text: src.valueBoolean ? "Positive" : "Negative" }];
  if (typeof src?.valueInteger === "number") return [{ text: String(src.valueInteger) }];
  if (src?.valueRatio != null) {
    const n = src.valueRatio?.numerator?.value;
    const d = src.valueRatio?.denominator?.value;
    // Titers read as 1:160, never as a fraction (fixture NOTES.md).
    if (n != null && d != null) return [{ text: `${n}:${d}` }];
    const parts = [quantity(src.valueRatio?.numerator), quantity(src.valueRatio?.denominator)].filter(Boolean);
    return [{ text: parts.join(" : ") || "—" }];
  }
  if (src?.valueRange != null) {
    const lo = quantity(src.valueRange?.low);
    const hi = quantity(src.valueRange?.high);
    return [{ text: [lo, hi].filter(Boolean).join(" – ") || "—" }];
  }
  if (typeof src?.valueTime === "string") return [{ text: src.valueTime }];
  if (typeof src?.valueDateTime === "string") return [{ text: fmtDate(src.valueDateTime) }];
  if (src?.valuePeriod != null) {
    const s = fmtDate(src.valuePeriod?.start);
    const e = fmtDate(src.valuePeriod?.end);
    return [{ text: [s, e].filter(Boolean).join(" – ") || "—" }];
  }
  if (src?.valueSampledData != null) return [{ text: "(sampled data)" }];
  if (src?.dataAbsentReason != null)
    return [{ text: `Not available — ${concept(src.dataAbsentReason) || "reason not given"}` }];
  const comps = Array.isArray(src?.component) ? src.component.length : 0;
  if (comps) return [{ text: `see ${comps} component${comps === 1 ? "" : "s"} below` }];
  return [{ text: "—" }];
}

const referenceRange = (src: any): string =>
  (Array.isArray(src?.referenceRange) ? src.referenceRange : [])
    .map((rr: any) => {
      if (typeof rr?.text === "string" && rr.text) return rr.text;
      const lo = quantity(rr?.low);
      const hi = quantity(rr?.high);
      if (lo && hi) return `${lo} – ${hi}`;
      if (lo) return `≥ ${lo}`;
      if (hi) return `≤ ${hi}`;
      return "";
    })
    .filter(Boolean)
    .join("; ");

const INTERP: Record<string, { label: string; kind: string }> = {
  H: { label: "HIGH", kind: "HIGH" },
  HH: { label: "CRIT HIGH", kind: "HIGH" },
  HU: { label: "HIGH", kind: "HIGH" },
  HIGH: { label: "HIGH", kind: "HIGH" },
  L: { label: "LOW", kind: "LOW" },
  LL: { label: "CRIT LOW", kind: "LOW" },
  LU: { label: "LOW", kind: "LOW" },
  LOW: { label: "LOW", kind: "LOW" },
  A: { label: "ABNORMAL", kind: "HIGH" },
  AA: { label: "CRIT ABN", kind: "HIGH" },
  ABN: { label: "ABNORMAL", kind: "HIGH" },
  ABNORMAL: { label: "ABNORMAL", kind: "HIGH" },
  POS: { label: "POSITIVE", kind: "HIGH" },
  POSITIVE: { label: "POSITIVE", kind: "HIGH" },
  DET: { label: "DETECTED", kind: "HIGH" },
  DETECTED: { label: "DETECTED", kind: "HIGH" },
  R: { label: "RESISTANT", kind: "HIGH" },
  N: { label: "NORMAL", kind: "NORMAL" },
  NORMAL: { label: "NORMAL", kind: "NORMAL" },
  NEG: { label: "NEGATIVE", kind: "NORMAL" },
  NEGATIVE: { label: "NEGATIVE", kind: "NORMAL" },
  ND: { label: "NOT DET", kind: "NORMAL" },
  S: { label: "SUSCEPT", kind: "NORMAL" },
};

function interpInfo(src: any): { label: string; kind: string } | null {
  for (const cc of Array.isArray(src?.interpretation) ? src.interpretation : []) {
    for (const c of Array.isArray(cc?.coding) ? cc.coding : []) {
      if (typeof c?.code === "string" && INTERP[c.code.toUpperCase()]) return INTERP[c.code.toUpperCase()]!;
    }
    const label = concept(cc);
    if (label) return INTERP[label.toUpperCase()] ?? { label: truncate(label.toUpperCase(), 12), kind: "unable-to-assess" };
  }
  return null;
}

const flaggable = (info: { kind: string } | null): boolean => info?.kind === "HIGH" || info?.kind === "LOW";

const REPORT_STATUS: Record<string, { label: string; kind: string }> = {
  final: { label: "FINAL", kind: "completed" },
  preliminary: { label: "PRELIM", kind: "unable-to-assess" },
  partial: { label: "PARTIAL", kind: "unable-to-assess" },
  registered: { label: "REGISTERED", kind: "inactive" },
  corrected: { label: "CORRECTED", kind: "completed" },
  amended: { label: "AMENDED", kind: "completed" },
  appended: { label: "APPENDED", kind: "completed" },
  cancelled: { label: "CANCELLED", kind: "stopped" },
  "entered-in-error": { label: "ERROR", kind: "stopped" },
};

const obsDate = (o: any): string =>
  fmtDate(o?.effectiveDateTime ?? o?.effectivePeriod?.start ?? o?.effectiveInstant ?? o?.issued);
const reportDate = (r: any): string =>
  fmtDate(r?.effectiveDateTime ?? r?.effectivePeriod?.start ?? r?.effectiveInstant ?? r?.issued);
const dateKey = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

const refLabel = (ref: any, contained: any[]): string => {
  if (typeof ref?.display === "string" && ref.display) return ref.display;
  const raw = typeof ref?.reference === "string" ? ref.reference : "";
  if (raw.startsWith("#")) {
    const c = contained.find((x: any) => x?.id === raw.slice(1));
    if (typeof c?.name === "string" && c.name) return c.name;
  }
  return raw.split("/").pop() ?? "";
};

function resolveMember(res: any, rep: any, obsById: Map<string, any>): any | null {
  const raw = typeof res?.reference === "string" ? res.reference : "";
  if (!raw) return null;
  if (raw.startsWith("#")) {
    const c = (Array.isArray(rep?.contained) ? rep.contained : []).find((x: any) => x?.id === raw.slice(1));
    return c?.resourceType === "Observation" ? c : null;
  }
  const tail = raw.replace(/^urn:uuid:/, "").split("/").pop();
  return tail != null ? (obsById.get(tail) ?? null) : null;
}

type Push = (row: Cell[], flagged: boolean) => void;

// react-pdf trims leading ASCII spaces; NBSPs keep member/component rows visibly nested.
const INDENT = "    ";

function obsRows(o: any, t: Theme, indent: boolean, push: Push): void {
  const pad = indent ? INDENT : "";
  const name = concept(o?.code) || String(o?.id ?? "(unnamed test)");
  const testSpans: Span[] = [{ text: `${pad}${name}` }];
  if (typeof o?.status === "string" && o.status && o.status !== "final")
    testSpans.push({ text: ` (${o.status})` });
  const value = valueSpans(o);
  const note = noteText(o);
  if (note) value.push({ text: ` — ${note}` });
  const info = interpInfo(o);
  push([testSpans, value, referenceRange(o), info ? badge(t, info.label, info.kind) : "", obsDate(o)], flaggable(info));

  for (const comp of Array.isArray(o?.component) ? o.component : []) {
    try {
      const cInfo = interpInfo(comp);
      push(
        [
          [{ text: `${pad}  · ${concept(comp?.code) || "(component)"}` }],
          valueSpans(comp),
          referenceRange(comp),
          cInfo ? badge(t, cInfo.label, cInfo.kind) : "",
          "",
        ],
        flaggable(cInfo),
      );
    } catch {
      push([[{ text: `${pad}  · (component could not be read)` }], "—", "", "", ""], false);
    }
  }
}

function reportRows(rep: any, t: Theme, members: (any | null)[], push: Push): void {
  const contained = Array.isArray(rep?.contained) ? rep.contained : [];
  const name = concept(rep?.code) || String(rep?.id ?? "(report)");
  const performers = [
    ...(Array.isArray(rep?.performer) ? rep.performer : []),
    ...(Array.isArray(rep?.resultsInterpreter) ? rep.resultsInterpreter : []),
  ]
    .map((p: any) => refLabel(p, contained))
    .filter(Boolean);
  const resultSpans: Span[] = [{ text: "Lab report" }];
  if (performers.length) resultSpans.push({ text: ` — ${performers.join("; ")}` });
  const status = typeof rep?.status === "string" ? rep.status : "";
  const sb = REPORT_STATUS[status] ?? (status ? { label: truncate(status.toUpperCase(), 12), kind: "inactive" } : null);
  push([[{ text: name, bold: true }], resultSpans, "", sb ? badge(t, sb.label, sb.kind) : "", reportDate(rep)], false);

  const results = Array.isArray(rep?.result) ? rep.result : [];
  for (let i = 0; i < results.length; i++) {
    const member = members[i];
    if (member) {
      try {
        obsRows(member, t, true, push);
      } catch {
        push([[{ text: INDENT + String(member?.id ?? "(result)") }], "—", "", "", ""], false);
      }
    } else {
      const label = refLabel(results[i], contained) || "(result)";
      push([[{ text: INDENT + label }], "—", "", "", ""], false);
    }
  }

  const conclusions = [
    typeof rep?.conclusion === "string" ? rep.conclusion : "",
    ...(Array.isArray(rep?.conclusionCode) ? rep.conclusionCode.map(concept) : []),
  ]
    .filter(Boolean)
    .join("; ");
  if (conclusions)
    push([[{ text: INDENT + "Conclusion" }], [{ text: truncate(conclusions, 300) }], "", "", ""], false);
}

function specimenRow(s: any): Cell[] {
  const typeSpans: Span[] = [{ text: concept(s?.type) || String(s?.id ?? "(specimen)") }];
  if (typeof s?.status === "string" && s.status && s.status !== "available")
    typeSpans.push({ text: ` (${s.status})` });
  const col = s?.collection ?? {};
  const collected = fmtDate(col?.collectedDateTime ?? col?.collectedPeriod?.start ?? s?.receivedTime);
  const details: string[] = [];
  for (const d of [concept(col?.method), concept(col?.bodySite), quantity(col?.quantity)]) if (d) details.push(d);
  if (typeof col?.collector?.display === "string" && col.collector.display)
    details.push(`collected by ${col.collector.display}`);
  for (const c of Array.isArray(s?.container) ? s.container : []) {
    const d = (typeof c?.description === "string" && c.description) || concept(c?.type);
    if (d) details.push(d);
  }
  for (const c of Array.isArray(s?.condition) ? s.condition : []) if (concept(c)) details.push(concept(c));
  const note = noteText(s, 220);
  if (note) details.push(note);
  const acc = s?.accessionIdentifier?.value ?? (Array.isArray(s?.identifier) ? s.identifier[0]?.value : undefined);
  return [typeSpans, collected, details.join(" · "), acc != null ? String(acc) : ""];
}

const RESULT_COLUMNS: Column[] = [
  { header: "Test", width: 3.2 },
  { header: "Result", width: 2.9 },
  { header: "Reference Range", width: 1.6 },
  { header: "Flag", width: 1.0, align: "center" },
  { header: "Date", width: 1.2 },
];

const SPECIMEN_COLUMNS: Column[] = [
  { header: "Specimen", width: 2.0 },
  { header: "Collected", width: 1.1 },
  { header: "Collection details", width: 5.0 },
  { header: "Accession", width: 1.6 },
];

const labs: FamilyRenderer = {
  key: "labs",
  title: "Laboratory & Clinical Results",
  order: 70,
  claims(r: any): boolean {
    const rt = r?.resourceType;
    if (rt === "Specimen") return true;
    if (rt !== "Observation" && rt !== "DiagnosticReport") return false;
    const cats = categoryStrings(r).map((s) => s.toLowerCase());
    return cats.some((c) => (rt === "Observation" ? LAB_OBS_CATEGORIES : LAB_REPORT_CATEGORIES).has(c));
  },
  render(resources: any[], t: Theme): React.ReactElement[] {
    try {
      const obs: any[] = [];
      const reports: any[] = [];
      const specimens: any[] = [];
      const other: any[] = [];
      for (const r of Array.isArray(resources) ? resources : []) {
        const rt = r?.resourceType;
        if (rt === "Observation") obs.push(r);
        else if (rt === "DiagnosticReport") reports.push(r);
        else if (rt === "Specimen") specimens.push(r);
        else other.push(r);
      }

      const obsById = new Map<string, any>();
      for (const o of obs) if (o?.id != null) obsById.set(String(o.id), o);

      // First report to reference an Observation owns it (one row per instance); later
      // references — amplified clones included — fall back to display-only rows.
      const owned = new Set<any>();
      const memberLists = new Map<any, (any | null)[]>();
      for (const rep of reports) {
        memberLists.set(
          rep,
          (Array.isArray(rep?.result) ? rep.result : []).map((res: any) => {
            try {
              const m = resolveMember(res, rep, obsById);
              if (m && !owned.has(m)) {
                owned.add(m);
                return m;
              }
            } catch {}
            return null;
          }),
        );
      }

      type Unit = { date: number; src: any; build: (push: Push) => void };
      const units: Unit[] = [
        ...reports.map((rep) => ({
          date: dateKey(reportDate(rep)),
          src: rep,
          build: (push: Push) => reportRows(rep, t, memberLists.get(rep) ?? [], push),
        })),
        ...obs
          .filter((o) => !owned.has(o))
          .map((o) => ({ date: dateKey(obsDate(o)), src: o, build: (push: Push) => obsRows(o, t, false, push) })),
        ...other.map((r) => ({
          date: Number.NEGATIVE_INFINITY,
          src: r,
          build: (push: Push) =>
            push(
              [
                [{ text: String(r?.resourceType ?? "(unrecognized record)") + (r?.id != null ? ` ${r.id}` : "") }],
                [{ text: "could not be read" }],
                "",
                "",
                "",
              ],
              false,
            ),
        })),
      ].sort((a, b) => b.date - a.date);

      const rows: Cell[][] = [];
      const flags: boolean[] = [];
      const push: Push = (row, flagged) => {
        rows.push(row);
        flags.push(flagged);
      };
      for (const u of units) {
        try {
          u.build(push);
        } catch {
          push([[{ text: String(u.src?.id ?? "(record could not be read)") }], "—", "", "", ""], false);
        }
      }

      const out: React.ReactElement[] = [];
      if (rows.length)
        out.push(table(t, { columns: RESULT_COLUMNS, rows, flagRow: (_row, i) => flags[i] === true }));
      else if (!specimens.length) out.push(para(t, "No laboratory results in this record.", { muted: true }));

      if (specimens.length) {
        const sRows = specimens
          .map((s) => {
            try {
              return { date: dateKey(fmtDate(s?.collection?.collectedDateTime ?? s?.receivedTime)), row: specimenRow(s) };
            } catch {
              return { date: Number.NEGATIVE_INFINITY, row: [String(s?.id ?? "(specimen)"), "", "could not be read", ""] as Cell[] };
            }
          })
          .sort((a, b) => b.date - a.date)
          .map((x) => x.row);
        // No standalone sub-heading: para has no keep-with-next, so it can orphan at a
        // page break; the specimen table's own header row labels the block sufficiently.
        out.push(table(t, { columns: SPECIMEN_COLUMNS, rows: sRows }));
      }
      return out;
    } catch (e) {
      return [para(t, `Laboratory section could not be rendered: ${e instanceof Error ? e.message : String(e)}`, { muted: true })];
    }
  },
};

export default labs;
