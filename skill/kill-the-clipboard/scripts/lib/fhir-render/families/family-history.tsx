// Family History family — FamilyMemberHistory (US Core us-core-familymemberhistory).
// One table row per family member, most-recent-first by recorded date. The member axis
// is `relationship` (name is optional and may be CJK); deceased[x] is a 3-way switch
// where `deceasedBoolean: false` must show NO death marker; health-unknown records with
// a resource-level dataAbsentReason render the reason, never a silently empty cell.
import type * as React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, table, type Cell, type Span } from "../engine.ts";

// The document fonts (Inter/Source Serif) carry no CJK or other far-plane glyphs: an
// unrenderable run garbles its whole line AND the PDF text layer, so non-Latin runs are
// never printed — they collapse to a worded placeholder (patient-family policy).
const NON_LATIN_RUN = /[\u2E80-\uFFFD\u{10000}-\u{10FFFF}]+/gu;
const FOREIGN_MARK = "[non-Latin text]";

function latinSafe(s: string): string {
  if (!s.match(NON_LATIN_RUN)) return s;
  return s
    .replace(NON_LATIN_RUN, FOREIGN_MARK)
    .replace(/\[non-Latin text\](?:[\s,;·—–-]*\[non-Latin text\])+/g, FOREIGN_MARK)
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Status must fit the widest badge label ("HEALTH UNKNOWN") without wrapping the chip.
const COLUMNS = [
  { header: "Family Member", width: 2.2 },
  { header: "Conditions", width: 3.55 },
  { header: "Status", width: 1.4 },
  { header: "Recorded", width: 1.05 },
];

const STATUS_BADGE: Record<string, { label: string; kind: string }> = {
  completed: { label: "completed", kind: "completed" },
  partial: { label: "partial", kind: "unable-to-assess" },
  "health-unknown": { label: "health unknown", kind: "inactive" },
  "entered-in-error": { label: "entered in error", kind: "stopped" },
};

function fmtDate(v: any): string {
  if (typeof v !== "string") return "";
  const m = v.match(/^\d{4}(-\d{2}(-\d{2})?)?/);
  return m ? m[0] : "";
}

function codings(c: any): any[] {
  return Array.isArray(c?.coding) ? c.coding : [];
}

function conceptText(c: any): string {
  if (!c || typeof c !== "object") return "";
  if (typeof c.text === "string" && c.text.trim()) return latinSafe(c.text.trim());
  for (const x of codings(c)) if (typeof x?.display === "string" && x.display.trim()) return latinSafe(x.display.trim());
  for (const x of codings(c)) if (typeof x?.code === "string" && x.code) return x.code;
  return "";
}

function quantityText(q: any): string {
  if (!q || typeof q !== "object" || q.value == null) return "";
  const unit = typeof q.unit === "string" && q.unit ? q.unit : typeof q.code === "string" ? q.code : "";
  return `${q.value}${unit ? ` ${unit}` : ""}`;
}

function rangeText(r: any): string {
  if (!r || typeof r !== "object") return "";
  const lo = quantityText(r.low);
  const hi = quantityText(r.high);
  if (lo && hi) {
    // "40–45 years", not "40 years–45 years", when the units agree.
    const unit = typeof r.low?.unit === "string" ? r.low.unit : "";
    if (unit && typeof r.high?.unit === "string" && r.high.unit === unit && r.low?.value != null && r.high?.value != null) {
      return `${r.low.value}–${r.high.value} ${unit}`;
    }
    return `${lo}–${hi}`;
  }
  return lo || hi;
}

function periodText(p: any): string {
  if (!p || typeof p !== "object") return "";
  const parts = [fmtDate(p.start), fmtDate(p.end)].filter(Boolean);
  return parts.join("–");
}

/** condition.onset[x] legal types are Age, Range, Period, string (no dateTime). */
function onsetText(cond: any): string {
  const age = quantityText(cond?.onsetAge);
  if (age) return `age ${age}`;
  if (typeof cond?.onsetString === "string" && cond.onsetString.trim()) return latinSafe(cond.onsetString.trim());
  const range = rangeText(cond?.onsetRange);
  if (range) return `age ${range}`;
  return periodText(cond?.onsetPeriod);
}

function bornAgeDeceased(r: any): { sub: string[]; deceased: string } {
  const sub: string[] = [];
  const sex = conceptText(r?.sex);
  if (sex) sub.push(sex);
  const born = fmtDate(r?.bornDate) || periodText(r?.bornPeriod);
  if (born) sub.push(`born ${born}`);
  else if (typeof r?.bornString === "string" && r.bornString.trim()) sub.push(`born: ${latinSafe(r.bornString.trim())}`);
  let age = quantityText(r?.ageAge);
  if (!age) age = rangeText(r?.ageRange);
  if (!age && typeof r?.ageString === "string" && r.ageString.trim()) age = latinSafe(r.ageString.trim());
  if (age) sub.push(`age ${age}${r?.estimatedAge === true ? " (estimated)" : ""}`);

  let deceased = "";
  if (r?.deceasedBoolean === true) deceased = "Deceased";
  else if (r?.deceasedBoolean === false) deceased = "";
  else {
    const dAge = quantityText(r?.deceasedAge) || rangeText(r?.deceasedRange);
    const dDate = fmtDate(r?.deceasedDate);
    if (dAge) deceased = `Deceased — age ${dAge}`;
    else if (dDate) deceased = `Deceased ${dDate}`;
    else if (typeof r?.deceasedString === "string" && r.deceasedString.trim()) deceased = `Deceased — ${latinSafe(r.deceasedString.trim())}`;
  }
  return { sub, deceased };
}

function memberSpans(r: any): Span[] {
  const rel = conceptText(r?.relationship) || "Family member";
  const spans: Span[] = [{ text: rel, bold: true }];
  if (typeof r?.name === "string" && r.name.trim()) {
    const safe = latinSafe(r.name.trim());
    spans.push({ text: `\n${safe === FOREIGN_MARK ? "(name in non-Latin script)" : safe}` });
  }
  const { sub, deceased } = bornAgeDeceased(r);
  if (sub.length) spans.push({ text: `\n${sub.join(" · ")}` });
  if (deceased) spans.push({ text: `\n${deceased}`, bold: true });
  return spans;
}

function conditionSpans(r: any): Span[] {
  const spans: Span[] = [];
  const nl = () => spans.length && spans.push({ text: "\n" });
  const conds = Array.isArray(r?.condition) ? r.condition : [];
  for (const cond of conds) {
    if (!cond || typeof cond !== "object") continue;
    nl();
    spans.push({ text: conceptText(cond.code) || "(condition not specified)", bold: true });
    const onset = onsetText(cond);
    if (onset) spans.push({ text: ` — onset ${onset}` });
    if (cond.contributedToDeath === true) spans.push({ text: " — contributed to death", bold: true });
    const outcome = conceptText(cond.outcome);
    if (outcome) spans.push({ text: ` — outcome ${outcome}` });
    for (const n of Array.isArray(cond.note) ? cond.note : []) {
      const text = typeof n?.text === "string" ? n.text.trim() : "";
      // No italic: the summary theme registers no italic face for Inter.
      if (text) spans.push({ text: `\n${latinSafe(text)}` });
    }
  }
  if (!conds.length) {
    const dar = r?.dataAbsentReason;
    if (dar) {
      let label = "";
      for (const x of codings(dar)) {
        if (typeof x?.display === "string" && x.display.trim()) {
          label = x.display.trim();
          break;
        }
      }
      if (!label) {
        for (const x of codings(dar)) {
          if (typeof x?.code === "string" && x.code) {
            label = x.code.replace(/-/g, " ");
            break;
          }
        }
      }
      const detail = typeof dar?.text === "string" ? latinSafe(dar.text.trim()) : "";
      spans.push({ text: latinSafe(label) || "No information available", bold: true });
      if (detail) spans.push({ text: `: ${detail}` });
    } else {
      spans.push({ text: "No conditions recorded" });
    }
  }
  for (const n of Array.isArray(r?.note) ? r.note : []) {
    const text = typeof n?.text === "string" ? n.text.trim() : "";
    if (!text) continue;
    nl();
    spans.push({ text: "Note: ", bold: true });
    spans.push({ text: latinSafe(text) });
  }
  return spans.length ? spans : [{ text: "—" }];
}

function statusCell(r: any, t: Theme): Cell {
  const s = typeof r?.status === "string" ? r.status : "";
  if (!s) return "—";
  const b = STATUS_BADGE[s];
  return badge(t, b?.label ?? s, b?.kind ?? "inactive");
}

const RECORDER_EXT = /us-core-familymemberhistory-recorder$/;

function recordedSpans(r: any): Span[] {
  const spans: Span[] = [];
  const date = fmtDate(r?.date);
  if (date) spans.push({ text: date });
  for (const ext of Array.isArray(r?.extension) ? r.extension : []) {
    if (typeof ext?.url !== "string" || !RECORDER_EXT.test(ext.url)) continue;
    const by = typeof ext?.valueReference?.display === "string" ? latinSafe(ext.valueReference.display.trim()) : "";
    if (by) spans.push({ text: `${spans.length ? "\n" : ""}by ${by}` });
  }
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function rowFor(r: any, t: Theme): Cell[] {
  try {
    return [memberSpans(r), conditionSpans(r), statusCell(r, t), recordedSpans(r)];
  } catch {
    let label = "FamilyMemberHistory (could not be displayed)";
    try {
      if (r?.id != null) label = `FamilyMemberHistory/${String(r.id)} (could not be displayed)`;
    } catch {}
    return [[{ text: label }], "", "", ""];
  }
}

function sortKey(r: any): string {
  try {
    return fmtDate(r?.date);
  } catch {
    return "";
  }
}

const familyHistory: FamilyRenderer = {
  key: "family-history",
  title: "Family History",
  order: 140,
  claims: (r: any) => r?.resourceType === "FamilyMemberHistory",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const list = Array.isArray(resources) ? resources : [];
    if (!list.length) return [];
    const rows = list
      .map((r, i) => ({ r, key: sortKey(r), i }))
      .sort((a, b) => b.key.localeCompare(a.key) || a.i - b.i)
      .map(({ r }) => rowFor(r, theme));
    return [table(theme, { columns: COLUMNS, rows })];
  },
};

export default familyHistory;
