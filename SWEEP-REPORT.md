# Coherence Sweep Report — 2026-06-10

Run after all parallel units. Scope: cross-unit drift, full-suite green, end-to-end smoke,
conventions audit. Kernel (`lib/*`, `server/src/schema.sql`, root `package.json`,
`tsconfig.json`, `CLAUDE.md`) untouched.

## State on arrival

- `bun install`: clean, no dependency drift — root `package.json` matches the frozen set
  exactly (deps: @react-pdf/renderer 4.5.1, react/react-dom 19.2.7, qrcode ^1.5.4;
  dev: jose, @types/qrcode, @types/react).
- `bunx tsc --noEmit`: failed immediately (`bun-types` not installed and not in the frozen
  package.json); with bun-types supplied, ~60 errors across `x/`, server, scripts, bakeoff.
- `bun test`: not green — the stale `x/` tree contained test files with unresolvable kernel
  imports (module-resolution failures), exactly as the assemble-validate unit reported.

## Drift found and fixed

1. **skill.zip vendoring was broken** (real cross-unit contract gap). The framework unit
   designated `lib/fhir-render/engine.ts` as the single kernel-import rewrite point, but
   `create-shl.ts`, `manage-shl.ts`, `md-to-pdf.ts`, `validate-bundle.ts`, and the script
   tests also import repo `lib/*` directly — and `server/src/zip.ts` never rewrote ANY of
   them. Scripts extracted from skill.zip could not resolve the vendored kernel
   (`scripts/lib/kernel/`). Fix: added `rewriteKernelImports()` to `server/src/zip.ts` —
   any `(../)+lib/<file>.ts(x)` specifier whose `../` count exactly escapes to repo root
   is rewritten to the correct relative path into `scripts/lib/kernel/`. Verified by
   downloading `/skill.zip` from a live server, extracting, `bun install`ing the pinned
   manifest, and running `validate-bundle.ts`, `render-fhir-pdf.ts` (all 15 families,
   fallbackCount 0), and `md-to-pdf.ts` from inside the extraction.
2. **Stale `x/` tree and root `skill.zip` deleted.** `x/` was an old extraction of a
   pre-fix skill.zip (it is what exposed bug 1); nothing referenced either artifact, and
   `x/` was the sole source of full-suite test failures.
3. **`server/src/index.ts` / `server.test.ts` type drift vs current bun-types:**
   `Server` is now generic (`Server<WebSocketData>`) — added a `BunServer = Server<undefined>`
   alias; `Uint8Array<ArrayBufferLike>` is no longer assignable to `BodyInit` — cast at the
   two `Response` construction sites (ciphertext from sqlite, zip bytes are plain
   ArrayBuffer-backed in practice).
4. **`assemble-bundle.ts` was not a module** (zero imports + top-level await → TS1375, and
   its globals collided with the `x/` copy). Appended `export {}`.
5. **bakeoff strict-mode errors** (`bakeoff/typst/render-story.ts`,
   `bakeoff/pdfmake/render-story.ts`): `noUncheckedIndexedAccess` fallout from indexing
   `lines[i]` / regex groups. Fixed with `?? ""` defaults; behavior unchanged.
6. **`node_modules/bun-types` populated from Bun's package cache** so `bunx tsc --noEmit`
   works at all (tsconfig pins `"types": ["bun-types"]` but the frozen package.json omits
   it — see orchestrator requests). No manifest file changed.

## State after sweep

- `bunx tsc --noEmit`: **1 error**, in the frozen kernel only (see below). Everything else clean.
- `bun test`: **289 pass / 0 fail, 1995 expect() calls, 29 files** (~260s).

## End-to-end smoke (all from real binaries, no mocks)

1. Built `/tmp/ktc-smoke/selected-resources.json`: constant Patient + one fixture from each
   of the other 14 families (corpus `tests/fixtures/uscore/`).
2. `render-fhir-pdf.ts` → 4 pages, 15 sections, **fallbackCount 0** (every family claimed
   its resource). Page 1 rasterized and visually inspected: title block, share callout,
   demographics panel, problems/medications/allergies tables, provenance footer — clean.
3. `md-to-pdf.ts` story (highlight/bold/pull-quote dialect) → 1 page.
4. `assemble-bundle.ts` → 17 entries, 2 DocumentReferences; pre-assigned patient urn
   rewritten; 18 intra-bundle refs rewritten.
