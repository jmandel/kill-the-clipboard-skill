// social — the Observation catch-all (DESIGN.md §7 row 8): every Observation that
// vitals/labs didn't win (social-history, sdoh, survey, exam, smartdata, functional/
// disability status, smoking, pregnancy, occupation, ADI documentation, …) plus
// QuestionnaireResponse. Claim precedence makes the bare resourceType test correct here.
import type * as React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, para, table, type Cell, type Span } from "../engine.ts";

const str = (x: any): string => (typeof x === "string" ? x : "");

const datePart = (s: string): string => (s.length > 10 ? s.slice(0, 10) : s);

// dateTime kept readable and short enough that hyphenation never splits it mid-token.
const fmtDateTime = (s: string): string => (s.length > 10 ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s);

function fmtPeriod(p: any): string {
  const start = str(p?.start);
  const end = str(p?.end);
  if (start && end) return `${datePart(start)} – ${datePart(end)}`;
  if (start) return `${datePart(start)} – present`;
  if (end) return `until ${datePart(end)}`;
  return "";
}

// Prefer text, then a display from a standard (non-urn) system — Epic emits urn-system
// codings alongside standard ones inside the same concept — then any display, then a code.
function ccText(cc: any): string {
  if (!cc || typeof cc !== "object") return "";
  if (str(cc.text)) return cc.text;
  const codings = Array.isArray(cc.coding) ? cc.coding : [];
  const best =
    codings.find((c: any) => str(c?.display) && !str(c?.system).startsWith("urn:")) ??
    codings.find((c: any) => str(c?.display)) ??
    codings.find((c: any) => str(c?.code));
  return best ? str(best.display) || str(best.code) : "";
}

function qty(q: any): string {
  if (!q || typeof q !== "object") return "";
  const v = typeof q.value === "number" || typeof q.value === "string" ? String(q.value) : "";
  // UCUM annotation units like {PackYears} read better without the braces
  const unit = (str(q.unit) || str(q.code)).replace(/^\{(.+)\}$/, "$1");
  return [str(q.comparator), v, unit].filter(Boolean).join(" ");
}

function refLabel(root: any, ref: any): string {
  if (typeof ref === "string") return ref;
  if (!ref || typeof ref !== "object") return "";
  if (str(ref.display)) return ref.display;
  const r = str(ref.reference);
  if (r.startsWith("#")) {
    const c = (Array.isArray(root?.contained) ? root.contained : []).find((x: any) => x?.id === r.slice(1));
    const n0 = Array.isArray(c?.name) ? c.name[0] : c?.name;
    if (str(n0?.text)) return n0.text;
    if (n0 && typeof n0 === "object") {
      const parts = [
        ...(Array.isArray(n0.prefix) ? n0.prefix : []),
        ...(Array.isArray(n0.given) ? n0.given : []),
        n0.family,
      ];
      const joined = parts.filter((p) => str(p)).join(" ");
      if (joined) return joined;
    }
    if (str(c?.name)) return c.name;
  }
  return r ? (r.split("/").pop() ?? r) : "";
}

function attachmentText(a: any): string {
  if (!a || typeof a !== "object") return "";
  let s = [str(a.title) || "attachment", str(a.contentType)].filter(Boolean).join(" — ");
  if (str(a.contentType).startsWith("text/") && str(a.data) && a.data.length < 8192) {
    try {
      const decoded = Buffer.from(a.data, "base64").toString("utf8").trim();
      if (decoded) s += `\n${decoded}`;
    } catch {
      /* undecodable attachment data: keep title/contentType only */
    }
  }
  return s;
}

