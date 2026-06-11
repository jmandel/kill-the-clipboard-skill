// Family registry — the single source of truth for BOTH section display order and claim
// precedence (docs/DESIGN.md §7 reading order). The first family in this order whose claims()
// returns true wins a resource; fallback is last and claims everything, so every input
// resource is guaranteed a renderer. Family agents replace their families/<key>.tsx stub
// wholesale but never edit this file.
import type { FamilyRenderer } from "./types.ts";
import patient from "./families/patient.tsx";
import problems from "./families/problems.tsx";
import medications from "./families/medications.tsx";
import allergies from "./families/allergies.tsx";
import immunizations from "./families/immunizations.tsx";
import vitals from "./families/vitals.tsx";
import labs from "./families/labs.tsx";
import social from "./families/social.tsx";
import procedures from "./families/procedures.tsx";
import encounters from "./families/encounters.tsx";
import careCoordination from "./families/care-coordination.tsx";
import coverageDevices from "./families/coverage-devices.tsx";
import documents from "./families/documents.tsx";
import familyHistory from "./families/family-history.tsx";
import supporting from "./families/supporting.tsx";
import fallback from "./fallback.tsx";

export { fallback };

export const registry: FamilyRenderer[] = [
  patient,
  problems,
  medications,
  allergies,
  immunizations,
  vitals,
  labs,
  social,
  procedures,
  encounters,
  careCoordination,
  coverageDevices,
  documents,
  familyHistory,
  supporting,
  fallback,
];

/**
 * Assign each resource to the first family (in `families` order) whose claims() returns
 * true; a throwing claims() counts as false (hostile input must not break partitioning).
 * Returns only families that claimed ≥1 resource, in `families` order. If no family
 * claims a resource (possible only when fallback is absent from `families`), it is
 * dropped here — renderFamiliesToPdf always appends fallback so nothing is ever lost.
 */
export function partition(resources: any[], families: FamilyRenderer[] = registry): Map<FamilyRenderer, any[]> {
  const out = new Map<FamilyRenderer, any[]>();
  for (const f of families) out.set(f, []);
  for (const r of resources ?? []) {
    const winner = families.find((f) => {
      try {
        return f.claims(r) === true;
      } catch {
        return false;
      }
    });
    if (winner) out.get(winner)!.push(r);
  }
  for (const [f, list] of out) if (!list.length) out.delete(f);
  return out;
}