5. `validate-bundle.ts --rendered-ids` → **pass**, 4 `reference-unresolved` warnings (all
   point at resources deliberately outside the selection — expected for partial selections).
6. Server started for real (`PORT=18742`, temp sqlite). `create-shl.ts` against it: link
   registered, bundle encrypted (A256GCM, zip DEF), artifacts written; stdout was exactly
   `CreateShlOutput` with no secrets.
7. `GET /shl/{id}?recipient=...` → 200 `application/jose`; decrypted with the key derived
   from the owner-link master secret (`lib/hkdf.ts` + `lib/jwe.ts`):
   **byte-identical to bundle.json**, `cty: application/fhir+json`, `zip: DEF`.
8. `manage-shl.ts <outdir> status` and `log` against the live server: correct `ManageState`
   subset; access log shows both direct fetches with recipient + outcome; uses 2/5.
9. `/skill.zip` downloaded from the live server; extraction is fully self-contained
   (kernel + fonts vendored, imports rewritten, `{{BASE_URL}}` baked into `config.json`
   as `http://127.0.0.1:18742`); scripts run from inside it (step 1's renders reproduced).
10. `preview-pdf.ts`, `/s` (handoff app HTML), `/` landing, `skill/build-skill.ts` (no
    residual `{{BASE_URL}}` in composed SKILL.md) all verified.

## Conventions audit

- No secret material on stdout/stderr anywhere: grepped scripts + server for prints of
  owner links, shlinks, master secret, derived key/auth, passcodes — only the public link
  id/url appear (allowed; they are server-visible by design). The shl-scripts test suite
  additionally asserts this mechanically.
- stdout-JSON compliance: every script's success path emits exactly one JSON object
  (`assemble-bundle`, `validate-bundle`, `render-fhir-pdf`, `md-to-pdf`, `preview-pdf`,
  `create-shl`, `manage-shl`); progress goes to stderr; nonzero exit + usage on failure.
- Doc-comment Usage/Options/Output headers present on all 8 scripts.
- SKILL.md command examples spot-checked against the actual CLIs (manage-shl's
  target-then-verb order, create-shl flags, validate-bundle invocation) — accurate.

## Remains broken / known limitations

1. **`lib/jwe.ts:83` (FROZEN kernel)** — the one remaining tsc error:
   `Uint8Array<ArrayBufferLike>` not assignable to `Uint8Array<ArrayBuffer>` under current
   bun-types. Runtime is unaffected. Repro: `bunx tsc --noEmit`.
2. **No CJK font coverage in `lib/doc.tsx` (FROZEN kernel)** — CJK strings (patient 王秀英
   fixture, care-coordination 饮食目标 goal, social unicode valueString) render as
   overlapped fallback glyphs. Reported independently by three family units.
3. **React "unique key" warnings** from `lib/doc.tsx` children during `lib/doc.test.ts`
   (frozen kernel; cosmetic, stderr noise only).
4. Tests inside skill.zip (`scripts/tests/`, family `*.test.ts(x)`) import repo-only
   fixtures (`tests/fixtures/...`) and will fail if run from an extraction; the harness
   throws an actionable error. Intentional — skill consumers don't run tests.
5. `bunx tsc --noEmit` requires `node_modules/bun-types`, which a fresh
   `bun install` does not produce (not in the frozen manifest). This sweep left a copy in
   `node_modules/`; a future `bun install --force`/clean checkout loses it.

## Orchestrator requests (collected from unit reports + sweep)

1. Kernel one-liner: fix `lib/jwe.ts:83` (cast to `Uint8Array<ArrayBuffer>` or type the
   buffer explicitly) so the repo typechecks with zero errors.
2. Add `bun-types` to root devDependencies (tsconfig already demands it).
3. Kernel: register a CJK-capable fallback font in `lib/doc.tsx` (e.g. Noto Sans SC subset)
   — three families surfaced garbled CJK output that cannot be fixed outside the kernel.
4. From the server unit: bless the `kv` table it creates alongside the frozen
   `schema.sql` (server secret persistence across restarts), or fold it into schema.sql.
5. Optional polish from the app unit: `@types/react-dom` is absent (worked around with
   ambient decls in `app/src/globals.d.ts`).
