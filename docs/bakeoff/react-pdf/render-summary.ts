/**
 * render-summary.ts — build summary.pdf from summary-data.json via doc.tsx.
 */
import path from "node:path";
import {
  summaryTheme as t,
  title,
  section,
  callout,
  kvPanel,
  table,
  badge,
  page,
  renderDoc,
  PROVENANCE,
  type Cell,
} from "./doc.tsx";

const SRC = path.join(import.meta.dir, "../content/summary-data.json");
const OUT = path.join(import.meta.dir, "summary.pdf");

const data = await Bun.file(SRC).json();
const p = data.patient;

const fmtDate = (iso: string) => iso; // keep ISO; clinical theme

// ----- main portrait flow: title, demographics, callout, problems, meds,
// labs, allergies, immunizations — one Page element; each table carries its
// own fixed (repeating) header row. ----------------------------------------

const mainPage = page(
  t,
  [
    title(t, {
      kicker: "FHIR-rendered summary",
      title: "Health Summary",
      meta: [
        { label: "Patient", value: p.name },
        { label: "DOB", value: p.birthDate },
        { label: "Generated", value: p.generatedDate },
      ],
    }),
    section(t, "Demographics"),
    kvPanel(t, [
      ["Name", p.name],
      ["DOB", p.birthDate],
      ["Sex", p.sex],
      ["MRN", p.mrn],
      ["Generated", p.generatedDate],
    ]),
    callout(t, {
      title: "How this document was shared",
      body: [
        PROVENANCE + ".",
        "The patient generated this summary from her health records and shared it with this practice via a SMART Health Link, a patient-controlled, verifiable sharing mechanism.",
      ],
    }),
    section(t, "Problems"),
    table(t, {
      columns: [
        { header: "Condition", width: 56 },
        { header: "Clinical status", width: 16 },
        { header: "Onset", width: 12 },
      ],
      rows: data.problems.map((pr: any) => [
        pr.condition,
        badge(t, pr.clinicalStatus, pr.clinicalStatus),
        pr.onset,
      ]),
    }),

    // ----- medications (40 rows; spans pages; header repeats) --------------
    section(t, "Medications"),
    table(t, {
      columns: [
        { header: "Medication", width: 17.5 },
        { header: "Dose", width: 9.5 },
        { header: "Sig (instructions)", width: 38 },
        { header: "Status", width: 11 },
        { header: "Authored", width: 10 },
        { header: "Prescriber", width: 14 },
      ],
      rows: data.medications.map((m: any) => [
        [{ text: m.name, bold: true }],
        m.dose,
        m.sig,
        badge(t, m.status, m.status),
        fmtDate(m.authoredOn),
        m.prescriber,
      ]),
    }),

    // ----- labs (25 rows; flag HIGH/LOW) ------------------------------------
    section(t, "Laboratory Results"),
    table(t, {
      columns: [
        { header: "Test", width: 34 },
        { header: "Value", width: 11, align: "right" },
        { header: "Unit", width: 12 },
        { header: "Reference range", width: 14 },
        { header: "Flag", width: 12 },
        { header: "Date", width: 11 },
      ],
      rows: data.labs.map((l: any) => [
        l.test,
        [{ text: l.value, bold: l.interpretation !== "NORMAL" }],
        l.unit,
        l.referenceRange,
        l.interpretation === "NORMAL" ? [{ text: "—" }] : badge(t, l.interpretation, l.interpretation),
        l.date,
      ]),
      flagRow: (_r, i) => data.labs[i].interpretation !== "NORMAL",
      zebra: false,
    }),
    section(t, "Allergies & Intolerances"),
    table(t, {
      columns: [
        { header: "Substance", width: 22 },
        { header: "Reaction", width: 43 },
        { header: "Criticality", width: 17 },
        { header: "Status", width: 10 },
      ],
      rows: data.allergies.map((a: any) => [
        [{ text: a.substance, bold: true }],
        a.reaction,
        badge(t, a.criticality, a.criticality),
        badge(t, a.status, a.status),
      ]),
    }),
    section(t, "Immunizations"),
    table(t, {
      columns: [
        { header: "Vaccine", width: 60 },
        { header: "Date", width: 14 },
        { header: "Status", width: 14 },
      ],
      rows: data.immunizations.map((im: any) => [
        im.vaccine,
        im.date,
        badge(t, im.status, im.status),
      ]),
    }),
  ],
  { key: "main" },
);

// ----- wide table (9 columns) — landscape page -----------------------------

const wt = data.wideTable;
const widePage = page(
  t,
  [
    section(t, wt.title + "  (landscape for legibility)"),
    table(t, {
      columns: wt.columns.map((c: string, i: number) => ({
        header: c,
        width: i === 0 ? 8 : 11.5,
      })),
      rows: wt.rows as Cell[][],
      fontSize: 6.4,
    }),
  ],
  { key: "wide", orientation: "landscape" },
);

const t0 = performance.now();
await renderDoc(
  [mainPage, widePage],
  { title: `Health Summary — ${p.name}`, author: p.name },
  OUT,
);
console.log(`summary.pdf written in ${(performance.now() - t0).toFixed(0)} ms`);
