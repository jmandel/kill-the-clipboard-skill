// Single indirection point to the frozen document engine (lib/doc.tsx).
// Family modules and the harness import doc.tsx components ONLY through this file:
// the skill.zip builder rewrites this one relative path when it vendors lib/ next to
// scripts/lib (DESIGN.md §2). Nothing else in fhir-render/ may reference lib/ directly.
export * from "../../../../../lib/doc.tsx";
