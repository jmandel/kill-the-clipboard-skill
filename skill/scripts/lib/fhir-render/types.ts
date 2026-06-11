// The family-renderer contract (docs/DESIGN.md §7). See README.md in this directory for the
// full semantics every family module must honor; registry.ts fixes claim/display order.
import type * as React from "react";
import type { Theme } from "./engine.ts";

export type { Theme };

export interface FamilyRenderer {
  /** Stable identifier; must equal the module filename (families/<key>.tsx). */
  key: string;
  /** Section heading text. The framework renders the section() heading — render() must not. */
  title: string;
  /** Display/claim rank; must match this family's position in registry.ts (fallback = 1000). */
  order: number;
  /**
   * Pure, fast, never-throw predicate over a single (hostile) resource. Claim evaluation
   * runs in registry order: the first family returning true wins the resource. A thrown
   * error is treated as false by the framework.
   */
  claims(resource: any): boolean;
  /**
   * Receives EVERY resource this family claimed (collection-oriented — DESIGN §7 volume
   * rule: one table row per instance, never drop or summarize-away any). Returns section
   * content elements built exclusively from ./engine.ts components. Must never throw:
   * a failure on one resource may not take down the rest.
   */
  render(resources: any[], theme: Theme): React.ReactElement[];
}
