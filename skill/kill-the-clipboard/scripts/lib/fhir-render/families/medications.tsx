// Medications family: MedicationRequest / MedicationDispense / MedicationStatement /
// Medication (DESIGN §7). Requests+statements share one table; dispenses get a second
// compact table. Standalone Medications are folded into the rows that reference them
// (claimed for completeness, never double-rendered); unreferenced ones get their own
// small table so no claimed instance is invisible.
import type React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, para, table, type Cell, type Span } from "../engine.ts";

const CLAIMED_TYPES = new Set(["MedicationRequest", "MedicationDispense", "MedicationStatement", "Medication"]);

const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

const conceptText = (cc: any): string | undefined => {
  const txt = str(cc?.text);
  if (txt) return txt;
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  for (const c of codings) {
    const d = str(c?.display);
    if (d) return d;
  }
  for (const c of codings) {
    const code = str(c?.code);
    if (code) return code;
  }
  return undefined;
};

// Sigs are read by humans: a text/display-less coding contributes only a bare code
// (e.g. SNOMED 26643006), which is noise mid-sentence — omit rather than confuse.
const humanConceptText = (cc: any): string | undefined => {
  const txt = str(cc?.text);
  if (txt) return txt;
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  for (const c of codings) {
    const d = str(c?.display);
    if (d) return d;
  }
  return undefined;
};

const fmtDate = (v: any): string => (typeof v === "string" ? v.slice(0, 10) : "");

const qty = (q: any): string | undefined => {
  if (q?.value == null) return undefined;
  // {tbl}-style UCUM annotation codes are not human units — prefer `unit`.
  const unit = str(q.unit) ?? str(q.code);
  return unit ? `${q.value} ${unit}` : String(q.value);
};

const PERIOD_UNITS: Record<string, string> = { s: "sec", min: "min", h: "hr", d: "day", wk: "week", mo: "month", a: "year" };

const repeatText = (rep: any): string | undefined => {
  const freq = rep?.frequency;
  const period = rep?.period;
  if (typeof freq !== "number" || typeof period !== "number") return undefined;
  const unit = PERIOD_UNITS[str(rep?.periodUnit) ?? ""] ?? str(rep?.periodUnit) ?? "";
  if (period === 1 && unit === "day") return freq === 1 ? "once daily" : `${freq}x daily`;
  if (freq === 1) return `every ${period} ${unit}`.trim();
  return `${freq}x every ${period} ${unit}`.trim();
};

const dosageSummary = (d: any): string | undefined => {
  const parts: string[] = [];
  const dr = Array.isArray(d?.doseAndRate) ? d.doseAndRate[0] : undefined;
  const dq = qty(dr?.doseQuantity);
  if (dq) parts.push(dq);
  else if (dr?.doseRange) {
    const range = [qty(dr.doseRange.low), qty(dr.doseRange.high)].filter(Boolean).join("–");
    if (range) parts.push(range);
  }
  const route = humanConceptText(d?.route);
  if (route) parts.push(route);
  // Timing keeps the code fallback: GTSAbbreviation codes (BID, TID…) read fine bare.
  const timing = conceptText(d?.timing?.code) ?? repeatText(d?.timing?.repeat);
  if (timing) parts.push(timing);
  if (d?.asNeededBoolean === true) parts.push("as needed");
  const asNeededFor = conceptText(d?.asNeededCodeableConcept);
  if (asNeededFor) parts.push(`as needed for ${asNeededFor}`);
  return parts.length ? parts.join(", ") : undefined;
};

interface MedIndex {
  byRef: Map<string, any>;
  referenced: Set<any>;
}

const buildMedIndex = (medications: any[]): MedIndex => {
  const byRef = new Map<string, any>();
  for (const m of medications) {
    const id = str(m?.id);
    if (!id) continue;
    byRef.set(`Medication/${id}`, m);
    byRef.set(id, m);
  }
  return { byRef, referenced: new Set() };
};

