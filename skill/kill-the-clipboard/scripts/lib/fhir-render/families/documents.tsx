// Documents family: DocumentReference + remaining (non-lab) DiagnosticReports — clinical
// notes, reports, and advance directives — as one collection table, most-recent-first.
// Attachment rule: short text/plain payloads get an inline excerpt; anything binary
// (PDF, unknown, undecodable) is summarized as "(attached document, N KB)" — base64
// bodies are NEVER decoded into the output. PatientShared DocRefs (LOINC 51855-5 /
// 60591-5, multi-hundred-KB inline PDFs) ride the same compact path.
import type React from "react";
import type { FamilyRenderer } from "../types.ts";
import { badge, table, type Cell, type Span, type Theme } from "../engine.ts";

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

/** Calendar date as written in the source — no timezone conversion. */
function fmtDate(iso: any): string | undefined {
  const s = str(iso);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return /^\d{4}/.test(s) ? s.slice(0, 7) : s;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

const cap = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/-/g, " ");

const EXCERPT_MAX = 400;

/**
 * Decode an inline base64 text payload, or undefined if it isn't cleanly UTF-8 text
 * (U+FFFD means binary bytes — fall back to the size summary rather than emit garbage).
 */
function decodeTextData(data: any): string | undefined {
  const s = str(data);
  if (!s) return undefined;
  try {
    const buf = Buffer.from(s, "base64");
    if (!buf.length) return undefined;
    const text = buf.toString("utf8");
    if (text.includes("�")) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function excerpt(text: string): string {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  if (clean.length <= EXCERPT_MAX) return clean;
  const cut = clean.slice(0, EXCERPT_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > EXCERPT_MAX * 0.6 ? lastSpace : EXCERPT_MAX)} …`;
}

/** Base64 length → approximate decoded bytes; attachment.size wins when present. */
function attachmentBytes(att: any): number | undefined {
  if (typeof att?.size === "number" && att.size >= 0) return att.size;
  const data = str(att?.data);
  if (data) return Math.floor((data.length * 3) / 4);
  return undefined;
}

function sizeSummary(att: any): string {
  const bytes = attachmentBytes(att);
  const kb = bytes != null ? Math.max(1, Math.ceil(bytes / 1024)) : undefined;
  const title = str(att?.title);
  const label =
    kb != null
      ? `(attached document, ${kb} KB)`
      : str(att?.url)
        ? "(external document — not embedded)"
        : "(attachment unavailable)";
  return title ? `${title} — ${label}` : label;
}

function attachmentSpans(att: any): Span[] {
  if (!att || typeof att !== "object") return [];
  const ct = str(att.contentType) ?? "";
  if (ct.toLowerCase().startsWith("text/")) {
    const decoded = decodeTextData(att.data);
    if (decoded) {
      const spans: Span[] = [];
      const title = str(att.title);
      if (title) spans.push({ text: `\n${title}`, bold: true });
      spans.push({ text: `\n“${excerpt(decoded)}”` });
      return spans;
    }
  }
  return [{ text: `\n${sizeSummary(att)}` }];
}

function documentCell(r: any): Span[] {
  const isDocRef = r?.resourceType === "DocumentReference";
  const name = codeableText(isDocRef ? r?.type : r?.code) ?? str(r?.id) ?? "Document";
  const spans: Span[] = [{ text: name, bold: true }];

  const docStatus = str(r?.docStatus);
  if (docStatus && docStatus !== "final") spans.push({ text: `  [${cap(docStatus)}]` });

  const description = str(r?.description) ?? str(r?.conclusion);
  if (description) spans.push({ text: `\n${description}` });

  const encounter = arr(isDocRef ? r?.context?.encounter : [r?.encounter])
    .map((e: any) => str(e?.display))
    .filter((x): x is string => !!x);
  if (encounter.length) spans.push({ text: `\nVisit: ${encounter.join("; ")}` });

  for (const rel of arr(r?.relatesTo)) {
    const target = str(rel?.target?.display) ?? str(rel?.target?.reference);
    if (target) spans.push({ text: `\n${cap(str(rel?.code) ?? "related")}: ${target}` });
  }

  for (const res of arr(r?.result)) {
    const finding = str(res?.display);
    if (finding) spans.push({ text: `\nFinding: ${finding}` });
  }

  const attachments = isDocRef ? arr(r?.content).map((c: any) => c?.attachment) : arr(r?.presentedForm);
  for (const att of attachments) spans.push(...attachmentSpans(att));

  return spans;
}

function categoryCell(r: any): string {
  const texts = arr(r?.category)
    .map((c: any) => codeableText(c))
    .filter((x): x is string => !!x);
  return [...new Set(texts)].join("; ") || "—";
}

function authorCell(r: any): string {
  const who =
    r?.resourceType === "DiagnosticReport"
      ? [...arr(r?.performer), ...arr(r?.resultsInterpreter)]
      : arr(r?.author);
  const names = who.map((a: any) => str(a?.display) ?? str(a?.reference)).filter((x): x is string => !!x);
  return [...new Set(names)].join("\n") || "—";
}

const DOCREF_BADGE: Record<string, string> = {
  current: "active",
  superseded: "inactive",
  "entered-in-error": "stopped",
};

const REPORT_BADGE: Record<string, string> = {
  final: "completed",
  amended: "unable-to-assess",
  corrected: "unable-to-assess",
  appended: "unable-to-assess",
  preliminary: "active",
  partial: "active",
  registered: "active",
  cancelled: "stopped",
  "entered-in-error": "stopped",
  unknown: "inactive",
};

function statusBadge(t: Theme, r: any): React.ReactElement | string {
  const s = str(r?.status);
  if (!s) return "—";
  const kinds = r?.resourceType === "DiagnosticReport" ? REPORT_BADGE : DOCREF_BADGE;
  return badge(t, cap(s), kinds[s] ?? "inactive");
}

function sortKey(r: any): string {
  if (r?.resourceType === "DiagnosticReport") {
    return (
      str(r?.effectiveDateTime) ??
      str(r?.effectivePeriod?.start) ??
      str(r?.issued) ??
      str(arr(r?.presentedForm)[0]?.creation) ??
      ""
    );
  }
  return (
    str(r?.date) ??
    str(r?.context?.period?.start) ??
    str(arr(r?.content)[0]?.attachment?.creation) ??
    ""
  );
}

const documents: FamilyRenderer = {
  key: "documents",
  title: "Reports & Notes",
  order: 130,
  claims: (r: any) => r?.resourceType === "DocumentReference" || r?.resourceType === "DiagnosticReport",
  render(resources: any[], t: Theme): React.ReactElement[] {
    const sorted = [...arr(resources)].sort((a, b) =>
      sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0,
    );
    if (!sorted.length) return [];

    const rows: Cell[][] = sorted.map((r) => {
      try {
        return [fmtDate(sortKey(r)) ?? "—", documentCell(r), categoryCell(r), authorCell(r), statusBadge(t, r)];
      } catch {
        return ["—", [{ text: str(r?.id) ?? "Unreadable document record" }] as Span[], "—", "—", "—"];
      }
    });

    return [
      table(t, {
        columns: [
          { header: "Date", width: 13 },
          { header: "Document", width: 42 },
          { header: "Category", width: 13 },
          { header: "Author", width: 21 },
          { header: "Status", width: 11 },
        ],
        rows,
      }),
    ];
  },
};

export default documents;
