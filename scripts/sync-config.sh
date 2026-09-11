#!/bin/sh
# Copies the canonical shared/Config.gs and shared/appsscript.*.json into both Apps Script projects.
#
# They are two separate projects and Apps Script cannot share a file between them, so the copies are
# committed — `clasp push` needs them on disk. Edit the file in shared/, run this, push both.
#
# A project directory is not a safe home for a manifest: the tooling writes over what is in it. The
# copy there is disposable, the one in shared/ is not. See docs/gotchas.md.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)

# The script id a project is pinned to, or nothing when this checkout has no .clasp.json for it.
script_id() {
  [ -f "$1" ] || return 0
  sed -n 's/.*"scriptId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

# Two ids that match mean the next push flattens a project. `.claspignore` sends only its own
# directory's files, so a push replaces everything else in whichever project it lands in — and clasp
# cannot tell it is the wrong one, because an id is all it has. Refused here rather than discovered
# afterwards: the bound project keeps its empty stub and no menu appears, while the scaffolding
# project loses every setup step, which reads as two unrelated failures.
bootstrap_id=$(script_id "$root/bootstrap/.clasp.json")
src_id=$(script_id "$root/src/.clasp.json")
if [ -n "$bootstrap_id" ] && [ "$bootstrap_id" = "$src_id" ]; then
  echo "bootstrap/.clasp.json and src/.clasp.json name the same script id." >&2
  echo "Pushing either would overwrite the other project. These are two separate Apps Script" >&2
  echo "projects: the standalone scaffolding, and the one bound to the spreadsheet." >&2
  echo >&2
  echo "src/.clasp.json needs the BOUND project's id, which is only readable from the sheet:" >&2
  echo "Extensions -> Apps Script -> Project Settings -> Script ID. A bound project is never" >&2
  echo "listed by \`clasp list-scripts\`." >&2
  exit 1
fi

for target in bootstrap src; do
  cp "$root/shared/Config.gs" "$root/$target/Config.gs"
  echo "wrote $target/Config.gs"
  cp "$root/shared/appsscript.$target.json" "$root/$target/appsscript.json"
  echo "wrote $target/appsscript.json"
done
echo
echo "now: (cd bootstrap && clasp push -f) and (cd src && clasp push -f)"
