// Encounters family: Encounter + Location (docs/DESIGN.md §7). Encounters render as one
// collection table, most-recent-first; Location resources render as compact facility
// rows below (and enrich encounter location cells when references resolve in-family).
// Location is claimed here, ahead of `supporting` in registry order, because the
// fixture corpus and rendering spec fold facilities into the encounter section.
import type React from "react";
import type { FamilyRenderer } from "../types.ts";
import { badge, para, table, type Cell, type Span, type Theme } from "../engine.ts";

const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

/** text > first coding display > first coding code — tolerates code-only and text-only concepts. */
function codeableText(cc: any): string | undefined {
  if (!cc || typeof cc !== "object") return undefined;
  return (
    str(cc.text) ??
    arr(cc.coding)
      .map((c: any) => str(c?.display) ?? str(c?.code))
      .find((x: string | undefined) => x)
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: any): string | undefined {
  const s = str(iso);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return /^\d{4}/.test(s) ? s.slice(0, 7) : s;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** Clock time as written in the source (no timezone conversion — render what the EHR said). */
function fmtTime(iso: any): string | undefined {
  const m = /T(\d{2}):(\d{2})/.exec(str(iso) ?? "");
  if (!m) return undefined;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

function fmtPeriod(period: any, status?: string): string {
  const start = fmtDate(period?.start);
  const end = fmtDate(period?.end);
  if (!start && !end) return "—";
  if (start && end && start === end) {
    const t1 = fmtTime(period?.start);
    const t2 = fmtTime(period?.end);
    return t1 && t2 ? `${start}\n${t1} – ${t2}` : start;
  }
  if (start && end) return `${start} –\n${end}`;
  if (start && !end) return status === "in-progress" ? `${start} –\nongoing` : start;
  return `– ${end}`;
}

// v3-ActCode encounter classes seen in real exports; display/code fallback covers the rest.
const CLASS_LABELS: Record<string, string> = {
  AMB: "Ambulatory",
  EMER: "Emergency",
  IMP: "Inpatient",
  ACUTE: "Acute inpatient",
  NONAC: "Inpatient (non-acute)",
  OBSENC: "Observation",
  PRENC: "Pre-admission",
  SS: "Short stay",
  VR: "Virtual",
  HH: "Home health",
  FLD: "Field",
};

/** Encounter.class is a Coding in R4, but tolerate CodeableConcept-shaped input too. */
function classLabel(cls: any): string {
  const coding = cls?.coding?.[0] ?? cls;
  const code = str(coding?.code);
  if (code && CLASS_LABELS[code]) return CLASS_LABELS[code]!;
  const disp = str(coding?.display) ?? str(cls?.text);
  if (disp) return disp.charAt(0).toUpperCase() + disp.slice(1);
  return code ?? "—";
}

const STATUS_BADGE: Record<string, string> = {
  finished: "completed",
  "in-progress": "active",
  arrived: "active",
  triaged: "active",
  onleave: "active",
  planned: "inactive",
  cancelled: "stopped",
  "entered-in-error": "stopped",
  unknown: "inactive",
};

function statusBadge(t: Theme, status: any): React.ReactElement {
  const s = str(status) ?? "unknown";
  const label = (s.charAt(0).toUpperCase() + s.slice(1)).replace(/-/g, " ");
  return badge(t, label, STATUS_BADGE[s] ?? "inactive");
}

function locationCell(enc: any, locationsById: Map<string, any>): string {
  const names = arr(enc?.location)
    .map((l: any) => {
      const ref = str(l?.location?.reference);
      const resolved = ref ? locationsById.get(ref.replace(/^Location\//, "")) : undefined;
      return str(l?.location?.display) ?? str(resolved?.name) ?? ref;
    })
    .filter((x): x is string => !!x);
  return names.join("\n") || "—";
}

function providerCell(enc: any): string {
  const names = arr(enc?.participant)
    .map((p: any) => {
      const who = str(p?.individual?.display) ?? str(p?.individual?.reference);
      if (!who) return undefined;
      const role = arr(p?.type)
        .map((t: any) => codeableText(t))
        .find((x: string | undefined) => x);
      return role ? `${who} (${role})` : who;
    })
    .filter((x): x is string => !!x);
  if (names.length) return names.join("\n");
  return str(enc?.serviceProvider?.display) ?? "—";
}

function encounterCell(enc: any): Span[] {
  const type =
    arr(enc?.type)
      .map((ty: any) => codeableText(ty))
      .filter((x): x is string => !!x)
      .join("; ") || "Encounter";
  const spans: Span[] = [{ text: type, bold: true }];
  const reasons = [
    ...arr(enc?.reasonCode).map((rc: any) => codeableText(rc)),
    ...arr(enc?.reasonReference).map((rr: any) => str(rr?.display)),
  ].filter((x): x is string => !!x);
  if (reasons.length) spans.push({ text: `\nReason: ${reasons.join("; ")}` });
  const disposition = codeableText(enc?.hospitalization?.dischargeDisposition);
  if (disposition) spans.push({ text: `\nDischarge: ${disposition}` });
  return spans;
}

function fmtAddress(a: any): string | undefined {
  const parts = [
    ...arr(a?.line).map((l: any) => str(l)),
    str(a?.city),
    [str(a?.state), str(a?.postalCode)].filter(Boolean).join(" ") || undefined,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(", ") : undefined;
}

function locationRow(t: Theme, loc: any): Cell[] {
  const nameSpans: Span[] = [{ text: str(loc?.name) ?? str(loc?.id) ?? "Location", bold: true }];
  const alias = arr(loc?.alias)
    .map((a: any) => str(a))
    .filter((x): x is string => !!x);
  if (alias.length) nameSpans.push({ text: `\nAlias: ${alias.join(", ")}` });
  const org = str(loc?.managingOrganization?.display);
  if (org) nameSpans.push({ text: `\n${org}` });
  const types =
    arr(loc?.type)
      .map((ty: any) => codeableText(ty))
      .filter((x): x is string => !!x)
      .join("; ") || "—";
  const phone = arr(loc?.telecom).find((c: any) => str(c?.system) === "phone");
  const status = str(loc?.status);
  return [
    nameSpans,
    types,
    fmtAddress(loc?.address) ?? "—",
    str(phone?.value) ?? "—",
    status
      ? badge(t, status.charAt(0).toUpperCase() + status.slice(1), status === "active" ? "active" : "inactive")
      : "—",
  ];
}

const encounters: FamilyRenderer = {
  key: "encounters",
  title: "Encounters",
  order: 100,
  claims: (r: any) => r?.resourceType === "Encounter" || r?.resourceType === "Location",
  render(resources: any[], t: Theme): React.ReactElement[] {
    const encs: any[] = [];
    const locs: any[] = [];
    for (const r of arr(resources)) {
      if (r?.resourceType === "Location") locs.push(r);
      else encs.push(r); // non-Encounter strays still get a degraded encounter row — never drop
    }

    const locationsById = new Map<string, any>();
    for (const l of locs) {
      const id = str(l?.id);
      if (id) locationsById.set(id, l);
    }

    const sortKey = (e: any) => str(e?.period?.start) ?? str(e?.period?.end) ?? "";
    const sorted = [...encs].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));

    const out: React.ReactElement[] = [];

    if (sorted.length) {
      const rows: Cell[][] = sorted.map((enc) => {
        try {
          return [
            fmtPeriod(enc?.period, str(enc?.status)),
            encounterCell(enc),
            classLabel(enc?.class),
            providerCell(enc),
            locationCell(enc, locationsById),
            statusBadge(t, enc?.status),
          ];
        } catch {
          return [
            "—",
            [{ text: str(enc?.id) ?? "Unreadable encounter record" }] as Span[],
            "—",
            "—",
            "—",
            "—",
          ];
        }
      });
      out.push(
        table(t, {
          columns: [
            { header: "When", width: 14 },
            { header: "Encounter", width: 31 },
            { header: "Class", width: 10 },
            { header: "Provider", width: 17 },
            { header: "Location", width: 17 },
            { header: "Status", width: 11 },
          ],
          rows,
        }),
      );
    }

    if (locs.length) {
      const rows: Cell[][] = locs.map((loc) => {
        try {
          return locationRow(t, loc);
        } catch {
          return [[{ text: str(loc?.id) ?? "Unreadable location record" }] as Span[], "—", "—", "—", "—"];
        }
      });
      out.push(
        para(t, [{ text: "Facilities & Locations", bold: true }], { spaceAfter: 4 }),
        table(t, {
          columns: [
            { header: "Facility", width: 28 },
            { header: "Type", width: 22 },
            { header: "Address", width: 28 },
            { header: "Phone", width: 12 },
            { header: "Status", width: 10 },
          ],
          rows,
        }),
      );
    }

    return out;
  },
};

export default encounters;
