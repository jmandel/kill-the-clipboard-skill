// Care-coordination family: CarePlan / CareTeam / Goal / ServiceRequest (DESIGN §7).
// CarePlans are narrative-driven in the wild (Epic puts the whole plan in text.div with
// text.status=additional and NO activity[]), so this family — alone among families, and
// per its rendering spec — extracts capped plain text from text.div as the plan details
// when structure is absent, plus an activity list when activity[] is present.
import type React from "react";
import type { FamilyRenderer, Theme } from "../types.ts";
import { badge, para, table, type Cell, type Span } from "../engine.ts";

const CLAIMED_TYPES = new Set(["CarePlan", "CareTeam", "Goal", "ServiceRequest"]);

const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const SYSTEM_LABELS: [RegExp, string][] = [
  [/snomed/i, "SNOMED"],
  [/loinc/i, "LOINC"],
  [/nucc/i, "NUCC"],
  [/cpt/i, "CPT"],
  [/rxnorm/i, "RxNorm"],
];

// Code-only codings (e.g. SNOMED 41672002 with no display) get a system+code label.
const codeLabel = (coding: any): string | undefined => {
  const code = str(coding?.code);
  if (!code) return undefined;
  const sys = str(coding?.system) ?? "";
  const named = SYSTEM_LABELS.find(([re]) => re.test(sys));
  return named ? `${named[1]} ${code}` : code;
};

const conceptText = (cc: any): string | undefined => {
  const txt = str(cc?.text);
  if (txt) return txt;
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  for (const c of codings) {
    const d = str(c?.display);
    if (d) return d;
  }
  for (const c of codings) {
    const l = codeLabel(c);
    if (l) return l;
  }
  return undefined;
};

const fmtDate = (v: any): string => (typeof v === "string" ? v.slice(0, 10) : "");

const fmtPeriod = (p: any): string => {
  const s = fmtDate(p?.start);
  const e = fmtDate(p?.end);
  if (s && e) return `${s} – ${e}`;
  if (s) return `${s} –`;
  if (e) return `until ${e}`;
  return "";
};

const qty = (q: any): string | undefined => {
  if (q?.value == null) return undefined;
  const unit = str(q.unit) ?? str(q.code);
  return unit ? `${q.value} ${unit}` : String(q.value);
};

const PERIOD_UNITS: Record<string, string> = { s: "sec", min: "min", h: "hr", d: "day", wk: "week", mo: "month", a: "year" };

const repeatText = (rep: any): string | undefined => {
  const freq = rep?.frequency;
  const period = rep?.period;
  if (typeof freq !== "number" || typeof period !== "number") return undefined;
  const unit = PERIOD_UNITS[str(rep?.periodUnit) ?? ""] ?? str(rep?.periodUnit) ?? "";
  if (period === 1) return freq === 1 ? `once per ${unit}` : `${freq}x/${unit}`;
  return `${freq}x per ${period} ${unit}`.trim();
};

const STATUS_KIND: Record<string, string> = {
  active: "active",
  "in-progress": "active",
  completed: "completed",
  achieved: "completed",
  "on-hold": "unable-to-assess",
  suspended: "unable-to-assess",
  draft: "unable-to-assess",
  proposed: "unable-to-assess",
  planned: "unable-to-assess",
  accepted: "unable-to-assess",
  revoked: "stopped",
  cancelled: "stopped",
  rejected: "stopped",
  "entered-in-error": "stopped",
  inactive: "inactive",
};

const statusBadge = (t: Theme, status: any): React.ReactElement => {
  const label = str(status) ?? "unknown";
  return badge(t, label, STATUS_KIND[label] ?? "inactive");
};

const byDateDesc = (dateOf: (r: any) => string) => (a: any, b: any) => {
  let da = "";
  let db = "";
  try {
    da = dateOf(a);
    db = dateOf(b);
  } catch {}
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

// ------------------------------------------------- narrative (text.div) extraction ----

const ENTITIES: Record<string, string> = {
  lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", bull: "•", middot: "·", deg: "°", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", times: "×", copy: "©", reg: "®", trade: "™", sect: "§",
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return ""; }
    })
    // &amp; must decode LAST so "&amp;lt;" yields the literal "&lt;".
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() === "amp" ? m : ENTITIES[name.toLowerCase()] ?? m))
    .replace(/&amp;/gi, "&");

