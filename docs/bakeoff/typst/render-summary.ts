// render-summary.ts — read summary-data.json and render via the Doc builder.

import { Doc, type Cell } from "./doc";

const PROVENANCE = "Shared by the patient via SMART Health Link — June 10, 2026";
const data = await Bun.file(`${import.meta.dir}/../content/summary-data.json`).json();

const fmtDate = (iso: string) => iso; // keep ISO dates as-is (dense clinical style)

const doc = new Doc("summary", PROVENANCE);

// 1. Title block
doc.title("Health Summary", {
  subtitle: "FHIR-rendered patient summary — for cardiology consultation",
  meta: [
    ["Patient", data.patient.name],
    ["DOB", data.patient.birthDate],
    ["Generated", data.patient.generatedDate],
  ],
});

// 2. Demographics key-value panel
doc.kvPanel([
  ["Name", data.patient.name],
  ["DOB", data.patient.birthDate],
  ["Sex", data.patient.sex],
  ["MRN", data.patient.mrn],
  ["Generated", data.patient.generatedDate],
]);

// 3. "How this document was shared" callout
doc.callout("How this document was shared", [
  { text: `${PROVENANCE}. ` },
  {
    text:
      "The patient shared this document directly with you via a SMART Health Link, a secure, patient-controlled link to their verifiable health records.",
  },
]);

// 4. Problems
doc.section("Problems");
doc.table({
  header: ["Condition", "Clinical status", "Onset"],
  widths: ["1fr", "auto", "auto"],
  size: 8.5,
  rows: data.problems.map((p: any): Cell[] => [
    p.condition,
    { badge: p.clinicalStatus },
    p.onset,
  ]),
});

// 5. Medications (40 rows; crosses pages; header must repeat)
doc.section("Medications");
doc.table({
  header: ["Medication", "Dose", "Sig (instructions)", "Status", "Authored", "Prescriber"],
  widths: ["1.35fr", "0.75fr", "2.6fr", "auto", "auto", "0.95fr"],
  size: 7.8,
  rows: data.medications.map((m: any): Cell[] => [
    m.name,
    m.dose,
    m.sig,
    { badge: m.status },
    fmtDate(m.authoredOn),
    m.prescriber,
  ]),
});

// 6. Labs (flag HIGH/LOW)
doc.section("Laboratory Results");
doc.table({
  header: ["Test", "Value", "Unit", "Reference range", "Flag", "Date"],
  widths: ["2.1fr", "auto", "auto", "auto", "auto", "auto"],
  size: 8,
  rows: data.labs.map((l: any): Cell[] => [
    l.test,
    l.value,
    l.unit,
    l.referenceRange,
    { labFlag: l.interpretation },
    l.date,
  ]),
});

// 7. Allergies
doc.section("Allergies & Intolerances");
doc.table({
  header: ["Substance", "Reaction", "Criticality", "Status"],
  widths: ["1.1fr", "2.1fr", "auto", "auto"],
  size: 8.5,
  rows: data.allergies.map((a: any): Cell[] => [
    a.substance,
    a.reaction,
    { badge: a.criticality },
    { badge: a.status },
  ]),
});

// 8. Immunizations
doc.section("Immunizations");
doc.table({
  header: ["Vaccine", "Date", "Status"],
  widths: ["1fr", "auto", "auto"],
  size: 8.5,
  rows: data.immunizations.map((im: any): Cell[] => [
    im.vaccine,
    im.date,
    { badge: im.status },
  ]),
});

// 9. Wide table (9 columns)
doc.section(data.wideTable.title);
doc.table({
  header: data.wideTable.columns,
  widths: ["0.78fr", "0.95fr", "1fr", "1fr", "1.15fr", "1.15fr", "1.1fr", "1.15fr", "1.1fr"],
  size: 6.5,
  rows: data.wideTable.rows,
});

await doc.pdf(`${import.meta.dir}/summary.pdf`);
console.log("wrote summary.pdf");
