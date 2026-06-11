// Problems & Health Concerns — all Condition resources in one collection table,
// most-recent-first (DESIGN §7 volume rule: one row per instance, never dropped).
// entered-in-error rows stay visible but de-emphasized: con-5 forbids clinicalStatus on
// them, so the verification status is the only signal and must be surfaced, not hidden.
import * as React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, para, table, type Cell, type Span } from "../engine.ts";

// Inter (summary theme) registers no italic face, so de-emphasis is color, not style:
// multi-line cells are stacked para() elements with muted color on the secondary lines.
function stack(t: Theme, lines: { spans: Span[] | string; muted?: boolean }[]): React.ReactElement {
  return React.createElement(
    React.Fragment,
    null,
    lines.map((l, i) =>
      React.cloneElement(para(t, l.spans, { size: t.baseSize - 1, muted: l.muted, spaceAfter: 0 }), { key: i }),
    ),
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: unknown): string | undefined {
  if (typeof iso !== "string") return undefined;
  const m = iso.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return iso.trim() || undefined;
  const [, y, mo, d] = m;
  if (!mo) return y;
  const name = MONTHS[Number(mo) - 1] ?? mo;
  return d ? `${name} ${Number(d)}, ${y}` : `${name} ${y}`;
}

const SYSTEM_NAMES: Record<string, string> = {
  "http://snomed.info/sct": "SNOMED",
  "http://hl7.org/fhir/sid/icd-10-cm": "ICD-10-CM",
  "http://hl7.org/fhir/sid/icd-9-cm": "ICD-9-CM",
  "http://loinc.org": "LOINC",
};

function conceptLabel(cc: any): string | undefined {
  if (typeof cc?.text === "string" && cc.text.trim()) return cc.text.trim();
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  for (const c of codings) if (typeof c?.display === "string" && c.display.trim()) return c.display.trim();
  for (const c of codings) {
    if (typeof c?.code !== "string" || !c.code) continue;
    const sys =
      SYSTEM_NAMES[c?.system] ??
      (typeof c?.system === "string" ? c.system.split(/[/:]/).filter(Boolean).pop() : undefined);
    return sys ? `${sys} ${c.code}` : c.code;
  }
  return undefined;
}

// Document fonts carry no CJK (or other far-plane) glyphs and a missing glyph garbles its
// whole line, so mixed-script labels lead with the readable part and the non-Latin runs
// move to a muted sub-line where any tofu stays contained (patient-family policy).
const NON_LATIN_RUN = /[\u2E80-\uFFFD\u{10000}-\u{10FFFF}]+/gu;

function splitLatin(label: string): { main: string; foreign?: string } {
  const runs = label.match(NON_LATIN_RUN);
  if (!runs) return { main: label };
  const main = label.replace(NON_LATIN_RUN, " ").replace(/\s{2,}/g, " ").trim();
  return main ? { main, foreign: runs.join(" ") } : { main: label };
}

function statusCode(cc: any): string | undefined {
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  for (const c of codings) if (typeof c?.code === "string" && c.code) return c.code;
  return typeof cc?.text === "string" && cc.text.trim() ? cc.text.trim() : undefined;
}

const CATEGORY_LABELS: Record<string, string> = {
  "problem-list-item": "Problem list",
  "health-concern": "Health concern",
  "encounter-diagnosis": "Encounter diagnosis",
  sdoh: "SDOH",
};

function categoryLabels(r: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const cat of Array.isArray(r?.category) ? r.category : []) {
    const codings = Array.isArray(cat?.coding) ? cat.coding : [];
    const mapped = codings.map((c: any) => CATEGORY_LABELS[c?.code]).find((x: string | undefined) => x);
    const label = mapped ?? conceptLabel(cat);
    if (!label) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(label);
  }
  return out;
}

const UCUM_AGE: Record<string, string> = { a: "yr", mo: "mo", wk: "wk", d: "d", h: "h" };

function quantityText(q: any): string | undefined {
  if (q?.value == null) return undefined;
  const unit =
    (typeof q?.unit === "string" && q.unit) || (typeof q?.code === "string" && (UCUM_AGE[q.code] ?? q.code)) || "";
  return `${q.value}${unit ? ` ${unit}` : ""}`;
}

