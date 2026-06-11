# kill-the-clipboard — conventions (binding for every contributor, human or agent)

Read DESIGN.md before any work; its decisions log (§1) is settled — do not re-litigate.

## Hard rules

- **Bun TypeScript everywhere.** Server = plain `Bun.serve` with `routes` + HTML imports
  (no Express/Hono, no separate bundler). Tests = `bun:test`. Scripts = `#!/usr/bin/env bun`.
- **The kernel is frozen**: `lib/*.ts`, `server/src/schema.sql`, root `package.json` deps,
  and this file. Need an interface change or a new dependency? Stop and ask the
  orchestrator — never change unilaterally, never `bun add`.
- **Secrets never go to stdout, logs, or error messages**: the master secret M, derived
  key/auth, shlinks, owner links, passcodes. Scripts write secret-bearing artifacts to
  files and print paths (see `CreateShlOutput` in lib/types.ts). The server stores only
  `sha256(auth)` and argon2id passcode hashes; plaintext data and keys never reach it.
- **Stay in your unit's directories.** Parallel units own disjoint paths.

## Script conventions (skill/*/scripts)

- stdout = one machine-parseable JSON object (or JSON lines for progress streams);
  stderr = human/progress diagnostics; nonzero exit + usage string on failure.
- Hand-rolled arg parsing (positional + `--flag` helpers); no arg-parsing deps.
- Server URL: literal `{{BASE_URL}}` baked at zip build; config.json fallback;
  explicit URL argument wins.
- Network calls: retry 5× with exponential backoff on ≥500/429 only.
- Every script doc-comments Usage/Options/Output at the top of the file.

## Code style

- No comments that narrate what code does or where it came from; comment only
  constraints the code can't show (spec SHALLs, invariants, gotchas).
- FHIR: treat all input as hostile — optional-chain everything, never assume display
  strings exist, tolerate unknown extensions/categories (real Epic data is messy).
- Errors: throw `Error` with actionable messages; API errors = `{error: string}` JSON
  with correct HTTP status; data plane signals nothing but 404 for any non-live link.
- Dates: epoch seconds on the wire and in SQLite; ISO 8601 in user-facing JSON.

## Testing

- Tiers (keep the inner loop fast): `bun test` is the DEFAULT loop (~7s) — all logic,
  contracts, server, app, claims-routing; PDF-RENDERING tests self-skip unless
  `RUN_RENDER=1`. `bun run test:render` (~60s) runs the renderer golden tests —
  REQUIRED before merging any change under fhir-render/, md-to-pdf, or lib/doc.tsx.
  `bun run test:all` (render + volume tiers, ~90s) is the merge gate for sweeps/CI.
  Rationale: layout guarantees (repeating headers, atomic rows, no overflow) are owned
  by lib/doc.tsx and proven by lib/doc.test.ts in the default loop; family golden tests
  re-render real PDFs and only need to run when rendering code changes. Family volume
  tests amplify to ~120 resources (≥3 page breaks) — do NOT crank higher; true scale
  lives in `RUN_VOLUME=1 bun test tests/volume/`.
- Unit tests live next to the code (`lib/foo.test.ts`, `server/src/*.test.ts`).
- Renderer golden tests assert on extracted geometry/text, not pixel equality.
- PDF outputs are verified visually: render with `pdftoppm -png -r 120` and inspect
  before declaring done. "It compiled" is not "it renders correctly."
- Fixtures: `tests/fixtures/uscore/` (synthetic breadth corpus — see STYLE.md) and the
  real-world UnityPoint export (path in DESIGN.md; never commit it — real PHI).

## Spec invariants worth re-reading before touching related code

- JWE: compact, `alg:dir`, `enc:A256GCM`, fresh random IV per encryption (same key reuse
  across updates makes this a spec SHALL, not a nicety).
- shlink payload: url ≤128 chars w/ ≥256-bit entropy, label ≤80, flags alphabetical,
  U excludes P; KTC requires exp and flag U.
- KTC bundle: type collection, one Patient, urn:uuid fullUrls, no meta.profile,
  attachments ALWAYS inline `data` (never `url`), DocRef types LOINC 51855-5 (story) /
  60591-5 (FHIR-rendered, must cover every non-DocumentReference resource).