/** Resolve medication[x] to a display name; resolved standalone Medications are marked referenced. */
const medName = (r: any, idx: MedIndex): string => {
  const cc = conceptText(r?.medicationCodeableConcept);
  if (cc) return cc;
  const ref = r?.medicationReference;
  const refStr = str(ref?.reference);
  if (refStr?.startsWith("#")) {
    const contained = (Array.isArray(r?.contained) ? r.contained : []).find((c: any) => c?.id === refStr.slice(1));
    const name = conceptText(contained?.code);
    if (name) return name;
  } else if (refStr) {
    const med = idx.byRef.get(refStr) ?? idx.byRef.get(refStr.split("/").pop() ?? "");
    if (med) {
      idx.referenced.add(med);
      const name = conceptText(med.code);
      if (name) return name;
    }
  }
  return str(ref?.display) ?? refStr ?? "(medication unspecified)";
};

const STATUS_KIND: Record<string, string> = {
  active: "active",
  "in-progress": "active",
  completed: "completed",
  stopped: "stopped",
  cancelled: "stopped",
  "entered-in-error": "stopped",
  declined: "stopped",
  "not-taken": "stopped",
  "on-hold": "unable-to-assess",
  draft: "unable-to-assess",
  preparation: "unable-to-assess",
  intended: "unable-to-assess",
};

const statusBadge = (t: Theme, status: any): React.ReactElement => {
  const label = str(status) ?? "unknown";
  return badge(t, label, STATUS_KIND[label] ?? "inactive");
};

const isReported = (r: any): boolean => r?.reportedBoolean === true || r?.reportedReference != null;

const medCell = (r: any, idx: MedIndex): Span[] => {
  const spans: Span[] = [{ text: medName(r, idx), bold: true }];
  const tags: string[] = [];
  if (r?.resourceType === "MedicationStatement") tags.push("statement");
  const intent = str(r?.intent);
  if (intent && intent !== "order") tags.push(intent);
  if (isReported(r)) tags.push("patient-reported");
  if (tags.length) spans.push({ text: `\n${tags.join(" · ")}` });
  return spans;
};

const sigCell = (r: any): Span[] => {
  const spans: Span[] = [];
  const dosages = Array.isArray(r?.dosageInstruction) ? r.dosageInstruction : Array.isArray(r?.dosage) ? r.dosage : [];
  const lines = dosages.map((d: any) => dosageSummary(d) ?? str(d?.text)).filter(Boolean) as string[];
  spans.push({ text: lines.length ? lines.join("; ") : "—" });
  const patientInstruction = dosages.map((d: any) => str(d?.patientInstruction)).find(Boolean);
  if (patientInstruction) spans.push({ text: `\n${patientInstruction}` });
  const dispQty = qty(r?.dispenseRequest?.quantity);
  const refills = r?.dispenseRequest?.numberOfRepeatsAllowed;
  if (dispQty || typeof refills === "number") {
    const disp = [dispQty ? `disp ${dispQty}` : undefined, typeof refills === "number" ? `${refills} refills` : undefined]
      .filter(Boolean)
      .join(", ");
    spans.push({ text: `\n${disp}` });
  }
  const statusReason = conceptText(r?.statusReason);
  if (statusReason) spans.push({ text: `\n${str(r?.status) ?? "status"}: ${statusReason}` });
  const notes = (Array.isArray(r?.note) ? r.note : []).map((n: any) => str(n?.text)).filter(Boolean) as string[];
  for (const n of notes) spans.push({ text: `\n${n}` });
  return spans;
};

const requestDate = (r: any): string =>
  fmtDate(r?.authoredOn) || fmtDate(r?.effectiveDateTime) || fmtDate(r?.effectivePeriod?.start) || fmtDate(r?.dateAsserted);

const requesterName = (r: any): string => {
  const who = r?.requester ?? r?.informationSource;
  return str(who?.display) ?? str(who?.reference) ?? "";
};

const dispenseDate = (d: any): string => fmtDate(d?.whenHandedOver) || fmtDate(d?.whenPrepared);