/** Render any value[x] (Observation, component, or QR answer shape) to display text. */
function anyValue(root: any, obj: any): { found: boolean; text: string } {
  if (!obj || typeof obj !== "object") return { found: false, text: "" };
  if ("valueQuantity" in obj) return { found: true, text: qty(obj.valueQuantity) };
  if ("valueCodeableConcept" in obj) return { found: true, text: ccText(obj.valueCodeableConcept) };
  if ("valueCoding" in obj) return { found: true, text: str(obj.valueCoding?.display) || str(obj.valueCoding?.code) };
  if ("valueString" in obj) return { found: true, text: str(obj.valueString) };
  if ("valueBoolean" in obj)
    return { found: true, text: obj.valueBoolean === true ? "Yes" : obj.valueBoolean === false ? "No" : "" };
  if ("valueInteger" in obj) return { found: true, text: obj.valueInteger != null ? String(obj.valueInteger) : "" };
  if ("valueDecimal" in obj) return { found: true, text: obj.valueDecimal != null ? String(obj.valueDecimal) : "" };
  if ("valueRange" in obj) {
    const lo = qty(obj.valueRange?.low);
    const hi = qty(obj.valueRange?.high);
    return { found: true, text: lo && hi ? `${lo} – ${hi}` : lo ? `≥ ${lo}` : hi ? `≤ ${hi}` : "" };
  }
  if ("valueRatio" in obj) {
    const n = qty(obj.valueRatio?.numerator);
    const d = qty(obj.valueRatio?.denominator);
    return { found: true, text: n || d ? `${n || "?"} / ${d || "?"}` : "" };
  }
  if ("valueTime" in obj) return { found: true, text: str(obj.valueTime) };
  if ("valueDate" in obj) return { found: true, text: str(obj.valueDate) };
  if ("valueDateTime" in obj) return { found: true, text: fmtDateTime(str(obj.valueDateTime)) };
  if ("valuePeriod" in obj) return { found: true, text: fmtPeriod(obj.valuePeriod) };
  if ("valueAttachment" in obj) return { found: true, text: attachmentText(obj.valueAttachment) };
  if ("valueReference" in obj) return { found: true, text: refLabel(root, obj.valueReference) };
  if ("valueUri" in obj) return { found: true, text: str(obj.valueUri) };
  if ("valueSampledData" in obj) return { found: true, text: "(sampled data series)" };
  return { found: false, text: "" };
}

const categoryCodes = (r: any): string[] =>
  (Array.isArray(r?.category) ? r.category : [])
    .flatMap((c: any) => [...(Array.isArray(c?.coding) ? c.coding.map((x: any) => x?.code) : []), c?.text])
    .filter((x: any) => typeof x === "string")
    .map((x: string) => x.toLowerCase());

// Group order is also render order; first matching def (scanning all of a resource's
// category codes) wins, so specific clinical groupings beat the generic "survey" tag.
const GROUP_DEFS: { label: string; codes: string[] }[] = [
  { label: "Advance Directive Documentation", codes: ["observation-adi-documentation"] },
  { label: "Care & Treatment Preferences", codes: ["care-experience-preference", "treatment-intervention-preference"] },
  { label: "Social Determinants of Health", codes: ["sdoh", "screening-assessment"] },
  { label: "Disability Status", codes: ["disability-status"] },
  { label: "Functional Status", codes: ["functional-status"] },
  { label: "Social History", codes: ["social-history"] },
  { label: "Surveys & Assessments", codes: ["survey"] },
  { label: "Exam", codes: ["exam"] },
  { label: "SmartData Elements", codes: ["smartdata"] },
];
const OTHER_GROUP = "Other Observations";

function groupLabel(o: any): string {
  const codes = categoryCodes(o);
  for (const def of GROUP_DEFS) if (def.codes.some((c) => codes.includes(c))) return def.label;
  return OTHER_GROUP;
}

const OBS_STATUS_BADGE: Record<string, { label?: string; kind: string }> = {
  amended: { kind: "completed" },
  corrected: { kind: "completed" },
  preliminary: { kind: "unable-to-assess" },
  registered: { kind: "inactive" },
  "entered-in-error": { label: "in error", kind: "stopped" },
  cancelled: { kind: "stopped" },
  unknown: { kind: "inactive" },
};

// Status badge only when it changes interpretation; "final" is the norm and stays quiet.
function statusCell(t: Theme, status: string): Cell {
  if (!status || status === "final") return "";
  const m = OBS_STATUS_BADGE[status];
  return badge(t, m?.label ?? status, m?.kind ?? "inactive");
}

function obsDateKey(o: any): string {
  return (
    str(o?.effectiveDateTime) ||
    str(o?.effectiveInstant) ||
    str(o?.effectivePeriod?.end) ||
    str(o?.effectivePeriod?.start) ||
    str(o?.issued) ||
    ""
  );
}

