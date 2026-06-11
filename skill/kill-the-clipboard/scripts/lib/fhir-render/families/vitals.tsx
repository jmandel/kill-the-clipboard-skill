// Vital Signs family (DESIGN §7 volume rule): one table row per Observation instance,
// grouped by code with groups ordered most-recent-first; panels (hasMember) claim their
// resolvable sibling members into a grouped block so every instance renders exactly once,
// never twice and never dropped. All extraction is hostile-safe: a malformed resource
// degrades only its own row.
import type { ReactElement } from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { type Cell, type Span, badge, para, table } from "../engine.ts";

// Epic emits non-standard category spellings ("Vitals") alongside or instead of the
// terminology code; accepting them here keeps such rows out of the social catch-all.
const VITAL_CATEGORY = new Set(["vital-signs", "vitals", "vital signs"]);
// LOINC systolic/diastolic pairs: point-in-time (us-core-blood-pressure) and mean
// (us-core-average-blood-pressure). Detected per component so "120/80 mmHg" renders
// even though BP profiles carry no top-level value.
const SYSTOLIC = new Set(["8480-6", "96608-5"]);
const DIASTOLIC = new Set(["8462-4", "96609-3"]);
// Cosmetic de-UCUM only — never invent a unit, and prefer Quantity.unit verbatim.
const UNIT_PRETTY: Record<string, string> = { "mm[Hg]": "mmHg" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_BADGE_KIND: Record<string, string> = {
  amended: "completed",
  corrected: "completed",
  preliminary: "unable-to-assess",
  registered: "inactive",
  cancelled: "stopped",
  "entered-in-error": "stopped",
};

const COLUMNS = [
  { header: "Vital", width: 2.3 },
  { header: "Value", width: 3.9 },
  { header: "Date", width: 1.6 },
  { header: "Status", width: 1.2 },
];

function categoryTokens(r: any): string[] {
  const cats = Array.isArray(r?.category) ? r.category : [];
  return cats
    .flatMap((c: any) => [...(Array.isArray(c?.coding) ? c.coding.map((x: any) => x?.code) : []), c?.text])
    .filter((x: any): x is string => typeof x === "string");
}

function systemHint(system: unknown): string {
  if (typeof system !== "string") return "";
  if (/loinc\.org/i.test(system)) return "LOINC ";
  if (/snomed/i.test(system)) return "SNOMED ";
  return "";
}

function conceptLabel(cc: any, fallback = ""): string {
  if (typeof cc?.text === "string" && cc.text.trim()) return cc.text;
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  const withDisplay = codings.find((c: any) => typeof c?.display === "string" && c.display.trim());
  if (withDisplay) return withDisplay.display;
  const withCode = codings.find((c: any) => typeof c?.code === "string" && c.code.trim());
  if (withCode) return `${systemHint(withCode.system)}${withCode.code}`;
  return fallback;
}

function unitOf(q: any): string {
  const u = typeof q?.unit === "string" && q.unit ? q.unit : typeof q?.code === "string" ? q.code : "";
  return UNIT_PRETTY[u] ?? u;
}

function fmtQty(q: any): string {
  const v = q?.value != null ? String(q.value) : "";
  const u = unitOf(q);
  const cmp = typeof q?.comparator === "string" ? q.comparator : "";
  if (!v && !u) return "";
  return u === "%" ? `${cmp}${v}%` : [cmp + v, u].filter(Boolean).join(" ").trim();
}

function fmtDate(s: unknown): string {
  if (typeof s !== "string") return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return s;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${mon} ${Number(m[3])}, ${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`;
}

function fmtWhen(r: any): string {
  if (typeof r?.effectiveDateTime === "string") return fmtDate(r.effectiveDateTime);
  if (typeof r?.effectiveInstant === "string") return fmtDate(r.effectiveInstant);
  const p = r?.effectivePeriod;
  if (p && (p.start || p.end)) return [fmtDate(p.start), fmtDate(p.end)].filter(Boolean).join(" – ");
  if (typeof r?.issued === "string") return fmtDate(r.issued);
  return "";
}

function sortKeyOf(r: any): string {
  for (const v of [r?.effectiveDateTime, r?.effectiveInstant, r?.effectivePeriod?.end, r?.effectivePeriod?.start, r?.issued]) {
    if (typeof v === "string") return v;
  }
  return "";
}

function interpretations(o: any): string[] {
  const arr = Array.isArray(o?.interpretation) ? o.interpretation : [];
  return arr.map((cc: any) => conceptLabel(cc)).filter(Boolean);
}

function codesOf(cc: any): string[] {
  return (Array.isArray(cc?.coding) ? cc.coding : []).map((c: any) => c?.code).filter((x: any) => typeof x === "string");
}

function fmtValue(o: any): string {
  if (o?.valueQuantity) return fmtQty(o.valueQuantity);
  if (o?.valueCodeableConcept) return conceptLabel(o.valueCodeableConcept);
  if (typeof o?.valueString === "string") return o.valueString;
  if (typeof o?.valueBoolean === "boolean") return o.valueBoolean ? "Yes" : "No";
  if (typeof o?.valueInteger === "number") return String(o.valueInteger);
  if (o?.valueRatio) return `${fmtQty(o.valueRatio.numerator) || "?"} : ${fmtQty(o.valueRatio.denominator) || "?"}`;
  if (o?.valueRange) return [fmtQty(o.valueRange.low), fmtQty(o.valueRange.high)].filter(Boolean).join(" – ");
  if (typeof o?.valueTime === "string") return o.valueTime;
  if (typeof o?.valueDateTime === "string") return fmtDate(o.valueDateTime);
  if (o?.valuePeriod) return [fmtDate(o.valuePeriod.start), fmtDate(o.valuePeriod.end)].filter(Boolean).join(" – ");
  if (o?.valueSampledData) return "(sampled data)";
  return "";
}

function componentSpans(r: any): Span[] {
  const comps = Array.isArray(r?.component) ? r.component : [];
  if (!comps.length) return [];
  const spans: Span[] = [];
  const sys = comps.find((c: any) => codesOf(c?.code).some((k) => SYSTOLIC.has(k)));
  const dia = comps.find((c: any) => codesOf(c?.code).some((k) => DIASTOLIC.has(k)));
  if (sys || dia) {
    const sideVal = (c: any) => (c?.valueQuantity?.value != null ? String(c.valueQuantity.value) : "—");
    const unit = unitOf(sys?.valueQuantity ?? dia?.valueQuantity);
    spans.push({ text: `${sideVal(sys)}/${sideVal(dia)}${unit ? ` ${unit}` : ""}` });
    for (const [side, c] of [["systolic", sys], ["diastolic", dia]] as const) {
      if (c && c.valueQuantity?.value == null && c.dataAbsentReason) {
        spans.push({ text: ` (${side}: ${conceptLabel(c.dataAbsentReason, "not recorded")})` });
      }
      const interp = c ? interpretations(c) : [];
      if (interp.length) spans.push({ text: ` — ${interp.join(", ")} (${side})`, bold: true });
    }
  }
  for (const c of comps) {
    if (c === sys || c === dia) continue;
    const label = conceptLabel(c?.code, "component");
    const v = fmtValue(c);
    const dar = !v && c?.dataAbsentReason ? conceptLabel(c.dataAbsentReason, "not recorded") : "";
    const piece = v ? `${label}: ${v}` : dar ? `${label}: ${dar}` : label;
    spans.push({ text: `${spans.length ? " · " : ""}${piece}` });
  }
  return spans;
}

function valueSpans(r: any): Span[] {
  const spans: Span[] = [];
  const top = fmtValue(r);
  if (top) spans.push({ text: top });
  const comp = componentSpans(r);
  if (comp.length) {
    if (spans.length) spans.push({ text: " · " });
    spans.push(...comp);
  }
  if (!spans.length) {
    if (r?.dataAbsentReason) {
      spans.push({ text: `Not recorded — ${conceptLabel(r.dataAbsentReason, "no reason given")}` });
    } else if (Array.isArray(r?.hasMember) && r.hasMember.length) {
      spans.push({ text: `Panel of ${r.hasMember.length} measurements` });
    } else {
      spans.push({ text: "—" });
    }
  }
  const interp = interpretations(r);
  if (interp.length) spans.push({ text: ` — ${interp.join(", ")}`, bold: true });
  const notes = Array.isArray(r?.note) ? r.note : [];
  for (const n of notes) {
    if (typeof n?.text !== "string" || !n.text) continue;
    const who = typeof n?.authorString === "string" ? n.authorString : n?.authorReference?.display;
    const meta = [who, typeof n?.time === "string" ? fmtDate(n.time) : ""].filter(Boolean).join(", ");
    spans.push({ text: `\nNote${meta ? ` (${meta})` : ""}: ${n.text}` });
  }
  return spans;
}

interface Rec {
  raw: any;
  id?: string;
  label: string;
  value: Span[];
  when: string;
  sortKey: string;
  status: string;
  isPanel: boolean;
}

function extract(r: any): Rec {
  const id = r?.id != null ? String(r.id) : undefined;
  try {
    return {
      raw: r,
      id,
      label: conceptLabel(r?.code, id ? `Observation ${id}` : "Unlabeled observation"),
      value: valueSpans(r),
      when: fmtWhen(r),
      sortKey: sortKeyOf(r),
      status: typeof r?.status === "string" ? r.status : "",
      isPanel: Array.isArray(r?.hasMember) && r.hasMember.length > 0,
    };
  } catch {
    return {
      raw: r,
      id,
      label: id ? `Observation ${id}` : "Unreadable observation",
      value: [{ text: "—" }],
      when: "",
      sortKey: "",
      status: "",
      isPanel: false,
    };
  }
}

function refId(ref: unknown): string | undefined {
  if (typeof ref !== "string" || !ref) return undefined;
  if (ref.startsWith("#")) return ref.slice(1) || undefined;
  return ref.split("/").filter(Boolean).pop()?.split(":").pop() || undefined;
}

const byRecentFirst = (a: Rec, b: Rec) => b.sortKey.localeCompare(a.sortKey);
const isFlagged = (r: Rec) => r.status === "entered-in-error";

function statusCell(t: Theme, status: string): Cell {
  if (!status || status === "final") return "";
  const label = status === "entered-in-error" ? "entered in error" : status;
  return badge(t, label, STATUS_BADGE_KIND[status] ?? "inactive");
}

function rowOf(t: Theme, rec: Rec): Cell[] {
  return [rec.label, rec.value, rec.when, statusCell(t, rec.status)];
}

function vitalsTable(t: Theme, rows: Cell[][], flags: boolean[]): ReactElement {
  return table(t, { columns: COLUMNS, rows, flagRow: (_row, i) => flags[i] === true });
}

const vitals: FamilyRenderer = {
  key: "vitals",
  title: "Vital Signs",
  order: 60,
  claims(r: any): boolean {
    try {
      return r?.resourceType === "Observation" && categoryTokens(r).some((c) => VITAL_CATEGORY.has(c.toLowerCase()));
    } catch {
      return false;
    }
  },
  render(resources: any[], t: Theme): ReactElement[] {
    const recs = (Array.isArray(resources) ? resources : []).map(extract);
    if (!recs.length) return [];
    const recById = new Map<string, Rec>();
    for (const rec of recs) if (rec.id && !recById.has(rec.id)) recById.set(rec.id, rec);

    // Each panel claims members it can resolve; claim tracking is by Rec identity (not id)
    // so a duplicate-id instance still gets its own main-table row instead of vanishing.
    const panels = recs.filter((x) => x.isPanel).sort(byRecentFirst);
    const claimed = new Set<Rec>();
    const panelMembers = new Map<Rec, { rec?: Rec; fallbackText: string }[]>();
    for (const p of panels) {
      const members = Array.isArray(p.raw?.hasMember) ? p.raw.hasMember : [];
      panelMembers.set(
        p,
        members.map((m: any) => {
          const id = refId(m?.reference);
          const target = id ? recById.get(id) : undefined;
          if (target && target !== p && !target.isPanel && !claimed.has(target)) {
            claimed.add(target);
            return { rec: target, fallbackText: "" };
          }
          const fallbackText =
            (typeof m?.display === "string" && m.display) ||
            (typeof m?.reference === "string" && m.reference) ||
            "(member not specified)";
          return { fallbackText };
        }),
      );
    }

    const blocks: ReactElement[] = [];
    const main = recs.filter((x) => !x.isPanel && !claimed.has(x));
    if (main.length) {
      const groups = new Map<string, Rec[]>();
      for (const rec of main) {
        const k = rec.label.toLowerCase();
        const g = groups.get(k);
        if (g) g.push(rec);
        else groups.set(k, [rec]);
      }
      const ordered = [...groups.values()];
      for (const g of ordered) g.sort(byRecentFirst);
      ordered.sort((a, b) => (b[0]?.sortKey ?? "").localeCompare(a[0]?.sortKey ?? ""));
      const flat = ordered.flat();
      blocks.push(vitalsTable(t, flat.map((r) => rowOf(t, r)), flat.map(isFlagged)));
    }

    for (const p of panels) {
      const heading: Span[] = [{ text: p.label, bold: true }];
      if (p.when) heading.push({ text: `  —  ${p.when}` });
      if (p.status && p.status !== "final") heading.push({ text: `  [${p.status}]`, bold: true });
      blocks.push(para(t, heading, { spaceAfter: 3 }));
      const rows: Cell[][] = [];
      const flags: boolean[] = [];
      for (const m of panelMembers.get(p) ?? []) {
        if (m.rec) {
          rows.push(rowOf(t, m.rec));
          flags.push(isFlagged(m.rec));
        } else {
          rows.push([[{ text: m.fallbackText }], "—", "", ""]);
          flags.push(false);
        }
      }
      if (rows.length) blocks.push(vitalsTable(t, rows, flags));
    }
    return blocks;
  },
};

export default vitals;