const byDateDesc = (dateOf: (r: any) => string) => (a: any, b: any) => {
  const da = dateOf(a);
  const db = dateOf(b);
  if (da === db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da < db ? 1 : -1;
};

const safeRow = (build: () => Cell[], r: any, arity: number): Cell[] => {
  try {
    return build();
  } catch {
    const row: Cell[] = [[{ text: str(r?.id) ?? "(unreadable resource)" }]];
    while (row.length < arity) row.push("");
    return row;
  }
};

const medications: FamilyRenderer = {
  key: "medications",
  title: "Medications",
  order: 30,
  claims: (r: any) => CLAIMED_TYPES.has(r?.resourceType),
  render(resources: any[], t: Theme): React.ReactElement[] {
    try {
      const all = (Array.isArray(resources) ? resources : []).filter((r) => r && typeof r === "object");
      const requests = all.filter((r) => r.resourceType === "MedicationRequest" || r.resourceType === "MedicationStatement");
      const dispenses = all.filter((r) => r.resourceType === "MedicationDispense");
      const meds = all.filter((r) => r.resourceType === "Medication");
      const other = all.filter((r) => !requests.includes(r) && !dispenses.includes(r) && !meds.includes(r));
      const idx = buildMedIndex(meds);

      const out: React.ReactElement[] = [];

      if (requests.length) {
        out.push(para(t, [{ text: "Prescriptions & Orders", bold: true }], { spaceAfter: 3 }));
        out.push(
          table(t, {
            columns: [
              { header: "Medication", width: 27 },
              { header: "Dose & Instructions", width: 33 },
              { header: "Status", width: 11 },
              { header: "Date", width: 11 },
              { header: "Prescriber", width: 14 },
            ],
            rows: [...requests].sort(byDateDesc(requestDate)).map((r) =>
              safeRow(
                () => [medCell(r, idx), sigCell(r), statusBadge(t, r?.status), requestDate(r) || "—", requesterName(r)],
                r,
                5,
              ),
            ),
          }),
        );
      }

      if (dispenses.length) {
        out.push(para(t, [{ text: "Dispenses & Fills", bold: true }], { spaceAfter: 3 }));
        out.push(
          table(t, {
            columns: [
              { header: "Medication", width: 27 },
              { header: "Qty", width: 8 },
              { header: "Days", width: 7 },
              { header: "Type", width: 10 },
              { header: "Status", width: 11 },
              { header: "Date", width: 11 },
              { header: "Pharmacy", width: 16 },
            ],
            rows: [...dispenses].sort(byDateDesc(dispenseDate)).map((d) =>
              safeRow(
                () => [
                  [{ text: medName(d, idx), bold: true }] as Span[],
                  qty(d?.quantity) ?? "—",
                  qty(d?.daysSupply) ?? "—",
                  conceptText(d?.type) ?? "—",
                  statusBadge(t, d?.status),
                  dispenseDate(d) || "—",
                  str(d?.performer?.[0]?.actor?.display) ?? str(d?.performer?.[0]?.actor?.reference) ?? "",
                ],
                d,
                7,
              ),
            ),
          }),
        );
      }

      // Standalone Medications resolved into a row above are complete via that fold-in;
      // anything unreferenced still owes the reader a row of its own.
      const orphanMeds = meds.filter((m) => !idx.referenced.has(m));
      const leftover = [...orphanMeds, ...other];
      if (leftover.length) {
        out.push(para(t, [{ text: "Medication Records", bold: true }], { spaceAfter: 3 }));
        out.push(
          table(t, {
            columns: [
              { header: "Medication", width: 40 },
              { header: "Code", width: 20 },
              { header: "Form", width: 25 },
            ],
            rows: leftover.map((m) =>
              safeRow(
                () => [
                  [{ text: conceptText(m?.code) ?? str(m?.id) ?? "(unnamed medication)", bold: true }] as Span[],
                  (Array.isArray(m?.code?.coding) ? m.code.coding : [])
                    .map((c: any) => str(c?.code))
                    .find(Boolean) ?? "—",
                  conceptText(m?.form) ?? "—",
                ],
                m,
                3,
              ),
            ),
          }),
        );
      }

      return out;
    } catch (e) {
      return [
        para(
          t,
          `Medication details could not be formatted (${e instanceof Error ? e.message : "error"}); see Other Records or the raw bundle.`,
          { muted: true },
        ),
      ];
    }
  },
};

export default medications;
