// Coverage & Devices family: Coverage + Device (US Core us-core-coverage,
// us-core-implantable-device). Two collection tables — insurance coverage rows with
// kv-style labeled cells, then devices/implants — one row per instance, most-recent-first.
// UDI carrier HRF strings are rendered verbatim (wrapped, never parsed or truncated).
import type React from "react";
import type { FamilyRenderer } from "../types.ts";
import { badge, para, table, type Cell, type Span, type Theme } from "../engine.ts";

const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

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

function humanize(code: string): string {
  const s = code.replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATUS_BADGE_KIND: Record<string, string> = {
  active: "active",
  cancelled: "stopped",
  "entered-in-error": "stopped",
  draft: "inactive",
  inactive: "inactive",
};

function statusCell(t: Theme, status: any): Cell {
  const s = str(status);
  if (!s) return "—";
  return badge(t, humanize(s), STATUS_BADGE_KIND[s] ?? "inactive");
}

/** Label + value on one line; bold label distinguishes the kv pairs stacked in a cell. */
function kvLine(spans: Span[], label: string, value: string | undefined) {
  if (!value) return;
  if (spans.length) spans.push({ text: "\n" });
  spans.push({ text: `${label} `, bold: true }, { text: value });
}

// ------------------------------------------------------------- Coverage ----

/** Display-only payor references are the norm in Epic exports; also resolve `#id` containeds. */
function payorName(cov: any, ref: any): string | undefined {
  const display = str(ref?.display);
  if (display) return display;
  const reference = str(ref?.reference);
  if (reference?.startsWith("#")) {
    const contained = arr(cov?.contained).find((c: any) => str(c?.id) === reference.slice(1));
    const name = str(contained?.name);
    if (name) return name;
  }
  return reference;
}

function memberIds(cov: any): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const ident of arr(cov?.identifier)) {
    const value = str(ident?.value);
    if (!value) continue;
    const typeCodes = arr(ident?.type?.coding).map((c: any) => str(c?.code));
    const typeText = str(ident?.type?.text) ?? "";
    if (typeCodes.includes("MB") || /member/i.test(typeText)) out.push({ label: "Member ID", value });
  }
  return out;
}

function payerSpans(cov: any): Span[] {
  const spans: Span[] = [];
  const names = arr(cov?.payor).map((p: any) => payorName(cov, p)).filter(Boolean) as string[];
  for (const n of names) {
    if (spans.length) spans.push({ text: "\n" });
    spans.push({ text: n, bold: true });
  }
  if (!spans.length) spans.push({ text: "(payer not specified)", bold: true });
  const type = codeableText(cov?.type);
  if (type) spans.push({ text: `\n${type}` });
  return spans;
}

