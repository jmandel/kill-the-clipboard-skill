# skill/ — SKILL.md source

`SKILL.md` is composed from `partials/`, in this order:

1. `header.md` — frontmatter (`name: kill-the-clipboard` + trigger description) and intro
2. `when-to-use.md` — triggers and phase-1 scope boundaries
3. `background.md` — KTC explainer for the agent (receiver persistence obligations, PAMI, the two PDF kinds, 2026 staging, link lifecycle)
4. `workflow.md` — Steps 1–10 (docs/DESIGN.md §6) with exact commands and stdout shapes
5. `bundle-rules.md` — PatientSharedBundle / DocumentReference rules (docs/DESIGN.md §5, distilled)
6. `secrets.md` — file-not-stdout conventions and the per-platform handoff matrix
7. `script-reference.md` — script table (the build test cross-checks these names against `kill-the-clipboard/scripts/`)

## Building

```bash
bun skill/build-skill.ts https://ktc.example.org            # SKILL.md on stdout
bun skill/build-skill.ts https://ktc.example.org SKILL.md   # write to file
```

`build-skill.ts` exports `buildSkillMd(baseUrl: string): Promise<string>` — it
concatenates the partials and replaces every `{{BASE_URL}}` with the given origin
(trailing slash stripped). The server's `/skill.zip` route imports this function and
bakes its configured base URL at request time.

Partials use `{{BASE_URL}}` wherever the server origin belongs; never hardcode a host.
Partials must not contain a bare `---` line outside the header frontmatter (the build
test asserts exactly one frontmatter block) — use `***` if a thematic break is ever
needed.

## Tests

```bash
bun test skill/build-skill.test.ts
```

Asserts: single frontmatter block; zero unreplaced `{{BASE_URL}}`; every script named
in `script-reference.md` exists under `kill-the-clipboard/scripts/` (missing scripts
warn instead of failing while other parallel units are still landing them).
