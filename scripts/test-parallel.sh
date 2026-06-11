#!/usr/bin/env bash
# Run every test file as its own bun process, fanned out across cores.
# Test files are independent (own temp dirs, ephemeral ports), so this is safe;
# wall-clock drops from ~4 min serial to roughly the slowest single file.
set -uo pipefail
cd "$(dirname "$0")/.."

mapfile -t files < <(find lib app server skill tests -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | sort)
printf '%s\n' "${files[@]}" | xargs -P "$(nproc)" -I{} sh -c '
  out=$(bun test "{}" 2>&1)
  status=$?
  line=$(printf "%s" "$out" | grep -E "^ *[0-9]+ (pass|fail)" | tr "\n" " ")
  printf "%-72s %s\n" "{}" "$line"
  if [ $status -ne 0 ]; then printf "%s\n" "$out" | grep -B5 "(fail)" | head -40; exit 1; fi
' ; rc=$?
exit $rc