function obsDateText(o: any): string {
  const dt = str(o?.effectiveDateTime) || str(o?.effectiveInstant);
  if (dt) return datePart(dt);
  if (o?.effectivePeriod && typeof o.effectivePeriod === "object") return fmtPeriod(o.effectivePeriod);
  const issued = str(o?.issued);
  return issued ? datePart(issued) : "";
}

const SUPPORTING_INFO_URL = "http://hl7.org/fhir/StructureDefinition/workflow-supportingInfo";

function obsRow(t: Theme, o: any): { cells: Cell[]; flagged: boolean } {
  const status = str(o?.status);
  const name: Span[] = [{ text: ccText(o?.code) || str(o?.id) || "(uncoded observation)", bold: true }];
  const performers = (Array.isArray(o?.performer) ? o.performer : []).map((p: any) => refLabel(o, p)).filter(Boolean);
  if (performers.length) name.push({ text: `\nby ${performers.join("; ")}` });

  const result: Span[] = [];
  const v = anyValue(o, o);
  const members = Array.isArray(o?.hasMember) ? o.hasMember : [];
  if (v.found && v.text) result.push({ text: v.text });
  else if (o?.dataAbsentReason)
    result.push({ text: `Not recorded — ${ccText(o.dataAbsentReason) || "no reason given"}` });
  // a hasMember panel deliberately has no value of its own (US Core screening guidance)
  else if (members.length)
    result.push({ text: `Panel of ${members.length} member result${members.length === 1 ? "" : "s"}:` });
  else result.push({ text: "—" });

  for (const m of members) {
    const label = refLabel(o, m);
    if (label) result.push({ text: `\n• ${label}` });
  }
  for (const c of Array.isArray(o?.component) ? o.component : []) {
    const cv = anyValue(o, c);
    const cval = cv.text || (c?.dataAbsentReason ? `not recorded — ${ccText(c.dataAbsentReason)}` : "—");
    result.push({ text: `\n${ccText(c?.code) || "Component"}: ${cval}` });
  }
  for (const ext of Array.isArray(o?.extension) ? o.extension : []) {
    if (ext?.url === SUPPORTING_INFO_URL && ext?.valueReference) {
      const label = refLabel(o, ext.valueReference);
      if (label) result.push({ text: `\nSupporting document: ${label}` });
    }
  }
  const derived = (Array.isArray(o?.derivedFrom) ? o.derivedFrom : []).map((d: any) => refLabel(o, d)).filter(Boolean);
  if (derived.length) result.push({ text: `\nSource: ${derived.join("; ")}` });
  for (const n of Array.isArray(o?.note) ? o.note : []) {
    if (str(n?.text)) result.push({ text: `\nNote: ${n.text}` });
  }

  return {
    cells: [obsDateText(o), name, result, statusCell(t, status)],
    flagged: status === "entered-in-error",
  };
}

const OBS_COLUMNS = [
  { header: "Date", width: 1.4 },
  { header: "Observation", width: 3.2 },
  { header: "Result", width: 4.4 },
  { header: "Status", width: 1.2 },
];

function renderObsGroup(t: Theme, label: string, group: any[]): React.ReactElement[] {
  const sorted = [...group].sort((a, b) => {
    try {
      return obsDateKey(b).localeCompare(obsDateKey(a));
    } catch {
      return 0;
    }
  });
  const rows: Cell[][] = [];
  const flagged = new Set<number>();
  for (const o of sorted) {
    try {
      const r = obsRow(t, o);
      if (r.flagged) flagged.add(rows.length);
      rows.push(r.cells);
    } catch {
      rows.push([
        "",
        [{ text: str(o?.id) || "(unreadable record)", bold: true }],
        [{ text: "(could not render this record)" }],
        "",
      ]);
    }
  }
  return [
    para(t, [{ text: `${label} (${group.length})`, bold: true }], { spaceAfter: 3 }),
    table(t, { columns: OBS_COLUMNS, rows, flagRow: (_row, i) => flagged.has(i) }),
  ];
}

// --------------------------------------------------------- QuestionnaireResponse ----

