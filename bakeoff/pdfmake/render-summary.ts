// render-summary.ts — summary-data.json -> DocBuilder mapping (summary theme).
import { readFileSync } from "fs";
import { join } from "path";
import { DocBuilder } from "./doc";

const SRC = join(import.meta.dir, "../content/summary-data.json");
const OUT = join(import.meta.dir, "summary.pdf");
const data = JSON.parse(readFileSync(SRC, "utf8"));

const PROVENANCE = "Shared by the patient via SMART Health Link — June 10, 2026";

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d ? `${months[m - 1]} ${d}, ${y}` : `${months[m - 1]} ${y}`;
};

const doc = new DocBuilder("summary");
doc.pageFooter(PROVENANCE);

// 1. Title block
const p = data.patient;
doc.title({
  eyebrow: "FHIR-Rendered Summary",
  title: "Health Summary",
  meta: [p.name, `DOB ${fmtDate(p.birthDate)}`, `Generated ${fmtDate(p.generatedDate)}`],
});

// 2. Demographics key-value panel
doc.kvPanel([
  ["Name", p.name],
  ["DOB", fmtDate(p.birthDate)],
  ["Sex", p.sex],
  ["MRN", p.mrn],
  ["Generated", fmtDate(p.generatedDate)],
]);

// 3. Provenance callout
doc.callout("How this document was shared", [
  PROVENANCE,
  "The patient shared this document directly with you via a SMART Health Link, a patient-controlled, verifiable sharing mechanism.",
]);

// 4. Problems
doc.section("Problems");
doc.table({
  headers: ["Condition", "Clinical status", "Onset"],
  widths: ["*", 80, 60],
  rows: data.problems.map((x: any) => [
    x.condition,
    doc.badge(x.clinicalStatus),
    fmtDate(x.onset),
  ]),
});

// 5. Medications (40 rows, crosses pages, repeating header)
doc.section("Medications");
doc.table({
  headers: ["Medication", "Dose", "Sig (instructions)", "Status", "Authored", "Prescriber"],
  widths: [84, 52, "*", 50, 52, 60],
  rows: data.medications.map((m: any) => [
    { text: m.name, bold: false, fontSize: 8, lineHeight: 1.22, margin: [5, 3, 5, 3] },
    m.dose,
    m.sig,
    doc.badge(m.status),
    fmtDate(m.authoredOn),
    m.prescriber,
  ]),
});

// 6. Labs — flag HIGH/LOW
doc.section("Labs");
doc.table({
  headers: ["Test", "Value", "Unit", "Reference range", "Flag", "Date"],
  widths: ["*", 48, 64, 70, 50, 56],
  rows: data.labs.map((l: any) => [
    l.test,
    { text: l.value, fontSize: 8, lineHeight: 1.22, margin: [5, 3, 5, 3], ...(l.interpretation !== "NORMAL" ? { color: l.interpretation === "HIGH" ? "#a52a21" : "#9a5b10", font: "SourceSansSemi" } : {}) },
    l.unit,
    l.referenceRange,
    doc.badge(l.interpretation),
    fmtDate(l.date),
  ]),
});

// 7. Allergies
doc.section("Allergies");
doc.table({
  headers: ["Substance", "Reaction", "Criticality", "Status"],
  widths: [110, "*", 88, 50],
  rows: data.allergies.map((a: any) => [
    a.substance,
    a.reaction,
    doc.badge(a.criticality),
    doc.badge(a.status),
  ]),
});

// 8. Immunizations
doc.section("Immunizations");
doc.table({
  headers: ["Vaccine", "Date", "Status"],
  widths: ["*", 80, 80],
  rows: data.immunizations.map((i: any) => [i.vaccine, fmtDate(i.date), doc.badge(i.status)]),
});

// 9. wideTable — 9 columns, rendered on a landscape page (permitted by SPEC)
const wt = data.wideTable;
doc.section(wt.title, { landscape: true });
doc.table({
  headers: wt.columns,
  rows: wt.rows,
  fontSize: 6.8,
  widths: [52, 70, 76, 78, 86, 86, 84, 86, "*"],
});

const t0 = performance.now();
await doc.render(OUT);
console.log(`summary.pdf written in ${(performance.now() - t0).toFixed(0)} ms`);
