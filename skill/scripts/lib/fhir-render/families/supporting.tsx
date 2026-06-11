// Supporting family: Practitioner, PractitionerRole, Organization, Location,
// RelatedPerson, Provenance (docs/DESIGN.md §7). Reference material, late order: one compact
// care-team table (one row per instance, grouped by kind — never dropped), then
// Provenance as one-line source rows. Location is normally won by `encounters` (earlier
// in registry order); it is still claimed and rendered here so the family is complete
// when used standalone.
import type React from "react";
import type { FamilyRenderer } from "../types.ts";
import { badge, para, table, type Cell, type Span, type Theme } from "../engine.ts";

const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

// v3-RoleCode labels for the code-only relationship codings Epic exports routinely ship.
const ROLE_CODE_LABELS: Record<string, string> = {
  SPS: "Spouse",
  ECON: "Emergency contact",
  GUARD: "Guardian",
  NOK: "Next of kin",
  PRN: "Parent",
  MTH: "Mother",
  FTH: "Father",
  CHD: "Child",
  CHILD: "Child",
  SIB: "Sibling",
  DOMPART: "Domestic partner",
  POWATT: "Power of attorney",
  CAREGIVER: "Caregiver",
};

/** text > coding display > mapped code > raw code — tolerates code-only and text-only concepts. */
function codeableText(cc: any, codeLabels?: Record<string, string>): string | undefined {
  if (!cc || typeof cc !== "object") return undefined;
  return (
    str(cc.text) ??
    arr(cc.coding)
      .map((c: any) => {
        const code = str(c?.code);
        return str(c?.display) ?? (code ? codeLabels?.[code] ?? code : undefined);
      })
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

function humanName(n: any): string | undefined {
  const text = str(n?.text);
  if (text) return text;
  const parts = [...arr(n?.prefix).map(str), ...arr(n?.given).map(str), str(n?.family)].filter(
    (x): x is string => !!x,
  );
  if (!parts.length) return undefined;
  const suffixes = arr(n?.suffix)
    .map(str)
    .filter((x): x is string => !!x)
    .join(", ");
  return suffixes ? `${parts.join(" ")}, ${suffixes}` : parts.join(" ");
}

function addressText(a: any): string | undefined {
  const parts = [
    ...arr(a?.line).map(str),
    str(a?.city),
    [str(a?.state), str(a?.postalCode)].filter(Boolean).join(" ") || undefined,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(", ") : undefined;
}

// Identifier systems worth surfacing by name; everything else (Epic urn:oid internal ids,
// facility staff ids) is deliberately omitted from the compact table.
const ID_LABELS: [string, string][] = [
  ["http://hl7.org/fhir/sid/us-npi", "NPI"],
  ["urn:oid:2.16.840.1.113883.4.7", "CLIA"],
  ["urn:oid:2.16.840.1.113883.6.300", "NAIC"],
  ["http://terminology.hl7.org/NamingSystem/NCSBNID", "NCSBN"],
];

function idCell(r: any): Cell {
  const ids = arr(r?.identifier);
  const spans: Span[] = [];
  for (const [system, label] of ID_LABELS) {
    const hit = ids.find((i: any) => str(i?.system) === system && str(i?.value));
    if (hit) {
      spans.push({ text: spans.length ? `\n${label}` : label, bold: true }, { text: `\n${str(hit.value)}` });
    }
  }
  return spans.length ? spans : "—";
}

function statusCell(t: Theme, r: any): Cell {
  if (r?.active === true) return badge(t, "Active", "active");
  if (r?.active === false) return badge(t, "Inactive", "inactive");
  return "—";
}

function nameSpans(primary: string | undefined, fallback: string, extras: string[] = []): Span[] {
  const spans: Span[] = primary ? [{ text: primary, bold: true }] : [{ text: fallback }];
  for (const e of extras) spans.push({ text: ` ("${e}")` });
  return spans;
}

function practitionerRow(t: Theme, r: any): Cell[] {
  const names = arr(r?.name);
  const primary = names.find((n: any) => str(n?.use) === "official") ?? names[0];
  const extras = names
    .filter((n: any) => n !== primary)
    .map(humanName)
    .filter((x): x is string => !!x);
  const quals = arr(r?.qualification)
    .map((q: any) => codeableText(q?.code))
    .filter((x): x is string => !!x)
    .join("; ");
  return [
    "Practitioner",
    nameSpans(humanName(primary), str(r?.id) ?? "(name not recorded)", extras),
    quals || "—",
    addressText(arr(r?.address)[0]) ?? "—",
    idCell(r),
    statusCell(t, r),
  ];
}

function practitionerRoleRow(t: Theme, r: any): Cell[] {
  const who = str(r?.practitioner?.display) ?? str(r?.practitioner?.reference);
  const codes = arr(r?.code)
    .map((c: any) => codeableText(c))
    .filter((x): x is string => !!x)
    .join("; ");
  const specialties = arr(r?.specialty)
    .map((s: any) => codeableText(s))
    .filter((x): x is string => !!x)
    .join("; ");
  const role = who
    ? [codes, specialties].filter((x, i, a) => x && a.indexOf(x) === i).join(" — ") || "—"
    : specialties || "—";
  const places = [
    str(r?.organization?.display) ?? str(r?.organization?.reference),
    ...arr(r?.location).map((l: any) => str(l?.display) ?? str(l?.reference)),
    ...arr(r?.endpoint).map((e: any) => str(e?.display) ?? str(e?.reference)),
  ].filter((x): x is string => !!x);
  return [
    "Role",
    nameSpans(who ?? (codes || undefined), str(r?.id) ?? "(unnamed role)"),
    role,
    places.join("\n") || "—",
    idCell(r),
    statusCell(t, r),
  ];
}

function organizationRow(t: Theme, r: any): Cell[] {
  const types = arr(r?.type)
    .map((ty: any) => codeableText(ty))
    .filter((x): x is string => !!x)
    .join("; ");
  return [
    "Organization",
    nameSpans(str(r?.name), str(r?.id) ?? "(unnamed organization)"),
    types || "—",
    addressText(arr(r?.address)[0]) ?? "—",
    idCell(r),
    statusCell(t, r),
  ];
}

function locationRow(t: Theme, r: any): Cell[] {
  const types = arr(r?.type)
    .map((ty: any) => codeableText(ty))
    .filter((x): x is string => !!x)
    .join("; ");
  return [
    "Location",
    nameSpans(str(r?.name), str(r?.id) ?? "(unnamed location)"),
    types || "—",
    addressText(r?.address) ?? str(r?.managingOrganization?.display) ?? "—",
    idCell(r),
    str(r?.status) === "active" ? badge(t, "Active", "active") : statusCell(t, r),
  ];
}

function relatedPersonRow(t: Theme, r: any): Cell[] {
  const relationships = arr(r?.relationship)
    .map((rel: any) => codeableText(rel, ROLE_CODE_LABELS))
    .filter((x): x is string => !!x)
    .join("; ");
  const years = [str(r?.period?.start)?.slice(0, 4), str(r?.period?.end)?.slice(0, 4)].filter(Boolean);
  const rel = (relationships || "—") + (years.length ? ` (${years.join(" – ")})` : "");
  return [
    "Related person",
    nameSpans(humanName(arr(r?.name)[0]), "(name not recorded)"),
    rel,
    addressText(arr(r?.address)[0]) ?? "—",
    idCell(r),
    statusCell(t, r),
  ];
}

function degradedRow(r: any): Cell[] {
  return [
    str(r?.resourceType) ?? "—",
    [{ text: str(r?.id) ?? "(unreadable record)" }] as Span[],
    "—",
    "—",
    "—",
    "—",
  ];
}

const ROW_BUILDERS: Record<string, (t: Theme, r: any) => Cell[]> = {
  Practitioner: practitionerRow,
  PractitionerRole: practitionerRoleRow,
  Organization: organizationRow,
  Location: locationRow,
  RelatedPerson: relatedPersonRow,
};

const KIND_RANK: Record<string, number> = {
  Practitioner: 0,
  PractitionerRole: 1,
  Organization: 2,
  Location: 3,
  RelatedPerson: 4,
};

function careSortKey(r: any): string {
  const rt = str(r?.resourceType);
  return (
    str(r?.name) ??
    humanName(arr(r?.name)[0]) ??
    (rt === "PractitionerRole" ? str(r?.practitioner?.display) : undefined) ??
    str(r?.id) ??
    ""
  ).toLowerCase();
}

function agentLine(agent: any): string {
  const who = str(agent?.who?.display) ?? str(agent?.who?.reference) ?? "Unknown agent";
  const type = codeableText(agent?.type);
  const typed = type ? type.charAt(0).toUpperCase() + type.slice(1) : undefined;
  const obo = str(agent?.onBehalfOf?.display) ?? str(agent?.onBehalfOf?.reference);
  if (typed && obo) return `${who} (${typed} for ${obo})`;
  if (typed) return `${who} (${typed})`;
  return obo ? `${who} (for ${obo})` : who;
}

function provenanceRow(r: any): Cell[] {
  const lines = arr(r?.agent).map(agentLine);
  const activity = codeableText(r?.activity);
  if (activity) lines.push(`Activity: ${activity}`);
  const n = arr(r?.target).length;
  return [
    fmtDate(r?.recorded) ?? "—",
    lines.length ? ([{ text: lines.join("\n") }] as Span[]) : "—",
    n ? `${n} record${n === 1 ? "" : "s"}` : "—",
  ];
}

const supporting: FamilyRenderer = {
  key: "supporting",
  title: "Care Team & Sources",
  order: 150,
  claims: (r: any) =>
    r?.resourceType === "Practitioner" ||
    r?.resourceType === "PractitionerRole" ||
    r?.resourceType === "Organization" ||
    r?.resourceType === "Location" ||
    r?.resourceType === "RelatedPerson" ||
    r?.resourceType === "Provenance",
  render(resources: any[], t: Theme): React.ReactElement[] {
    const people: any[] = [];
    const provs: any[] = [];
    for (const r of arr(resources)) {
      if (r?.resourceType === "Provenance") provs.push(r);
      else people.push(r); // unclaimed strays still get a degraded row — never drop
    }

    const out: React.ReactElement[] = [];

    if (people.length) {
      const sorted = [...people].sort((a, b) => {
        const ra = KIND_RANK[str(a?.resourceType) ?? ""] ?? 9;
        const rb = KIND_RANK[str(b?.resourceType) ?? ""] ?? 9;
        if (ra !== rb) return ra - rb;
        const ka = careSortKey(a);
        const kb = careSortKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      const rows: Cell[][] = sorted.map((r) => {
        try {
          const build = ROW_BUILDERS[str(r?.resourceType) ?? ""];
          return build ? build(t, r) : degradedRow(r);
        } catch {
          return degradedRow(r);
        }
      });
      out.push(
        table(t, {
          columns: [
            { header: "Kind", width: 10 },
            { header: "Name", width: 27 },
            { header: "Role / Relationship", width: 22 },
            { header: "Organization", width: 20 },
            { header: "Identifiers", width: 13 },
            { header: "Status", width: 8 },
          ],
          rows,
          fontSize: 8,
        }),
      );
    }

    if (provs.length) {
      const sortKey = (p: any) => str(p?.recorded) ?? "";
      const sorted = [...provs].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));
      const rows: Cell[][] = sorted.map((p) => {
        try {
          return provenanceRow(p);
        } catch {
          return ["—", [{ text: str(p?.id) ?? "(unreadable provenance)" }] as Span[], "—"];
        }
      });
      out.push(
        para(t, [{ text: "Record Sources (Provenance)", bold: true }], { spaceAfter: 4 }),
        table(t, {
          columns: [
            { header: "Recorded", width: 14 },
            { header: "Source / Agents", width: 72 },
            { header: "Targets", width: 14, align: "right" },
          ],
          rows,
          fontSize: 8,
        }),
      );
    }

    return out;
  },
};

export default supporting;
