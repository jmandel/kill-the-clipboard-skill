// Procedures family: Procedure + ServiceRequest (orders). Two collection-oriented tables,
// one row per instance, most-recent-first (DESIGN §7). performed[x] supports dateTime,
// Period, Age ("At age 7" — never a date), and verbatim string per us-core-procedure.
import type React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { type Cell, type Span, badge, para, table } from "../engine.ts";

const SYSTEM_LABELS: [RegExp, string][] = [
  [/snomed/i, "SNOMED"],
  [/loinc/i, "LOINC"],
  [/go\/cpt/i, "CPT"],
  [/icd-10/i, "ICD-10-CM"],
  [/icd-9/i, "ICD-9"],
  [/rxnorm/i, "RxNorm"],
];

const sysLabel = (system: any): string => {
  if (typeof system !== "string") return "";
  for (const [re, label] of SYSTEM_LABELS) if (re.test(system)) return label;
  return "";
};

const str = (v: any): string => (typeof v === "string" ? v.trim() : "");

/** Best human text for a CodeableConcept: text > first coding display > system+code. */
const concept = (c: any): string => {
  if (!c || typeof c !== "object") return "";
  if (str(c.text)) return c.text.trim();
  const codings = Array.isArray(c.coding) ? c.coding : [];
  for (const x of codings) if (str(x?.display)) return x.display.trim();
  for (const x of codings) {
    if (x?.code != null) return `${sysLabel(x?.system)} ${String(x.code)}`.trim();
  }
  return "";
};

const conceptList = (arr: any): string =>
  (Array.isArray(arr) ? arr : []).map(concept).filter(Boolean).join("; ");

const refDisplay = (ref: any): string => str(ref?.display) || str(ref?.reference);

const refList = (arr: any): string =>
  (Array.isArray(arr) ? arr : []).map(refDisplay).filter(Boolean).join("; ");

/** Compact terminology trail ("CPT 45378 · SNOMED 73761001") for verifiability. */
const codesLine = (c: any): string =>
  (Array.isArray(c?.coding) ? c.coding : [])
    .slice(0, 3)
    .map((x: any) => (x?.code != null ? `${sysLabel(x?.system)} ${String(x.code)}`.trim() : ""))
    .filter(Boolean)
    .join(" · ");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date(-time) → "Sep 17, 2024", honoring partial precision; non-ISO passes through. */
const fmtDate = (s: any): string => {
  if (typeof s !== "string") return "";
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d] = m;
  if (!mo) return y!;
  const name = MONTHS[Number(mo) - 1] ?? mo;
  if (!d) return `${name} ${y}`;
  return `${name} ${Number(d)}, ${y}`;
};

const fmtPeriod = (p: any): string => {
  const start = fmtDate(p?.start);
  const end = fmtDate(p?.end);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  if (start) return `${start} – ongoing`;
  if (end) return `until ${end}`;
  return "";
};

const fmtQuantity = (q: any): string => {
  if (q?.value == null) return "";
  const unit = str(q?.unit) || str(q?.code);
  return `${q.value}${unit ? ` ${unit}` : ""}`;
};

const fmtAge = (a: any): string => {
  if (a?.value == null) return "";
  const unit = str(a?.unit) || str(a?.code);
  if (/^(years?|yrs?|a)$/i.test(unit) || !unit) return `At age ${a.value}`;
  return `At age ${a.value} ${unit}`;
};

const performedText = (r: any): string => {
  if (str(r?.performedDateTime)) return fmtDate(r.performedDateTime);
  if (r?.performedPeriod) return fmtPeriod(r.performedPeriod);
  if (r?.performedAge) return fmtAge(r.performedAge);
  if (str(r?.performedString)) return r.performedString.trim();
  if (r?.performedRange) {
    const lo = fmtQuantity(r.performedRange.low);
    const hi = fmtQuantity(r.performedRange.high);
    if (lo || hi) return [lo, hi].filter(Boolean).join(" – ");
  }
  return "—";
};

