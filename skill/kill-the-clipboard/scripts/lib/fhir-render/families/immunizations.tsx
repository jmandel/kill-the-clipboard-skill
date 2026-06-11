// Immunizations family — one table row per Immunization instance (DESIGN §7 volume rule:
// grouping/sorting only, never drop or summarize-away a record). not-done and
// entered-in-error rows are flagged and carry their statusReason so refusals/voids stay
// visible, per US Core's "don't silently render a refused vaccine as given" concern.
import type * as React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, table, type Cell, type Span } from "../engine.ts";

function codings(cc: any): any[] {
  return Array.isArray(cc?.coding) ? cc.coding : [];
}

function conceptText(cc: any): string | undefined {
  if (typeof cc?.text === "string" && cc.text.trim()) return cc.text.trim();
  for (const c of codings(cc)) if (typeof c?.display === "string" && c.display.trim()) return c.display.trim();
  for (const c of codings(cc)) if (typeof c?.code === "string" && c.code) return c.code;
  return undefined;
}

function cvxCode(cc: any): string | undefined {
  for (const c of codings(cc)) {
    if (typeof c?.system === "string" && c.system.toLowerCase().includes("cvx") && typeof c?.code === "string") {
      return c.code;
    }
  }
  return undefined;
}

// NBSP keeps "CVX <code>" an unbreakable token so the label never wraps apart mid-cell.
const cvxLabel = (code: string) => `CVX\u00A0${code}`;

function vaccineSpans(r: any): Span[] {
  const cc = r?.vaccineCode;
  const cvx = cvxCode(cc);
  let name = typeof cc?.text === "string" && cc.text.trim() ? cc.text.trim() : undefined;
  if (!name) for (const c of codings(cc)) if (typeof c?.display === "string" && c.display.trim()) { name = c.display.trim(); break; }
  if (!name) name = cvx ? cvxLabel(cvx) : conceptText(cc) ?? "Unknown vaccine";
  // No italic: the summary theme registers Inter without an italic face.
  const spans: Span[] = [{ text: name, bold: true }];
  // "· CVX nnn" is one unbreakable token: a break inside it draws a spurious hyphen.
  if (cvx && name !== cvxLabel(cvx)) spans.push({ text: ` ·\u00A0${cvxLabel(cvx)}` });
  return spans;
}

function occurrenceLabel(r: any): string {
  const d = r?.occurrenceDateTime;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  if (typeof d === "string" && d) return d;
  const s = r?.occurrenceString;
  if (typeof s === "string" && s.trim()) return s.trim();
  return "—";
}

function occurrenceMillis(r: any): number {
  const d = r?.occurrenceDateTime;
  const t = typeof d === "string" ? Date.parse(d) : NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

const STATUS_KIND: Record<string, string> = {
  completed: "completed",
  "not-done": "stopped",
  "entered-in-error": "inactive",
};

function statusBadge(theme: Theme, status: unknown): React.ReactElement {
  const s = typeof status === "string" && status ? status : "unknown";
  // NBSPs keep multi-word labels ("entered in error") on one line inside the chip.
  return badge(theme, s.replace(/-/g, "\u00A0"), STATUS_KIND[s] ?? "inactive");
}

function detailText(r: any): string {
  const bits: string[] = [];
  const reason = conceptText(r?.statusReason);
  if (reason) bits.push(`Reason: ${reason}`);
  if (typeof r?.lotNumber === "string" && r.lotNumber.trim()) bits.push(`Lot ${r.lotNumber.trim()}`);
  const site = conceptText(r?.site);
  if (site) bits.push(site);
  if (r?.primarySource === false) bits.push(`Reported: ${conceptText(r?.reportOrigin) ?? "not directly recorded"}`);
  return bits.join("  ·  ");
}

const immunizations: FamilyRenderer = {
  key: "immunizations",
  title: "Immunizations",
  order: 50,
  claims: (r: any) => r?.resourceType === "Immunization",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const sorted = (resources ?? [])
      .map((r, i) => ({ r, i }))
      .sort((a, b) => occurrenceMillis(b.r) - occurrenceMillis(a.r) || a.i - b.i);

    const rows: Cell[][] = [];
    const flagged = new Set<number>();
    for (const { r } of sorted) {
      const idx = rows.length;
      try {
        const status = typeof r?.status === "string" ? r.status : undefined;
        if (status === "not-done" || status === "entered-in-error") flagged.add(idx);
        rows.push([vaccineSpans(r), occurrenceLabel(r), statusBadge(theme, status), detailText(r)]);
      } catch (e) {
        rows.push([
          [{ text: `Immunization${r?.id != null ? ` ${String(r.id)}` : ""}`, bold: true }],
          "—",
          statusBadge(theme, r?.status),
          `Could not render: ${e instanceof Error ? e.message : String(e)}`,
        ]);
      }
    }

    return [
      table(theme, {
        columns: [
          { header: "Vaccine", width: 3.4 },
          { header: "Date", width: 1.5 },
          { header: "Status", width: 1.6 },
          { header: "Lot / Site / Notes", width: 3.1 },
        ],
        rows,
        flagRow: (_row, idx) => flagged.has(idx),
      }),
    ];
  },
};

export default immunizations;
