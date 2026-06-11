// Demographics family. The first claimed Patient is THE patient and renders as a
// kvPanel; every additional Patient instance gets one table row (volume rule — an
// instance may render degraded but never disappears).
import type * as React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { type Cell, kvPanel, para, table } from "../engine.ts";

const DATA_ABSENT_URL = "http://hl7.org/fhir/StructureDefinition/data-absent-reason";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const str = (x: any): string | undefined =>
  typeof x === "string" && x.trim() ? x.trim() : undefined;

const arr = (x: any): any[] => (Array.isArray(x) ? x : []);

const dataAbsent = (el: any): boolean =>
  arr(el?.extension).some((e: any) => e?.url === DATA_ABSENT_URL && str(e?.valueCode));

/** Date-part formatting only — never `new Date(iso)`, which shifts date-only values across timezones. */
const fmtDate = (iso: any): string | undefined => {
  const s = str(iso);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d] = m;
  if (!mo) return y;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
};

const formatName = (n: any): string | undefined => {
  const text = str(n?.text);
  if (text) return text;
  const parts = [...arr(n?.given), n?.family, ...arr(n?.suffix)]
    .map(str)
    .filter((x): x is string => !!x);
  return parts.length ? parts.join(" ") : undefined;
};

const isLatinish = (s: string): boolean => !/[\u2E80-\uFFFD\u{10000}-\u{10FFFF}]/u.test(s);

/**
 * Official name wins (us-core-6 allows fully data-absent names — say so rather than render
 * blank). The document fonts (Inter/Source Serif) carry no CJK glyphs: non-Latin text
 * renders as junk glyphs AND vanishes from the PDF text layer, so unrenderable names are
 * never printed — a Latin alias stands in and the suppressed original is flagged in words.
 */
const pickName = (p: any): { display: string; aka?: string } => {
  const usable = arr(p?.name)
    .map((n) => ({ n, s: formatName(n) }))
    .filter((x): x is { n: any; s: string } => !!x.s);
  const latin = usable.filter((x) => isLatinish(x.s));
  const suppressed = usable.length - latin.length;
  const best = latin.find((x) => x?.n?.use === "official") ?? latin[0];
  if (!best) {
    if (suppressed) return { display: "(name on file in non-Latin script)" };
    const absent = arr(p?.name).some(dataAbsent);
    return { display: absent ? "Unknown (name data absent)" : "(no name recorded)" };
  }
  const aka = latin
    .filter((x) => x !== best)
    .map((x) => (str(x.n?.use) ? `${x.s} (${x.n.use})` : x.s))
    .join("; ");
  return {
    display: suppressed ? `${best.s} (non-Latin name on file)` : best.s,
    aka: aka || undefined,
  };
};

const pickIdentifier = (p: any): { label: string; value: string } | undefined => {
  const ids = arr(p?.identifier).filter((i) => str(i?.value));
  if (!ids.length) return undefined;
  const mrn = ids.find(
    (i) =>
      arr(i?.type?.coding).some((c: any) => c?.code === "MR") ||
      /\b(mrn|medical record)\b/i.test(str(i?.type?.text) ?? "") ||
      /\bmrn\b/i.test(str(i?.system) ?? ""),
  );
  if (mrn) return { label: "MRN", value: str(mrn.value)! };
  const first = ids[0];
  const label = str(first?.type?.text) ?? str(arr(first?.type?.coding)[0]?.display) ?? "ID";
  return { label, value: str(first.value)! };
};

const formatAddress = (p: any): string | undefined => {
  const all = arr(p?.address);
  const a = all.find((x) => x?.use === "home") ?? all.find((x) => x?.use !== "old") ?? all[0];
  const cityState = [str(a?.city), str(a?.state)].filter(Boolean).join(", ");
  const out = [cityState || undefined, str(a?.postalCode)].filter(Boolean).join(" ");
  return out || str(arr(a?.line)[0]) || str(a?.country);
};