const timingText = (timing: any): string => {
  const lines: string[] = [];
  const codeText = concept(timing?.code);
  const rep = timing?.repeat;
  if (codeText) lines.push(codeText);
  else if (rep?.frequency != null && rep?.period != null) {
    lines.push(`${rep.frequency}× per ${rep.period} ${str(rep.periodUnit)}`.trim());
  }
  const bounds = fmtPeriod(rep?.boundsPeriod);
  if (bounds) lines.push(bounds);
  return lines.join("\n");
};

const occurrenceText = (r: any): string => {
  if (str(r?.occurrenceDateTime)) return fmtDate(r.occurrenceDateTime);
  if (r?.occurrencePeriod) {
    const p = fmtPeriod(r.occurrencePeriod);
    if (p) return p;
  }
  if (r?.occurrenceTiming) {
    const tt = timingText(r.occurrenceTiming);
    if (tt) return tt;
  }
  if (str(r?.authoredOn)) return `ordered ${fmtDate(r.authoredOn)}`;
  return "—";
};

const parseWhen = (s: any): number => {
  if (typeof s !== "string") return Number.NEGATIVE_INFINITY;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  const t2 = Date.parse(s.slice(0, 10));
  return Number.isNaN(t2) ? Number.NEGATIVE_INFINITY : t2;
};

