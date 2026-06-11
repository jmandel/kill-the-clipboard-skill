// Shared assembly + test utilities for family renderers (and the render-fhir-pdf CLI,
// which reuses renderFamiliesToPdf so golden tests and production output share one code
// path). Fixture loading reads tests/fixtures/uscore — repo-only, absent from skill.zip;
// pdfText/countPages need poppler (pdftotext) on PATH, a dev-environment given.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";
import React from "react";
import type { FamilyRenderer } from "./types.ts";
import { callout, page, para, renderDoc, section, summaryTheme, title } from "./engine.ts";
import fallbackFamily from "./fallback.tsx";

export interface RenderOpts {
  title?: string;
  kicker?: string;
  meta?: { label: string; value: string }[];
  callout?: { title: string; body: string[] };
  /** Left footer text; defaults to the engine's provenance line. */
  footerLeft?: string;
}

export interface RenderResult {
  /** id of every resource actually rendered (everything with an id — fallback guarantees it). */
  renderedIds: string[];
  /** Families that rendered ≥1 resource, in display order, with claimed counts. */
  sections: { key: string; count: number }[];
  pages: number;
  fallbackCount: number;
}

/**
 * Assemble title block + per-family sections into one summary-theme PDF. Families are
 * sorted by `order`; fallback is appended automatically if absent so every resource
 * renders. A family whose render() throws forfeits its resources to fallback — one bad
 * family (or one hostile resource inside it) never costs completeness.
 */
export async function renderFamiliesToPdf(
  families: FamilyRenderer[],
  resources: any[],
  outPdf: string,
  opts: RenderOpts = {},
): Promise<RenderResult> {
  const t = summaryTheme;
  const fams = [...families].sort((a, b) => a.order - b.order);
  let fb = fams.find((f) => f.key === "fallback");
  if (!fb) {
    fb = fallbackFamily;
    fams.push(fb);
  }

  const buckets = new Map<FamilyRenderer, any[]>();
  for (const r of resources ?? []) {
    const winner =
      fams.find((f) => {
        try {
          return f.claims(r) === true;
        } catch {
          return false;
        }
      }) ?? fb;
    (buckets.get(winner) ?? buckets.set(winner, []).get(winner)!).push(r);
  }

  const children: React.ReactElement[] = [
    title(t, { title: opts.title ?? "Patient Health Summary", kicker: opts.kicker, meta: opts.meta ?? [] }),
  ];
  if (opts.callout) children.push(callout(t, opts.callout));

  const sections: { key: string; count: number }[] = [];
  const renderedIds: string[] = [];
  const fbBucket = buckets.get(fb) ?? [];

  for (const f of fams) {
    if (f === fb) continue;
    const claimed = buckets.get(f) ?? [];
    if (!claimed.length) continue;
    let content: React.ReactElement[];
    try {
      content = f.render(claimed, t) ?? [];
    } catch (e) {
      console.error(
        `[fhir-render] family '${f.key}' threw (${e instanceof Error ? e.message : String(e)}); ` +
          `routing its ${claimed.length} resource(s) to the fallback section`,
      );
      fbBucket.push(...claimed);
      continue;
    }
    children.push(section(t, f.title, `section-${f.key}`), ...content);
    sections.push({ key: f.key, count: claimed.length });
    for (const r of claimed) if (r?.id != null) renderedIds.push(String(r.id));
  }

  if (fbBucket.length) {
    children.push(section(t, fb.title, "section-fallback"));
    try {
      children.push(...(fb.render(fbBucket, t) ?? []));
      sections.push({ key: fb.key, count: fbBucket.length });
      for (const r of fbBucket) if (r?.id != null) renderedIds.push(String(r.id));
    } catch (e) {
      children.push(para(t, `Fallback renderer failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  // Explicit keys: section content arrives as anonymous arrays from family modules.
  const keyed = children.map((el, i) => React.cloneElement(el, { key: el.key ?? `c${i}` }));
  await renderDoc(
    [page(t, keyed, { key: "doc", footerLeft: opts.footerLeft })],
    { title: opts.title ?? "Patient Health Summary" },
    outPdf,
  );
  return { renderedIds, sections, pages: await countPages(outPdf), fallbackCount: fbBucket.length };
}

const FIXTURES_ROOT = path.join(import.meta.dir, "../../../../../tests/fixtures/uscore");

/** Load every fixture instance in tests/fixtures/uscore/<dir> (coverage.json excluded). */
export function loadFamilyFixtures(familyDirName: string): any[] {
  const dir = path.join(FIXTURES_ROOT, familyDirName);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(`fixture directory not found: ${dir} (harness fixtures exist only in the repo, not in skill.zip)`);
  }
  const out: any[] = [];
  for (const n of names.sort()) {
    if (!n.endsWith(".json") || n === "coverage.json") continue;
    out.push(JSON.parse(readFileSync(path.join(dir, n), "utf8")));
  }
  if (!out.length) throw new Error(`no fixture instances in ${dir}`);
  return out;
}

/** Extracted text of the whole PDF, or of one page (1-based). Layout mode keeps table rows on one line. */
export async function pdfText(pdf: string, pageNum?: number): Promise<string> {
  if (pageNum != null) return await $`pdftotext -layout -f ${pageNum} -l ${pageNum} ${pdf} -`.text();
  return await $`pdftotext -layout ${pdf} -`.text();
}

/** Page count straight from PDF object headers; no poppler dependency at runtime. */
export async function countPages(pdf: string): Promise<number> {
  const text = await Bun.file(pdf).text();
  const count = text.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  if (count?.[1]) return Number(count[1]);
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
}

const AMPLIFY_DATE_FIELDS = [
  "effectiveDateTime",
  "authoredOn",
  "occurrenceDateTime",
  "performedDateTime",
  "onsetDateTime",
  "recordedDate",
  "issued",
  "date",
  "created",
] as const;

/**
 * Volume amplifier (DESIGN §7): grow `resources` to exactly `n` instances by cloning the
 * date-bearing ones round-robin, each clone with a unique id (`<src.id>-ampK`) and a
 * synthetic date (2024-01-01 + K days, on the clone's first recognized date field,
 * date-only precision preserved). Resources without a string date field are used as
 * clone sources only when nothing date-bearing exists. n smaller than the input just
 * truncates. Use this to prove a family's tables survive 500+ rows.
 */
export function amplify(resources: any[], n: number): any[] {
  const src = (resources ?? []).filter((r) => r !== null && r !== undefined);
  const out = src.slice(0, n).map((r) => structuredClone(r));
  const dateBearing = src.filter(
    (r) => typeof r === "object" && AMPLIFY_DATE_FIELDS.some((f) => typeof r[f] === "string"),
  );
  const pool = dateBearing.length ? dateBearing : src;
  if (!pool.length) return out;
  let k = 0;
  while (out.length < n) {
    const base = pool[k % pool.length];
    const clone = structuredClone(base);
    if (clone !== null && typeof clone === "object") {
      clone.id = `${base?.id ?? base?.resourceType ?? "resource"}-amp${k}`;
      const f = AMPLIFY_DATE_FIELDS.find((field) => typeof clone[field] === "string");
      if (f) {
        const d = new Date(Date.UTC(2024, 0, 1) + k * 86_400_000).toISOString();
        clone[f] = clone[f].length === 10 ? d.slice(0, 10) : d;
      }
    }
    out.push(clone);
    k++;
  }
  return out;
}