// \x01/\x02 bracket heading text so it can be bolded after tag stripping.
const htmlToLines = (div: any): { text: string; bold: boolean }[] => {
  if (typeof div !== "string" || !div.trim()) return [];
  const marked = div
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<h[1-6][^>]*>/gi, "\n\x01")
    .replace(/<\/h[1-6]\s*>/gi, "\x02\n")
    .replace(/<\/(td|th)\s*>/gi, "  |  ")
    .replace(/<\/(p|div|ul|ol|li|table|tr|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const decoded = decodeEntities(marked)
    .replace(/[ \t]+\|\s*(?=\n|$)/gm, "")
    .replace(/[ \t]+/g, " ");
  return decoded
    .split("\n")
    .map((ln) => {
      const bold = ln.includes("\x01");
      return { text: ln.replace(/[\x01\x02]/g, "").trim(), bold };
    })
    .filter((ln) => ln.text.length > 0);
};

const narrativeSpans = (div: any, cap: number): Span[] => {
  const spans: Span[] = [];
  let used = 0;
  for (const ln of htmlToLines(div)) {
    const sep = spans.length ? "\n" : "";
    if (used + ln.text.length > cap) {
      const room = Math.max(0, cap - used);
      spans.push({ text: `${sep}${ln.text.slice(0, room)} …`, bold: ln.bold || undefined });
      break;
    }
    spans.push({ text: sep + ln.text, bold: ln.bold || undefined });
    used += ln.text.length;
  }
  return spans;
};

// ----------------------------------------------------------------------- care plans ----

const categoryText = (r: any): string | undefined => {
  const cats = Array.isArray(r?.category) ? r.category : [];
  for (const c of cats) {
    const txt = conceptText(c);
    if (txt) return txt;
  }
  return undefined;
};

const displayList = (arr: any): string[] =>
  (Array.isArray(arr) ? arr : []).map((x: any) => str(x?.display) ?? str(x?.reference)).filter(Boolean) as string[];

const planCell = (r: any): Span[] => {
  const spans: Span[] = [{ text: str(r?.title) ?? categoryText(r) ?? "Care plan", bold: true }];
  const tags = [str(r?.intent), str(r?.author?.display)].filter(Boolean) as string[];
  if (tags.length) spans.push({ text: `\n${tags.join(" · ")}` });
  const addresses = displayList(r?.addresses);
  if (addresses.length) spans.push({ text: `\nAddresses: ${addresses.join("; ")}` });
  return spans;
};

const activityLines = (r: any): string[] => {
  const lines: string[] = [];
  for (const g of displayList(r?.goal)) lines.push(`Goal: ${g}`);
  for (const a of Array.isArray(r?.activity) ? r.activity : []) {
    try {
      const d = a?.detail;
      if (d) {
        const name = conceptText(d?.code) ?? str(d?.description) ?? "(activity)";
        const sched =
          repeatText(d?.scheduledTiming?.repeat) ??
          conceptText(d?.scheduledTiming?.code) ??
          (fmtPeriod(d?.scheduledPeriod) || undefined) ??
          str(d?.scheduledString);
        const who = displayList(d?.performer)[0] ?? str(d?.location?.display);
        const tail = [str(d?.status), sched, who].filter(Boolean).join(", ");
        lines.push(`• ${name}${tail ? ` — ${tail}` : ""}`);
        const desc = str(d?.description);
        if (desc && desc !== name) lines.push(`   ${desc}`);
      } else if (a?.reference) {
        lines.push(`• ${str(a.reference?.display) ?? str(a.reference?.reference) ?? "(activity)"}`);
      } else if (a && typeof a === "object") {
        lines.push("• (activity)");
      }
      for (const p of Array.isArray(a?.progress) ? a.progress : []) {
        const note = str(p?.text);
        if (note) lines.push(`   ${note}`);
      }
    } catch {
      lines.push("• (unreadable activity)");
    }
  }
  return lines;
};

const planDetailsCell = (r: any): Span[] => {
  const acts = activityLines(r);
  // Epic-style plans carry their substance in text.div; structured plans only need the
  // short generated summary, so the narrative cap shrinks when activity[] exists. The
  // 2600 cap keeps a narrative-only row under one page height (rows are atomic).
  const spans = narrativeSpans(r?.text?.div, acts.length ? 280 : 2600);
  for (const ln of acts) spans.push({ text: (spans.length ? "\n" : "") + ln });
  return spans.length ? spans : [{ text: "—" }];
};

const planDate = (r: any): string => fmtDate(r?.period?.start) || fmtDate(r?.created);

// ----------------------------------------------------------------------- care teams ----

const humanName = (n: any): string | undefined => {
  if (!n) return undefined;
  const txt = str(n?.text);
  if (txt) return txt;
  const parts = [...(Array.isArray(n?.given) ? n.given : []), n?.family, ...(Array.isArray(n?.suffix) ? n.suffix : [])]
    .map(str)
    .filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
};

const memberCell = (p: any, team: any): Span[] => {
  const m = p?.member;
  let name = str(m?.display);
  const ref = str(m?.reference);
  if (!name && ref?.startsWith("#")) {
    const contained = (Array.isArray(team?.contained) ? team.contained : []).find((c: any) => c?.id === ref.slice(1));
    name = humanName(Array.isArray(contained?.name) ? contained.name[0] : undefined) ?? str(contained?.name);
  }
  const spans: Span[] = [{ text: name ?? ref ?? "—" }];
  const onBehalf = str(p?.onBehalfOf?.display) ?? str(p?.onBehalfOf?.reference);
  if (onBehalf) spans.push({ text: `\nfor ${onBehalf}` });
  return spans;
};

const roleCell = (p: any): string => {
  const labels = (Array.isArray(p?.role) ? p.role : []).map(conceptText).filter(Boolean) as string[];
  return labels.length ? labels.join("; ") : "—";
};

const teamCell = (r: any): Span[] => {
  const spans: Span[] = [{ text: str(r?.name) ?? "Care team", bold: true }];
  const org = displayList(r?.managingOrganization)[0];
  if (org) spans.push({ text: `\n${org}` });
  return spans;
};

// --------------------------------------------------------------------------- goals ----

const targetDetail = (tg: any): string | undefined => {
  if (tg?.detailRange) {
    const lo = tg.detailRange.low;
    const hi = tg.detailRange.high;
    const unit = str(hi?.unit) ?? str(lo?.unit) ?? str(hi?.code) ?? str(lo?.code) ?? "";
    if (lo?.value != null && hi?.value != null) return `${lo.value}–${hi.value} ${unit}`.trim();
    return qty(lo) ?? qty(hi);
  }
  return (
    qty(tg?.detailQuantity) ??
    str(tg?.detailString) ??
    conceptText(tg?.detailCodeableConcept) ??
    (typeof tg?.detailBoolean === "boolean" ? String(tg.detailBoolean) : undefined) ??
    (typeof tg?.detailInteger === "number" ? String(tg.detailInteger) : undefined)
  );
};

const goalTargets = (r: any): any[] => (Array.isArray(r?.target) ? r.target : []);

const goalTargetCell = (r: any): string => {
  const lines = goalTargets(r)
    .map((tg) => {
      const measure = conceptText(tg?.measure);
      const detail = targetDetail(tg);
      if (measure && detail) return `${measure}: ${detail}`;
      return measure ?? detail;
    })
    .filter(Boolean) as string[];
  return lines.length ? lines.join("\n") : "—";
};

const goalDueCell = (r: any): string => {
  const dues = goalTargets(r)
    .map((tg) => fmtDate(tg?.dueDate) || qty(tg?.dueDuration))
    .filter(Boolean) as string[];
  return dues.length ? dues.join("\n") : "—";
};

const goalCell = (r: any): Span[] => {
  const spans: Span[] = [{ text: conceptText(r?.description) ?? "(goal)", bold: true }];
  const by = str(r?.expressedBy?.display);
  if (by) spans.push({ text: `\nExpressed by: ${by}` });
  const reason = str(r?.statusReason);
  if (reason) spans.push({ text: `\n${reason}` });
  for (const n of Array.isArray(r?.note) ? r.note : []) {
    const note = str(n?.text);
    if (note) spans.push({ text: `\nNote: ${note}` });
  }
  const outcomes = displayList(r?.outcomeReference);
  if (outcomes.length) spans.push({ text: `\nOutcome: ${outcomes.join("; ")}` });
  const addresses = displayList(r?.addresses);
  if (addresses.length) spans.push({ text: `\nAddresses: ${addresses.join("; ")}` });
  return spans;
};

const goalDate = (r: any): string =>
  fmtDate(r?.startDate) || fmtDate(r?.statusDate) || (goalTargets(r).map((tg) => fmtDate(tg?.dueDate)).find(Boolean) ?? "");

// ------------------------------------------------------------------ service requests ----

const srCell = (r: any): Span[] => {
  const spans: Span[] = [{ text: conceptText(r?.code) ?? "(order)", bold: true }];
  const details = (Array.isArray(r?.orderDetail) ? r.orderDetail : []).map(conceptText).filter(Boolean) as string[];
  if (details.length) spans.push({ text: `\n${details.join("; ")}` });
  const reasons = (Array.isArray(r?.reasonCode) ? r.reasonCode : []).map(conceptText).filter(Boolean) as string[];
  if (reasons.length) spans.push({ text: `\nFor: ${reasons.join("; ")}` });
  for (const n of Array.isArray(r?.note) ? r.note : []) {
    const note = str(n?.text);
    if (note) spans.push({ text: `\n${note}` });
  }
  return spans;
};

const srDate = (r: any): string =>
  fmtDate(r?.authoredOn) || fmtDate(r?.occurrenceDateTime) || fmtDate(r?.occurrencePeriod?.start);

// -------------------------------------------------------------------------- family ----

const careCoordination: FamilyRenderer = {
  key: "care-coordination",
  title: "Care Plans, Teams & Goals",
  order: 110,
  claims: (r: any) => CLAIMED_TYPES.has(r?.resourceType),
  render(resources: any[], t: Theme): React.ReactElement[] {
    try {
      const all = (Array.isArray(resources) ? resources : []).filter((r) => r && typeof r === "object");
      const plans = all.filter((r) => r.resourceType === "CarePlan");
      const teams = all.filter((r) => r.resourceType === "CareTeam");
      const goals = all.filter((r) => r.resourceType === "Goal");
      const orders = all.filter((r) => r.resourceType === "ServiceRequest");
      const other = all.filter((r) => !plans.includes(r) && !teams.includes(r) && !goals.includes(r) && !orders.includes(r));

      const out: React.ReactElement[] = [];

      if (plans.length) {
        out.push(para(t, [{ text: "Care Plans", bold: true }], { spaceAfter: 3 }));
        out.push(
          table(t, {
            columns: [
              { header: "Care Plan", width: 22 },
              { header: "Period", width: 11 },
              { header: "Status", width: 11 },
              { header: "Plan Details", width: 48 },
            ],
            rows: [...plans].sort(byDateDesc(planDate)).map((r) =>
              safeRow(
                () => [planCell(r), fmtPeriod(r?.period) || fmtDate(r?.created) || "—", statusBadge(t, r?.status), planDetailsCell(r)],
                r,
                4,
              ),
            ),
          }),
        );
      }

      if (teams.length) {
        out.push(para(t, [{ text: "Care Teams", bold: true }], { spaceAfter: 3 }));
        const rows: Cell[][] = [];
        // One row per participant; a participant-less team still owes the reader its row.
        for (const team of [...teams].sort(byDateDesc((r) => fmtDate(r?.period?.start)))) {
          const participants = Array.isArray(team?.participant) && team.participant.length ? team.participant : [undefined];
          for (const p of participants) {
            rows.push(
              safeRow(
                () => [teamCell(team), roleCell(p), memberCell(p, team), fmtPeriod(team?.period) || "—", statusBadge(t, team?.status)],
                team,
                5,
              ),
            );
          }
        }
        out.push(
          table(t, {
            columns: [
              { header: "Care Team", width: 21 },
              { header: "Role", width: 23 },
              { header: "Member", width: 25 },
              { header: "Period", width: 13 },
              { header: "Status", width: 10 },
            ],
            rows,
          }),
        );
      }

      if (goals.length) {
        out.push(para(t, [{ text: "Goals", bold: true }], { spaceAfter: 3 }));
        out.push(
          table(t, {
            columns: [
              { header: "Goal", width: 31 },
              { header: "Target", width: 20 },
              { header: "Start", width: 10 },
              { header: "Due", width: 10 },
              { header: "Progress", width: 10 },
              { header: "Status", width: 11 },
            ],
            rows: [...goals].sort(byDateDesc(goalDate)).map((r) =>
              safeRow(
                () => [
                  goalCell(r),
                  goalTargetCell(r),
                  fmtDate(r?.startDate) || "—",
                  goalDueCell(r),
                  conceptText(r?.achievementStatus) ?? "—",
                  statusBadge(t, r?.lifecycleStatus),
                ],
                r,
                6,
              ),
            ),
          }),
        );
      }

      const leftover = [...orders, ...other];
      if (leftover.length) {
        out.push(para(t, [{ text: "Orders & Referrals", bold: true }], { spaceAfter: 3 }));
        out.push(
          table(t, {
            columns: [
              { header: "Order", width: 32 },
              { header: "Category", width: 14 },
              { header: "Date", width: 10 },
              { header: "Requester", width: 20 },
              { header: "Status", width: 11 },
            ],
            rows: [...leftover].sort(byDateDesc(srDate)).map((r) =>
              safeRow(
                () => [
                  srCell(r),
                  (Array.isArray(r?.category) ? r.category : []).map(conceptText).find(Boolean) ?? "—",
                  srDate(r) || "—",
                  str(r?.requester?.display) ?? str(r?.requester?.reference) ?? "—",
                  statusBadge(t, r?.status),
                ],
                r,
                5,
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
          `Care coordination details could not be formatted (${e instanceof Error ? e.message : "error"}); see Other Records or the raw bundle.`,
          { muted: true },
        ),
      ];
    }
  },
};

export default careCoordination;
