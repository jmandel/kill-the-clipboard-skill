#!/usr/bin/env bun
/**
 * Build SKILL.md from partials (health-skillz pattern).
 *
 * Usage:   bun skill/build-skill.ts <baseUrl> [out]
 * Options: baseUrl  required; replaces every {{BASE_URL}} (trailing slash stripped)
 *          out      optional file path; omitted → SKILL.md text on stdout
 * Output:  the assembled SKILL.md (not machine JSON — this is a build tool, not a
 *          skill script). The server's /skill.zip route imports buildSkillMd directly.
 */

import { join } from 'node:path';

const PARTIALS_DIR = join(import.meta.dir, 'partials');

export const PARTIAL_ORDER = [
  'header.md',
  'when-to-use.md',
  'background.md',
  'workflow.md',
  'bundle-rules.md',
  'secrets.md',
  'script-reference.md',
] as const;

export async function buildSkillMd(baseUrl: string): Promise<string> {
  if (!baseUrl) throw new Error('baseUrl is required');
  const base = baseUrl.replace(/\/+$/, '');
  const parts: string[] = [];
  for (const name of PARTIAL_ORDER) {
    const file = Bun.file(join(PARTIALS_DIR, name));
    if (!(await file.exists())) throw new Error(`Partial not found: ${join(PARTIALS_DIR, name)}`);
    parts.push((await file.text()).trimEnd());
  }
  return parts.join('\n\n').replaceAll('{{BASE_URL}}', base) + '\n';
}

if (import.meta.main) {
  const [baseUrl, out] = process.argv.slice(2);
  if (!baseUrl) {
    console.error('Usage: bun skill/build-skill.ts <baseUrl> [out]');
    process.exit(1);
  }
  const md = await buildSkillMd(baseUrl);
  if (out) {
    await Bun.write(out, md);
    console.error(`wrote ${out} (${md.length} bytes)`);
  } else {
    console.log(md);
  }
}
