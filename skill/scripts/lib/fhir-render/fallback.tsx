// Generic completeness renderer — the "Other records" safety net behind every family
// (docs/DESIGN.md §7 last row). Anything no family claims is flattened to a key-path/value
// table, one table per resourceType group, one header row + leaf rows per instance.
// This module is the completeness guarantee for the FHIR-Rendered PDF SHALL: it must
// render literally anything (alien types, null, scalars) and must NEVER throw.
import type * as React from "react";
import type { FamilyRenderer, Theme } from "./types.ts";
import { para, table, type Cell } from "./engine.ts";

const MAX_VALUE_CHARS = 160;
const MAX_DEPTH = 32;

function cap(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > MAX_VALUE_CHARS ? `${one.slice(0, MAX_VALUE_CHARS - 1)}…` : one;
}

function extensionName(url: unknown): string {
  if (typeof url !== "string" || !url) return "extension";
  return url.split(/[/#]/).filter(Boolean).pop() || "extension";
}

function flattenInto(value: any, path: string, rows: [string, string][], depth: number): void {
  if (value === null || value === undefined) return;
  if (depth > MAX_DEPTH) {
    rows.push([path, "… (nesting too deep to display)"]);
    return;
  }
  if (typeof value !== "object") {
    rows.push([path, cap(String(value))]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenInto(v, `${path}[${i}]`, rows, depth + 1));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "div") continue; // narrative bodies are noise; structured elements carry the data
    if (k === "extension" || k === "modifierExtension") {
      flattenExtensions(v, path ? `${path}.${k}` : k, rows, depth + 1);
      continue;
    }
    flattenInto(v, path ? `${path}.${k}` : k, rows, depth + 1);
  }
}

// Extensions keyed by the last segment of their url (the full url is noise); the url
// itself is never emitted as a row. Nested extensions recurse the same way.
function flattenExtensions(exts: any, base: string, rows: [string, string][], depth: number): void {
  if (!Array.isArray(exts)) {
    flattenInto(exts, base, rows, depth);
    return;
  }
  for (const e of exts) {
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      flattenInto(e, base, rows, depth);
      continue;
    }
    const p = `${base}[${extensionName(e.url)}]`;
    for (const [k, v] of Object.entries(e)) {
      if (k === "url") continue;
      if (k === "extension" || k === "modifierExtension") {
        flattenExtensions(v, p, rows, depth + 1);
        continue;
      }
      flattenInto(v, `${p}.${k}`, rows, depth + 1);
    }
  }
}

function instanceRows(resource: any, typeLabel: string): Cell[][] {
  const rows: Cell[][] = [];
  const idLabel = resource?.id != null ? `${typeLabel}/${String(resource.id)}` : `${typeLabel} (no id)`;
  rows.push([[{ text: idLabel, bold: true }], ""]);
  try {
    const flat: [string, string][] = [];
    if (resource !== null && typeof resource === "object" && !Array.isArray(resource)) {
      for (const [k, v] of Object.entries(resource)) {
        if (k === "resourceType" || k === "id" || k === "meta") continue;
        if (k === "extension" || k === "modifierExtension") {
          flattenExtensions(v, k, flat, 0);
          continue;
        }
        flattenInto(v, k, flat, 0);
      }
    } else if (resource !== null && resource !== undefined) {
      flat.push(["(value)", cap(String(resource))]);
    }
    if (!flat.length) flat.push(["(no fields)", ""]);
    for (const r of flat) rows.push(r);
  } catch (e) {
    rows.push(["(render error)", cap(e instanceof Error ? e.message : String(e))]);
  }
  return rows;
}

const fallback: FamilyRenderer = {
  key: "fallback",
  title: "Other Records",
  order: 1000,
  claims: () => true,
  render(resources: any[], theme: Theme): React.ReactElement[] {
    const groups = new Map<string, any[]>();
    for (const r of resources ?? []) {
      const type = typeof r?.resourceType === "string" && r.resourceType ? r.resourceType : "Unknown";
      (groups.get(type) ?? groups.set(type, []).get(type)!).push(r);
    }
    const els: React.ReactElement[] = [];
    for (const [type, list] of groups) {
      els.push(
        para(theme, [{ text: `${type} (${list.length} record${list.length === 1 ? "" : "s"})`, bold: true }], {
          spaceAfter: 3,
        }),
      );
      const rows: Cell[][] = [];
      for (const r of list) rows.push(...instanceRows(r, type));
      els.push(
        table(theme, {
          columns: [
            { header: "Field", width: 2 },
            { header: "Value", width: 3 },
          ],
          rows,
        }),
      );
    }
    return els;
  },
};

export default fallback;
