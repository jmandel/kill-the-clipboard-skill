# care-coordination family — renderer notes

US Core **9.0.0** profiles covered:
- CarePlan: narrative-active, structured-completed
- CareTeam: active-multirole, inactive-minimal
- Goal: a1c-active, walking-completed, sodium-onhold-textonly

Note: in US Core 9.0.0 the old `category:AssessPlan` required slice is gone — `category`
is plain Must Support 0..* with a preferred binding. `careplan-narrative-active` still
carries the `assess-plan` coding because real systems do.

Deliberate quirks a renderer MUST tolerate:

- **careplan-narrative-active**: the plan content lives almost entirely in `text.div`
  (`text.status = "additional"`), Epic-style — long XHTML with `<h1>/<h2>`, a bordered
  `<table>`, `<ol>/<ul>`, and entities (`&amp;`, `&mdash;`, `&lt;`). There are NO
  `activity` entries; a renderer that only walks structured fields will lose the clinical
  content. Also: two identifiers (one Epic `urn:oid:1.2.840.114350...`), a proprietary
  `open.epic.com` extension to ignore, dual-coded category with an Epic urn:oid
  translation coding, and `contributor`/`addresses` (Additional USCDI) as display-only
  references.
- **careplan-structured-completed**: `text.status = "generated"` short div; content is in
  `activity[]` — one `detail` with SNOMED code + `scheduledTiming` (3×/wk), one `detail`
  with LOINC+CPT dual coding + `scheduledPeriod` + display-only `location`, and one
  `activity.reference` that is **display-only** (no reference) with a `progress`
  annotation. `category` is **text-only**. `goal` points at
  `Goal/goal-walking-completed`, which IS resolvable within this family by id.
- **careteam-active-multirole**: five participants exercising the member reference space:
  Practitioner reference, **contained** Practitioner (`#contained-cdces`), RelatedPerson
  reference (unresolvable), the **patient herself** as a participant (constant urn), and a
  display-only Organization with `onBehalfOf`. Roles mix SNOMED+NUCC dual coding,
  NUCC-only, **text-only role**, and code-only.
- **careteam-inactive-minimal**: `status = inactive` with a closed `period`; the single
  participant role is a **code-only SNOMED coding (41672002, no display, no text)** —
  renderer needs a code-system+code fallback label. Member is a display-rich
  PractitionerRole reference. Subject has **no display**. Proprietary extension present.
- **goal-a1c-active**: LOINC-coded description, `target.detailRange` (5.0–7.0 %),
  `measure`, `dueDate`, achievementStatus in-progress, priority, category, an Annotation
  `note` with `authorString`, display-only `addresses`.
- **goal-walking-completed**: lifecycleStatus completed + achievementStatus achieved
  (coding **without text**), description **text-only**, target with `dueDate` ONLY (no
  measure/detail — valid per gol-1 because dueDate is present), patient-expressed goal
  (expressedBy = constant urn), display-only `outcomeReference`.
- **goal-sodium-onhold-textonly**: lifecycleStatus **on-hold**, very long text-only
  description with leading unicode (饮食目标) and embedded double quotes; **no startDate
  and no dueDate** (target uses text-only `measure` + `detailString`) — the US Core note
  that servers support at least one of startDate/dueDate is deliberately violated here to
  test renderer resilience; raw `urn:oid:...` extension noise; subject without display;
  display-only expressedBy.
- Only the constant patient urn and `#contained-cdces` / `Goal/goal-walking-completed`
  are resolvable; every other reference (Practitioner/, PractitionerRole/,
  RelatedPerson/, ServiceRequest displays) is intentionally dangling.
- Timezone variety: date-only, UTC `Z`, `-05:00`, `-06:00`.