const procWhen = (r: any): number => {
  try {
    return Math.max(
      parseWhen(r?.performedDateTime),
      parseWhen(r?.performedPeriod?.start),
      parseWhen(r?.performedPeriod?.end),
    );
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
};

const orderWhen = (r: any): number => {
  try {
    return Math.max(
      parseWhen(r?.occurrenceDateTime),
      parseWhen(r?.occurrencePeriod?.start),
      parseWhen(r?.occurrenceTiming?.repeat?.boundsPeriod?.start),
      parseWhen(r?.authoredOn),
    );
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
};

const PROC_BADGE: Record<string, string> = {
  completed: "completed",
  "in-progress": "active",
  preparation: "inactive",
  "on-hold": "unable-to-assess",
  "not-done": "stopped",
  stopped: "stopped",
  "entered-in-error": "stopped",
  unknown: "inactive",
};

const SR_BADGE: Record<string, string> = {
  active: "active",
  completed: "completed",
  draft: "inactive",
  "on-hold": "unable-to-assess",
  revoked: "stopped",
  "entered-in-error": "stopped",
  unknown: "inactive",
};

const statusBadge = (t: Theme, status: any, kinds: Record<string, string>) => {
  const s = str(status) || "unknown";
  return badge(t, s.replace(/-/g, " "), kinds[s] ?? "inactive");
};

// No italic: the summary theme's Inter face registers no italic variant (kernel-frozen
// font set) and @react-pdf throws on unresolvable font styles.
const detailSpans = (lines: (string | undefined)[]): Span[] =>
  lines
    .filter((l): l is string => !!l)
    .map((l) => ({ text: `\n${l}` }));

const nameCell = (name: string, details: (string | undefined)[]): Span[] => [
  { text: name || "(no description)", bold: true },
  // A code-only concept already shows "SYSTEM code" as its name; don't repeat it.
  ...detailSpans(details.map((d) => (d === name ? undefined : d))),
];

const noteLines = (notes: any): string[] =>
  (Array.isArray(notes) ? notes : [])
    .map((n) => str(n?.text))
    .filter(Boolean)
    .map((text) => `Note: ${text}`);

const labeled = (label: string, value: string): string | undefined =>
  value ? `${label}: ${value}` : undefined;

const procPerformer = (r: any): string => {
  const lines = (Array.isArray(r?.performer) ? r.performer : [])
    .map((p: any) => {
      const actor = refDisplay(p?.actor);
      if (!actor) return "";
      const fn = concept(p?.function);
      const org = refDisplay(p?.onBehalfOf);
      let line = actor;
      if (fn) line += ` — ${fn}`;
      if (org) line += `\n${org}`;
      return line;
    })
    .filter(Boolean);
  if (lines.length) return lines.join("\n");
  return refDisplay(r?.asserter) || refDisplay(r?.recorder) || "—";
};

const DEGRADED_BADGE = "inactive";

const procRow = (t: Theme, r: any): Cell[] => {
  try {
    const reasons = [conceptList(r?.reasonCode), refList(r?.reasonReference)].filter(Boolean).join("; ");
    return [
      nameCell(concept(r?.code), [
        codesLine(r?.code),
        labeled("Not performed", concept(r?.statusReason)),
        labeled("Reason", reasons),
        labeled("Based on", refList(r?.basedOn)),
        labeled("Outcome", concept(r?.outcome)),
        labeled("Complication", conceptList(r?.complication)),
        labeled("Follow-up", conceptList(r?.followUp)),
        labeled("Location", refDisplay(r?.location)),
        ...noteLines(r?.note),
      ]),
      performedText(r),
      statusBadge(t, r?.status, PROC_BADGE),
      procPerformer(r),
    ];
  } catch {
    return [String(r?.id ?? "(unreadable resource)"), "—", badge(t, "unknown", DEGRADED_BADGE), "—"];
  }
};

const orderRow = (t: Theme, r: any): Cell[] => {
  try {
    const reasons = [conceptList(r?.reasonCode), refList(r?.reasonReference)].filter(Boolean).join("; ");
    return [
      nameCell(concept(r?.code), [
        codesLine(r?.code),
        labeled("Detail", conceptList(r?.orderDetail)),
        labeled("Quantity", fmtQuantity(r?.quantityQuantity)),
        labeled("Priority", str(r?.priority)),
        labeled("Reason", reasons),
        labeled("Performer", refList(r?.performer)),
        labeled("Patient instructions", str(r?.patientInstruction)),
        ...noteLines(r?.note),
      ]),
      occurrenceText(r),
      str(r?.intent) || "—",
      statusBadge(t, r?.status, SR_BADGE),
      refDisplay(r?.requester) || "—",
    ];
  } catch {
    return [String(r?.id ?? "(unreadable resource)"), "—", "—", badge(t, "unknown", DEGRADED_BADGE), "—"];
  }
};

const procedures: FamilyRenderer = {
  key: "procedures",
  title: "Procedures & Orders",
  order: 90,
  claims: (r: any) => r?.resourceType === "Procedure" || r?.resourceType === "ServiceRequest",
  render(resources: any[], t: Theme): React.ReactElement[] {
    const procs: any[] = [];
    const orders: any[] = [];
    const other: any[] = [];
    for (const r of Array.isArray(resources) ? resources : []) {
      if (r?.resourceType === "ServiceRequest") orders.push(r);
      else if (r?.resourceType === "Procedure") procs.push(r);
      else other.push(r);
    }
    procs.sort((a, b) => procWhen(b) - procWhen(a));
    orders.sort((a, b) => orderWhen(b) - orderWhen(a));

    const out: React.ReactElement[] = [];
    const procLike = [...procs, ...other];
    if (procLike.length) {
      if (orders.length) {
        out.push(para(t, [{ text: `Procedures (${procLike.length})`, bold: true }], { spaceAfter: 3 }));
      }
      out.push(
        table(t, {
          columns: [
            { header: "Procedure", width: 4.5 },
            { header: "Performed", width: 1.8 },
            { header: "Status", width: 1.3 },
            { header: "Performer", width: 2.0 },
          ],
          rows: procLike.map((r) => procRow(t, r)),
        }),
      );
    }
    if (orders.length) {
      if (procLike.length) {
        out.push(para(t, [{ text: `Orders & Referrals (${orders.length})`, bold: true }], { spaceAfter: 3 }));
      }
      out.push(
        table(t, {
          columns: [
            { header: "Order", width: 4.1 },
            { header: "Occurrence", width: 1.9 },
            { header: "Intent", width: 1.3 },
            { header: "Status", width: 1.3 },
            { header: "Requester", width: 2.0 },
          ],
          rows: orders.map((r) => orderRow(t, r)),
        }),
      );
    }
    return out;
  },
};

export default procedures;