const formatPhone = (p: any): string | undefined => {
  const tel = arr(p?.telecom);
  const pick = tel.find((x) => x?.system === "phone" && str(x?.value)) ?? tel.find((x) => str(x?.value));
  if (!pick) return undefined;
  const tag = str(pick.use) ?? (pick.system !== "phone" ? str(pick.system) : undefined);
  return tag ? `${str(pick.value)} (${tag})` : str(pick.value);
};

const conceptText = (cc: any): string | undefined =>
  str(cc?.text) ?? str(arr(cc?.coding)[0]?.display) ?? str(arr(cc?.coding)[0]?.code);

const formatLanguage = (p: any): string | undefined => {
  const comms = arr(p?.communication)
    .map((c) => ({ text: conceptText(c?.language), preferred: c?.preferred === true }))
    .filter((c): c is { text: string; preferred: boolean } => !!c.text)
    .sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return comms.length ? comms.map((c) => c.text).join("; ") : undefined;
};

const formatBirth = (p: any): string =>
  fmtDate(p?.birthDate) ?? (dataAbsent(p?._birthDate) ? "Unknown (data absent)" : "—");

const cap = (s: any): string | undefined => {
  const v = str(s);
  return v ? v[0]!.toUpperCase() + v.slice(1) : undefined;
};

/** undefined = not deceased; "" = deceasedBoolean true with no date; else the formatted date. */
const deceasedWhen = (p: any): string | undefined => {
  if (str(p?.deceasedDateTime)) return fmtDate(p.deceasedDateTime);
  if (p?.deceasedBoolean === true) return "";
  return undefined;
};

const panelPairs = (p: any): [string, string][] => {
  const { display, aka } = pickName(p);
  const pairs: [string, string][] = [
    ["Name", display],
    ["Born", formatBirth(p)],
    ["Sex", cap(p?.gender) ?? "—"],
  ];
  const id = pickIdentifier(p);
  if (id) pairs.push([id.label, id.value]);
  const addr = formatAddress(p);
  if (addr) pairs.push(["Address", addr]);
  const phone = formatPhone(p);
  if (phone) pairs.push(["Phone", phone]);
  const lang = formatLanguage(p);
  if (lang) pairs.push(["Language", lang]);
  const dec = deceasedWhen(p);
  if (dec !== undefined) pairs.push(["Deceased", dec || "Yes (date not recorded)"]);
  if (aka) pairs.push(["Also known", aka]);
  return pairs;
};

const patientRow = (p: any): Cell[] => {
  try {
    const { display, aka } = pickName(p);
    const id = pickIdentifier(p);
    const dec = deceasedWhen(p);
    const details = [
      dec !== undefined ? (dec ? `Deceased ${dec}` : "Deceased") : undefined,
      formatAddress(p),
      formatLanguage(p),
      aka ? `AKA ${aka}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return [
      [{ text: display, bold: true }],
      formatBirth(p),
      cap(p?.gender) ?? "—",
      id ? `${id.label} ${id.value}` : "—",
      details || "—",
    ];
  } catch {
    return [String(p?.id ?? "(unreadable)"), "—", "—", "—", "Resource could not be fully rendered"];
  }
};

const patient: FamilyRenderer = {
  key: "patient",
  title: "Demographics",
  order: 10,
  claims: (r: any) => r?.resourceType === "Patient",
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const claimed = Array.isArray(resources) ? resources : [];
    if (!claimed.length) return [];
    const [primary, ...rest] = claimed;
    const out: React.ReactElement[] = [];
    try {
      out.push(kvPanel(theme, panelPairs(primary)));
    } catch {
      out.push(
        para(theme, `Patient record ${String(primary?.id ?? "(no id)")} could not be rendered.`, {
          muted: true,
        }),
      );
    }
    if (rest.length) {
      out.push(
        para(theme, [{ text: `Additional patient records in this export (${rest.length})`, bold: true }], {
          spaceAfter: 4,
        }),
      );
      out.push(
        table(theme, {
          columns: [
            { header: "Name", width: 2.6 },
            { header: "Born", width: 1.3 },
            { header: "Sex", width: 0.9 },
            { header: "Identifier", width: 1.8 },
            { header: "Details", width: 3.4 },
          ],
          rows: rest.map(patientRow),
        }),
      );
    }
    return out;
  },
};

export default patient;