function whenText(r: any, prefix: "onset" | "abatement"): string | undefined {
  const dt = r?.[`${prefix}DateTime`];
  if (typeof dt === "string") return fmtDate(dt);
  const p = r?.[`${prefix}Period`];
  if (p && typeof p === "object") {
    const s = fmtDate(p?.start);
    const e = fmtDate(p?.end);
    if (s && e) return `${s} – ${e}`;
    if (s) return `from ${s}`;
    if (e) return `until ${e}`;
  }
  const age = quantityText(r?.[`${prefix}Age`]);
  if (age) return `age ${age}`;
  const rg = r?.[`${prefix}Range`];
  if (rg && typeof rg === "object") {
    const lo = quantityText(rg?.low);
    const hi = quantityText(rg?.high);
    if (lo || hi) return `${lo ?? "?"} – ${hi ?? "?"}`;
  }
  const s = r?.[`${prefix}String`];
  if (typeof s === "string" && s.trim()) return s.trim();
  return undefined;
}

function assertedDate(r: any): string | undefined {
  for (const e of Array.isArray(r?.extension) ? r.extension : []) {
    if (e?.url === "http://hl7.org/fhir/StructureDefinition/condition-assertedDate") {
      return typeof e?.valueDateTime === "string" ? e.valueDateTime : undefined;
    }
  }
  return undefined;
}

function isEnteredInError(r: any): boolean {
  const codings = Array.isArray(r?.verificationStatus?.coding) ? r.verificationStatus.coding : [];
  return codings.some((c: any) => c?.code === "entered-in-error");
}

// Clinical dates only; meta.lastUpdated is administrative churn and would reorder old
// problems on every touch — it breaks the tie only when no clinical date exists at all.
function recencyKey(r: any): string {
  const candidates = [
    r?.onsetDateTime,
    r?.onsetPeriod?.start,
    r?.onsetPeriod?.end,
    r?.abatementDateTime,
    r?.recordedDate,
    assertedDate(r),
  ].filter((x: any) => typeof x === "string" && /^\d{4}/.test(x)) as string[];
  if (!candidates.length && typeof r?.meta?.lastUpdated === "string") return r.meta.lastUpdated;
  return candidates.sort().pop() ?? "";
}

const BADGE_KIND: Record<string, string> = {
  active: "active",
  recurrence: "active",
  relapse: "active",
  inactive: "inactive",
  remission: "completed",
  resolved: "resolved",
};

function conditionRow(t: Theme, r: any): Cell[] {
  const err = isEnteredInError(r);
  const { main: name, foreign } = splitLatin(
    conceptLabel(r?.code) ?? (r?.id != null ? `Condition/${String(r.id)}` : "Condition (no code recorded)"),
  );

  const sub: string[] = categoryLabels(r);
  const ver = statusCode(r?.verificationStatus);
  if (ver && ver !== "confirmed" && ver !== "entered-in-error") sub.push(ver);
  if (err) sub.push("entered in error — disregard");
  const nameLines = [{ spans: [{ text: name, bold: !err }] as Span[], muted: err }];
  if (foreign) nameLines.push({ spans: [{ text: foreign }], muted: true });
  if (sub.length) nameLines.push({ spans: [{ text: sub.join(" · ") }], muted: true });
  const nameCell: Cell = stack(t, nameLines);

  let status: Cell = "—";
  if (err) status = badge(t, "in error", "stopped");
  else {
    const cs = statusCode(r?.clinicalStatus);
    if (cs) status = badge(t, cs, BADGE_KIND[cs] ?? "inactive");
  }

  const onset = whenText(r, "onset") ?? "—";
  const abated = whenText(r, "abatement");
  const onsetCell: Cell =
    abated || err
      ? stack(t, [
          { spans: onset, muted: err },
          ...(abated ? [{ spans: `resolved: ${abated}`, muted: true }] : []),
        ])
      : onset;

  const recorded = fmtDate(r?.recordedDate) ?? fmtDate(assertedDate(r)) ?? "—";
  return [nameCell, status, onsetCell, err ? stack(t, [{ spans: recorded, muted: true }]) : recorded];
}

const problems: FamilyRenderer = {
  key: "problems",
  title: "Problems & Health Concerns",
  order: 20,
  claims: (r: any) => r?.resourceType === "Condition",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const sorted = (Array.isArray(resources) ? [...resources] : []).sort((a, b) =>
      recencyKey(b).localeCompare(recencyKey(a)),
    );
    const rows: Cell[][] = sorted.map((r) => {
      try {
        return conditionRow(theme, r);
      } catch {
        const id = r?.id != null ? `Condition/${String(r.id)}` : "Condition";
        return [[{ text: `${id} (record could not be displayed)`, italic: true }], "—", "—", "—"];
      }
    });
    if (!rows.length) return [];
    return [
      table(theme, {
        columns: [
          { header: "Condition", width: 5 },
          { header: "Status", width: 1.4 },
          { header: "Onset", width: 2.4 },
          { header: "Recorded", width: 1.6 },
        ],
        rows,
      }),
    ];
  },
};

export default problems;
