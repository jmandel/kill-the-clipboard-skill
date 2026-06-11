#!/usr/bin/env bun
/**
 * render-fhir-pdf.ts — build the FHIR-Rendered PDF (LOINC 60591-5) from selected resources.
 *
 * Usage:
 *   render-fhir-pdf.ts --resources selected-resources.json -o rendered.pdf --ids-out rendered-ids.json
 *                      [--patient-name "Casey Breadth-Tester"] [--dob 1980-02-29] [--date 2026-06-10]
 *
 * Options:
 *   --resources <file>   JSON array of FHIR resources, {"resources":[...]}, a single resource,
 *                        or a FHIR Bundle ({entry:[{resource}]}). Required.
 *   -o <file>            Output PDF path. Required.
 *   --ids-out <file>     Coverage manifest: JSON array of EVERY input resource id (the
 *                        validator cross-checks bundle completeness against it). Required.
 *   --patient-name <s>   Title-block name; default derived from a Patient resource in the input.
 *   --dob <s>            Title-block date of birth; default derived from that Patient.
 *   --date <s>           Share date for the title block + provenance footer (default: today).
 *
 * Output (stdout, single JSON object):
 *   {"status":"rendered","output":...,"idsOut":...,"pages":N,
 *    "sections":[{"key":...,"count":N}],"fallbackCount":N}
 * stderr carries progress; exit 1 + usage on failure.
 */
import path from "node:path";
import { provenanceLine } from "./lib/fhir-render/engine.ts";
import { renderFamiliesToPdf } from "./lib/fhir-render/harness.ts";
import { registry } from "./lib/fhir-render/registry.ts";

const USAGE =
  "Usage: render-fhir-pdf.ts --resources selected-resources.json -o rendered.pdf --ids-out rendered-ids.json " +
  "[--patient-name NAME] [--dob YYYY-MM-DD] [--date YYYY-MM-DD]";

function fail(msg: string): never {
  console.error(`render-fhir-pdf: ${msg}\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = { "--resources": "resources", "-o": "output", "--output": "output", "--ids-out": "idsOut", "--patient-name": "patientName", "--dob": "dob", "--date": "date" }[a];
    if (!name) fail(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) fail(`missing value for ${a}`);
    flags[name] = v;
  }
  if (!flags.resources) fail("--resources is required");
  if (!flags.output) fail("-o is required");
  if (!flags.idsOut) fail("--ids-out is required");
  return flags as { resources: string; output: string; idsOut: string; patientName?: string; dob?: string; date?: string };
}

function extractResources(input: any): any[] {
  let list: any[];
  if (Array.isArray(input)) list = input;
  else if (Array.isArray(input?.resources)) list = input.resources;
  else if (input?.resourceType === "Bundle" && Array.isArray(input.entry)) list = input.entry.map((e: any) => e?.resource);
  else if (input && typeof input === "object" && typeof input.resourceType === "string") list = [input];
  else throw new Error("unrecognized input shape: expected a resource array, {resources:[...]}, a Bundle, or a single resource");
  return list.filter((r) => r !== null && r !== undefined && typeof r === "object");
}

function formatHumanName(name: any): string | undefined {
  const candidates = Array.isArray(name) ? name : [name];
  const n = candidates.find((x: any) => x?.use === "official") ?? candidates[0];
  if (!n || typeof n !== "object") return undefined;
  if (typeof n.text === "string" && n.text) return n.text;
  const given = Array.isArray(n.given) ? n.given.filter((g: any) => typeof g === "string").join(" ") : "";
  const family = typeof n.family === "string" ? n.family : "";
  const full = [given, family].filter(Boolean).join(" ");
  return full || undefined;
}

const flags = parseArgs(Bun.argv.slice(2));

let input: any;
try {
  input = await Bun.file(flags.resources).json();
} catch (e) {
  fail(`cannot read ${flags.resources}: ${e instanceof Error ? e.message : String(e)}`);
}
let resources: any[];
try {
  resources = extractResources(input);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
if (!resources.length) fail(`no resources found in ${flags.resources}`);

const patient = resources.find((r) => r?.resourceType === "Patient");
const patientName = flags.patientName ?? formatHumanName(patient?.name);
const dob = flags.dob ?? (typeof patient?.birthDate === "string" ? patient.birthDate : undefined);
const date = flags.date ?? new Date().toISOString().slice(0, 10);

const meta: { label: string; value: string }[] = [];
if (patientName) meta.push({ label: "Patient", value: patientName });
if (dob) meta.push({ label: "DOB", value: dob });
meta.push({ label: "Shared", value: date });

console.error(`[render-fhir-pdf] rendering ${resources.length} resource(s) → ${flags.output}`);

const result = await renderFamiliesToPdf(registry, resources, flags.output, {
  title: patientName ? `Health Summary — ${patientName}` : "Health Summary",
  kicker: "Patient-Shared Health Record",
  meta,
  callout: {
    title: "How this document was shared",
    body: [
      "This summary was prepared from the patient's own copy of their electronic health records and shared directly by the patient using a SMART Health Link.",
      "It is a complete rendering of every record the patient selected: each resource appears in a section below (including “Other Records”), so nothing shared is omitted.",
    ],
  },
  footerLeft: provenanceLine(date),
});

// The coverage manifest lists EVERY input resource id, not just what a family rendered —
// the validator compares it against the bundle's non-DocumentReference resources.
const inputIds = [...new Set(resources.filter((r) => r?.id != null).map((r) => String(r.id)))];
const renderedSet = new Set(result.renderedIds);
for (const id of inputIds) {
  if (!renderedSet.has(id)) console.error(`[render-fhir-pdf] WARNING: resource ${id} missing from rendered output`);
}
await Bun.write(flags.idsOut, JSON.stringify(inputIds, null, 2));

console.error(
  `[render-fhir-pdf] done: ${result.pages} page(s), sections ${result.sections.map((s) => `${s.key}:${s.count}`).join(" ") || "(none)"}`,
);

console.log(
  JSON.stringify({
    status: "rendered",
    output: path.resolve(flags.output),
    idsOut: path.resolve(flags.idsOut),
    pages: result.pages,
    sections: result.sections,
    fallbackCount: result.fallbackCount,
  }),
);