function classSpans(cov: any): Span[] {
  const spans: Span[] = [];
  for (const cls of arr(cov?.class)) {
    const value = str(cls?.value);
    const name = str(cls?.name);
    if (!value && !name) continue;
    const label = codeableText(cls?.type) ?? "Class";
    kvLine(spans, label, [value, name].filter(Boolean).join(" — "));
  }
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function idSpans(cov: any): Span[] {
  const spans: Span[] = [];
  for (const m of memberIds(cov)) kvLine(spans, m.label, m.value);
  kvLine(spans, "Subscriber ID", str(cov?.subscriberId));
  kvLine(spans, "Dependent", str(cov?.dependent));
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function relationshipSpans(cov: any): Span[] {
  const raw = codeableText(cov?.relationship);
  const rel = raw ? humanize(raw) : undefined;
  const spans: Span[] = [{ text: rel ?? "—" }];
  const subscriber = str(cov?.subscriber?.display);
  // Subscriber name matters when the patient isn't the subscriber (e.g. spouse coverage).
  if (subscriber && raw?.toLowerCase() !== "self") spans.push({ text: `\n${subscriber}` });
  return spans;
}

function periodSpans(cov: any): Span[] {
  const start = fmtDate(cov?.period?.start);
  const end = fmtDate(cov?.period?.end);
  if (start && end) return [{ text: `${start} –\n${end}` }];
  if (start) return [{ text: `${start} –\n${str(cov?.status) === "active" ? "ongoing" : ""}`.trimEnd() }];
  if (end) return [{ text: `– ${end}` }];
  return [{ text: "—" }];
}

const COVERAGE_COLUMNS = [
  { header: "Payer", width: 2.5 },
  { header: "Plan / Group", width: 2.5 },
  { header: "IDs", width: 1.9 },
  { header: "Relationship", width: 1.3 },
  { header: "Period", width: 1.3 },
  { header: "Status", width: 1.1 },
];

function coverageRow(cov: any, t: Theme): Cell[] {
  try {
    return [
      payerSpans(cov),
      classSpans(cov),
      idSpans(cov),
      relationshipSpans(cov),
      periodSpans(cov),
      statusCell(t, cov?.status),
    ];
  } catch {
    return [degradedSpans(cov, "Coverage"), "", "", "", "", ""];
  }
}

// --------------------------------------------------------------- Device ----

function deviceName(dev: any): string | undefined {
  const named = arr(dev?.deviceName);
  return (
    named.map((n: any) => (n?.type === "user-friendly-name" ? str(n?.name) : undefined)).find(Boolean) ??
    named.map((n: any) => str(n?.name)).find(Boolean) ??
    codeableText(dev?.type)
  );
}

function deviceSpans(dev: any): Span[] {
  const spans: Span[] = [{ text: deviceName(dev) ?? "(device not specified)", bold: true }];
  const type = codeableText(dev?.type);
  if (type && type !== spans[0]!.text) spans.push({ text: `\n${type}` });
  const model =
    str(dev?.modelNumber) ?? arr(dev?.deviceName).map((n: any) => (n?.type === "model-name" ? str(n?.name) : undefined)).find(Boolean);
  kvLine(spans, "Model", model);
  kvLine(spans, "Mfr", str(dev?.manufacturer));
  const version = arr(dev?.version).map((v: any) => str(v?.value)).filter(Boolean).join(", ");
  kvLine(spans, "Version", version || undefined);
  for (const note of arr(dev?.note)) {
    const text = str(note?.text);
    if (text) {
      spans.push({ text: "\n" });
      spans.push({ text: "Note: ", bold: true }, { text });
    }
  }
  return spans;
}

/** HRF carrier strings are opaque, long, symbol-heavy tokens — show verbatim, never parse. */
function udiSpans(dev: any): Span[] {
  const spans: Span[] = [];
  for (const carrier of arr(dev?.udiCarrier)) {
    kvLine(spans, "DI", str(carrier?.deviceIdentifier));
    kvLine(spans, "HRF", str(carrier?.carrierHRF));
    const entry = str(carrier?.entryType);
    if (entry && entry !== "barcode") kvLine(spans, "Entry", entry);
  }
  kvLine(spans, "Distinct ID", str(dev?.distinctIdentifier));
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function lotSerialSpans(dev: any): Span[] {
  const spans: Span[] = [];
  kvLine(spans, "Lot", str(dev?.lotNumber));
  kvLine(spans, "Serial", str(dev?.serialNumber));
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

function deviceDateSpans(dev: any): Span[] {
  const spans: Span[] = [];
  kvLine(spans, "Mfg", fmtDate(dev?.manufactureDate));
  kvLine(spans, "Exp", fmtDate(dev?.expirationDate));
  if (!spans.length) spans.push({ text: "—" });
  return spans;
}

const DEVICE_COLUMNS = [
  { header: "Device", width: 3.0 },
  { header: "UDI", width: 2.4 },
  { header: "Lot / Serial", width: 1.5 },
  { header: "Dates", width: 1.7 },
  { header: "Status", width: 0.9 },
];

function deviceRow(dev: any, t: Theme): Cell[] {
  try {
    return [deviceSpans(dev), udiSpans(dev), lotSerialSpans(dev), deviceDateSpans(dev), statusCell(t, dev?.status)];
  } catch {
    return [degradedSpans(dev, "Device"), "", "", "", ""];
  }
}

// ------------------------------------------------------------- assembly ----

function degradedSpans(r: any, fallbackType: string): Span[] {
  let label = `${fallbackType} (could not be displayed)`;
  try {
    if (r?.id != null) label = `${fallbackType}/${String(r.id)} (could not be displayed)`;
  } catch {}
  return [{ text: label }];
}

function safeKey(fn: () => string | undefined): string {
  try {
    return fn() ?? "";
  } catch {
    return "";
  }
}

const coverageDevices: FamilyRenderer = {
  key: "coverage-devices",
  title: "Coverage & Devices",
  order: 120,
  claims: (r: any) => r?.resourceType === "Coverage" || r?.resourceType === "Device",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const list = Array.isArray(resources) ? resources : [];
    const coverages: any[] = [];
    const devices: any[] = [];
    const other: any[] = [];
    for (const r of list) {
      const type = (() => {
        try {
          return r?.resourceType;
        } catch {
          return undefined;
        }
      })();
      if (type === "Coverage") coverages.push(r);
      else if (type === "Device") devices.push(r);
      else other.push(r);
    }

    const els: React.ReactElement[] = [];

    if (coverages.length) {
      if (devices.length) els.push(para(theme, [{ text: "Insurance Coverage", bold: true }], { spaceAfter: 4 }));
      const rows = coverages
        .map((r) => ({ r, key: safeKey(() => str(r?.period?.start) ?? str(r?.period?.end)) }))
        .sort((a, b) => b.key.localeCompare(a.key))
        .map(({ r }) => coverageRow(r, theme));
      els.push(table(theme, { columns: COVERAGE_COLUMNS, rows }));
    }

    if (devices.length) {
      if (coverages.length) els.push(para(theme, [{ text: "Devices & Implants", bold: true }], { spaceAfter: 4 }));
      const rows = devices
        .map((r) => ({ r, key: safeKey(() => str(r?.manufactureDate) ?? str(r?.expirationDate)) }))
        .sort((a, b) => b.key.localeCompare(a.key))
        .map(({ r }) => deviceRow(r, theme));
      els.push(table(theme, { columns: DEVICE_COLUMNS, rows }));
    }

    // claims() admits only Coverage/Device, but a junk-shaped resource that slipped in
    // (hostile tests pass arbitrary values straight to render) still gets a degraded line.
    for (const r of other) {
      els.push(para(theme, degradedSpans(r, "Resource"), { spaceAfter: 2 }));
    }

    return els;
  },
};

export default coverageDevices;
