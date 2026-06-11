// Allergies family — AllergyIntolerance (US Core us-core-allergyintolerance).
// One table row per instance, most-recent-first; "no known allergy" negation codes
// render as statement lines, never as substance rows (and never as an empty table).
import type * as React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, para, table, type Cell, type Span } from "../engine.ts";

// SNOMED negation situations: "no known (drug|food|environmental|latex) allergy".
const NO_KNOWN_CODES = new Set(["716186003", "409137002", "429625007", "428607008", "716184000"]);

const COLUMNS = [
  { header: "Substance", width: 2.3 },
  { header: "Reaction", width: 3.4 },
  { header: "Criticality", width: 1.0 },
  { header: "Status", width: 1.3 },
  { header: "Recorded", width: 1.2 },
];

function humanize(code: string): string {
  const s = code.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(v: any): string {
  if (typeof v !== "string") return "";
  const m = v.match(/^\d{4}(-\d{2}(-\d{2})?)?/);
  return m ? m[0] : "";
}

const SYSTEM_LABELS: [RegExp, string][] = [
  [/snomed/i, "SNOMED"],
  [/rxnorm/i, "RxNorm"],
  [/loinc/i, "LOINC"],
];

function systemLabel(system: any): string {
  if (typeof system !== "string") return "code";
  for (const [re, label] of SYSTEM_LABELS) if (re.test(system)) return label;
  return "code";
}

function codings(c: any): any[] {
  return Array.isArray(c?.coding) ? c.coding : [];
}

/** Best human text for a CodeableConcept; degrades to "SNOMED 111088007" for code-only codings. */
function conceptText(c: any): string {
  if (!c || typeof c !== "object") return "";
  if (typeof c.text === "string" && c.text.trim()) return c.text.trim();
  for (const x of codings(c)) if (typeof x?.display === "string" && x.display.trim()) return x.display.trim();
  for (const x of codings(c)) if (typeof x?.code === "string" && x.code) return `${systemLabel(x.system)} ${x.code}`;
  return "";
}

/** Like conceptText but bare codes are humanized, not system-prefixed (status concepts). */
function statusLabel(c: any): string {
  if (!c || typeof c !== "object") return "";
  if (typeof c.text === "string" && c.text.trim()) return c.text.trim();
  for (const x of codings(c)) if (typeof x?.display === "string" && x.display.trim()) return x.display.trim();
  for (const x of codings(c)) if (typeof x?.code === "string" && x.code) return humanize(x.code);
  return "";
}

function firstCode(c: any): string {
  for (const x of codings(c)) if (typeof x?.code === "string" && x.code) return x.code;
  return "";
}

function isNoKnown(r: any): boolean {
  try {
    if (codings(r?.code).some((x: any) => NO_KNOWN_CODES.has(x?.code))) return true;
    return /^no known .{0,20}allerg/i.test(conceptText(r?.code));
  } catch {
    return false;
  }
}

function onsetText(r: any): string {
  const d = fmtDate(r?.onsetDateTime);
  if (d) return d;
  const a = r?.onsetAge;
  if (a && typeof a === "object" && a.value != null) {
    const unit = typeof a.unit === "string" ? a.unit : typeof a.code === "string" ? a.code : "";
    return `age ${a.value}${unit ? ` ${unit}` : ""}`;
  }
  if (typeof r?.onsetString === "string" && r.onsetString.trim()) return r.onsetString.trim();
  const p = r?.onsetPeriod;
  if (p && typeof p === "object") {
    const parts = [fmtDate(p.start), fmtDate(p.end)].filter(Boolean);
    if (parts.length) return parts.join(" – ");
  }
  return "";
}

function substanceSpans(r: any): Span[] {
  const name = conceptText(r?.code) || "(substance not specified)";
  const sub: string[] = [];
  for (const cat of Array.isArray(r?.category) ? r.category : []) {
    if (typeof cat === "string" && cat) sub.push(cat);
  }
  if (r?.type === "intolerance") sub.push("intolerance");
  const onset = onsetText(r);
  if (onset) sub.push(`onset ${onset}`);
  const last = fmtDate(r?.lastOccurrence);
  if (last) sub.push(`last ${last}`);
  const spans: Span[] = [{ text: name, bold: true }];
  if (sub.length) spans.push({ text: `\n${sub.join(" · ")}` });
  return spans;
}

function reactionSpans(r: any): Span[] {
  const spans: Span[] = [];
  const nl = () => spans.length && spans.push({ text: "\n" });
  for (const rx of Array.isArray(r?.reaction) ? r.reaction : []) {
    if (!rx || typeof rx !== "object") continue;
    nl();
    const manifest = (Array.isArray(rx.manifestation) ? rx.manifestation : [])
      .map(conceptText)
      .filter(Boolean)
      .join(", ");
    spans.push({ text: manifest || "Reaction reported" });
    const quals: string[] = [];
    if (typeof rx.severity === "string" && rx.severity) quals.push(humanize(rx.severity));
    const route = conceptText(rx.exposureRoute);
    if (route) quals.push(route);
    const when = fmtDate(rx.onset);
    if (when) quals.push(when);
    if (quals.length) spans.push({ text: ` — ${quals.join(", ")}`, bold: rx.severity === "severe" });
    const sub = conceptText(rx.substance);
    if (sub) {
      nl();
      spans.push({ text: `to ${sub}` });
    }
    if (typeof rx.description === "string" && rx.description.trim()) {
      nl();
      spans.push({ text: rx.description.trim() });
    }
  }
  for (const n of Array.isArray(r?.note) ? r.note : []) {
    const text = typeof n?.text === "string" ? n.text.trim() : "";
    if (!text) continue;
    nl();
    const author = typeof n?.authorString === "string" && n.authorString.trim() ? ` (${n.authorString.trim()})` : "";
    spans.push({ text: `Note${author}: `, bold: true });
    spans.push({ text });
  }
  if (!spans.length) spans.push({ text: "None recorded" });
  return spans;
}

function statusSpans(r: any): Span[] {
  const clinical = statusLabel(r?.clinicalStatus);
  const verification = statusLabel(r?.verificationStatus);
  const spans: Span[] = [];
  if (clinical) spans.push({ text: clinical });
  if (verification && firstCode(r?.verificationStatus) !== "confirmed") {
    spans.push({ text: `${clinical ? "\n" : ""}${verification}` });
  }
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function recordedSpans(r: any): Span[] {
  const spans: Span[] = [];
  const date = fmtDate(r?.recordedDate);
  if (date) spans.push({ text: date });
  const by = typeof r?.recorder?.display === "string" ? r.recorder.display.trim() : "";
  if (by) spans.push({ text: `${date ? "\n" : ""}${by}` });
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function rowFor(r: any, t: Theme): Cell[] {
  try {
    const crit = typeof r?.criticality === "string" && r.criticality ? r.criticality : "";
    const critCell: Cell = crit ? badge(t, crit === "unable-to-assess" ? "unable to assess" : crit, crit) : "—";
    return [substanceSpans(r), reactionSpans(r), critCell, statusSpans(r), recordedSpans(r)];
  } catch {
    let label = "AllergyIntolerance (could not be displayed)";
    try {
      if (r?.id != null) label = `AllergyIntolerance/${String(r.id)} (could not be displayed)`;
    } catch {}
    return [[{ text: label }], "", "", "", ""];
  }
}

function noKnownStatement(r: any, t: Theme): React.ReactElement {
  try {
    const name = conceptText(r?.code) || "No known allergies";
    const tail: string[] = [];
    const clinical = statusLabel(r?.clinicalStatus);
    const verification = statusLabel(r?.verificationStatus);
    if (clinical) tail.push(clinical.toLowerCase());
    if (verification) tail.push(verification.toLowerCase());
    const date = fmtDate(r?.recordedDate);
    const by = typeof r?.recorder?.display === "string" ? r.recorder.display.trim() : "";
    if (date || by) tail.push(`recorded${date ? ` ${date}` : ""}${by ? ` by ${by}` : ""}`);
    const spans: Span[] = [{ text: name, bold: true }];
    if (tail.length) spans.push({ text: ` — ${tail.join(" · ")}` });
    return para(t, spans, { spaceAfter: 4 });
  } catch {
    return para(t, [{ text: "No known allergies (details could not be displayed)" }], { spaceAfter: 4 });
  }
}

function sortKey(r: any): string {
  try {
    return fmtDate(r?.recordedDate) || fmtDate(r?.onsetDateTime) || fmtDate(r?.lastOccurrence) || "";
  } catch {
    return "";
  }
}

const allergies: FamilyRenderer = {
  key: "allergies",
  title: "Allergies",
  order: 40,
  claims: (r: any) => r?.resourceType === "AllergyIntolerance",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const list = Array.isArray(resources) ? resources : [];
    const statements: any[] = [];
    const entries: any[] = [];
    for (const r of list) (isNoKnown(r) ? statements : entries).push(r);

    const els: React.ReactElement[] = [];
    for (const r of statements) els.push(noKnownStatement(r, theme));

    if (entries.length) {
      const rows = entries
        .map((r) => ({ r, key: sortKey(r) }))
        .sort((a, b) => b.key.localeCompare(a.key))
        .map(({ r }) => rowFor(r, theme));
      els.push(table(theme, { columns: COLUMNS, rows }));
    }
    return els;
  },
};

export default allergies;