function qrTitle(qr: any): string {
  // _questionnaire carries primitive extensions: standard display + US Core questionnaire-uri
  const exts = Array.isArray(qr?._questionnaire?.extension) ? qr._questionnaire.extension : [];
  for (const e of exts) {
    if (str(e?.url).endsWith("/display") && str(e?.valueString)) return e.valueString;
  }
  const q = str(qr?.questionnaire);
  return q ? (q.split("/").pop() ?? q) : "Questionnaire response";
}

const INDENT = "   "; // en-spaces survive PDF text shaping; ASCII runs may collapse

function qrRows(qr: any): Cell[][] {
  const rows: Cell[][] = [];
  const walk = (items: any, depth: number) => {
    if (!Array.isArray(items) || depth > 16) return;
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const qtext = INDENT.repeat(depth) + (str(it.text) || str(it.linkId) || "(question)");
      const answers = Array.isArray(it.answer) ? it.answer : [];
      if (!answers.length && Array.isArray(it.item) && it.item.length) {
        rows.push([[{ text: qtext, bold: true }], ""]);
        walk(it.item, depth + 1);
        continue;
      }
      const texts = answers.map((a: any) => anyValue(qr, a).text).filter(Boolean);
      rows.push([qtext, texts.length ? texts.join("\n") : [{ text: "— no answer recorded" }]]);
      // US Core allows items nested under the answer (answer[].item) AND under the
      // question item (item.item) — recurse into both shapes.
      for (const a of answers) if (Array.isArray(a?.item)) walk(a.item, depth + 1);
      if (answers.length && Array.isArray(it.item)) walk(it.item, depth + 1);
    }
  };
  walk(qr?.item, 0);
  if (!rows.length) rows.push([[{ text: "(no questions recorded)" }], ""]);
  return rows;
}

function renderQr(t: Theme, qr: any): React.ReactElement[] {
  const head: Span[] = [{ text: qrTitle(qr), bold: true }];
  const authored = str(qr?.authored);
  if (authored) head.push({ text: `  —  ${fmtDateTime(authored)}` });
  const author = refLabel(qr, qr?.author);
  if (author) head.push({ text: ` · ${author}` });
  const status = str(qr?.status);
  if (status && status !== "completed") head.push({ text: ` · ${status}` });
  return [
    para(t, head, { spaceAfter: 3 }),
    table(t, {
      columns: [
        { header: "Question", width: 4.5 },
        { header: "Answer", width: 5.5 },
      ],
      rows: qrRows(qr),
    }),
  ];
}

// ------------------------------------------------------------------------ family ----

const social: FamilyRenderer = {
  key: "social",
  title: "Social History, Surveys & Other Observations",
  order: 80,
  claims: (r: any) => r?.resourceType === "Observation" || r?.resourceType === "QuestionnaireResponse",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    try {
      const qrs: any[] = [];
      const obs: any[] = [];
      for (const r of Array.isArray(resources) ? resources : []) {
        if (r?.resourceType === "QuestionnaireResponse") qrs.push(r);
        else obs.push(r); // catch-all bucket: garbage inputs become degraded rows, never lost
      }

      const groups = new Map<string, any[]>();
      for (const o of obs) {
        let label = OTHER_GROUP;
        try {
          label = groupLabel(o);
        } catch {
          /* hostile category shape: fall through to Other */
        }
        (groups.get(label) ?? groups.set(label, []).get(label)!).push(o);
      }

      const els: React.ReactElement[] = [];
      for (const label of [...GROUP_DEFS.map((d) => d.label), OTHER_GROUP]) {
        const group = groups.get(label);
        if (group?.length) els.push(...renderObsGroup(theme, label, group));
      }

      if (qrs.length) {
        els.push(para(theme, [{ text: `Questionnaire Responses (${qrs.length})`, bold: true }], { spaceAfter: 3 }));
        const sorted = [...qrs].sort((a, b) => str(b?.authored).localeCompare(str(a?.authored)));
        for (const qr of sorted) {
          try {
            els.push(...renderQr(theme, qr));
          } catch {
            els.push(
              para(theme, [
                { text: str(qr?.id) || "QuestionnaireResponse", bold: true },
                { text: " — could not render this record" },
              ]),
            );
          }
        }
      }
      return els;
    } catch (e) {
      return [para(theme, `Section could not be rendered: ${e instanceof Error ? e.message : String(e)}`)];
    }
  },
};

export default social;
