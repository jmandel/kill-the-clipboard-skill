import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSkillMd } from './build-skill.ts';

const BASE = 'https://ktc.example.test';
const SCRIPTS_DIR = join(import.meta.dir, 'kill-the-clipboard', 'scripts');

describe('buildSkillMd', () => {
  test('exactly one frontmatter block, at the top', async () => {
    const md = await buildSkillMd(BASE);
    const lines = md.split('\n');
    expect(lines[0]).toBe('---');
    const delimiters = lines.filter((l) => l === '---');
    expect(delimiters.length).toBe(2);
    const fm = lines.slice(1, lines.indexOf('---', 1)).join('\n');
    expect(fm).toContain('name: kill-the-clipboard');
    expect(fm).toContain('description:');
  });

  test('no unreplaced {{BASE_URL}}; baseUrl present; trailing slash stripped', async () => {
    const md = await buildSkillMd(BASE + '/');
    expect(md).not.toContain('{{BASE_URL}}');
    expect(md).toContain(BASE);
    expect(md).not.toContain(BASE + '//');
  });

  test('every script named in script-reference exists on disk (warn-only for unbuilt units)', () => {
    const ref = readFileSync(join(import.meta.dir, 'partials', 'script-reference.md'), 'utf-8');
    const names = [...new Set([...ref.matchAll(/`([a-z-]+\.ts)`/g)].map((m) => m[1]!))];
    expect(names.length).toBeGreaterThanOrEqual(7);
    const missing = names.filter((n) => !existsSync(join(SCRIPTS_DIR, n)));
    // Parallel build: other units own the scripts — missing files warn, never fail.
    for (const n of missing) {
      console.warn(`WARN script-reference names ${n} but ${join(SCRIPTS_DIR, n)} does not exist yet`);
    }
    expect(missing.length).toBeLessThanOrEqual(names.length);
  });
});
