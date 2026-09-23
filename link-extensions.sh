#!/usr/bin/env bash
set -euo pipefail

# --- Konfiguration -----------------------------------------------------------
# Diese Extensions werden verlinkt (einzige Quelle der Wahrheit)
EXTENSIONS=(
  permission-gate.ts
  confirm-destructive.ts
  handoff.ts
  model-status.ts
  session-name.ts
  bookmark.ts
  notify.ts
  prompt-customizer.ts
  question.ts
)

# --- Pfade ermitteln ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
TARGET_DIR="$HOME/.pi/agent/extensions"
GITIGNORE="$REPO_ROOT/.gitignore"

EXT_BASE="$(pnpm list -g --parseable \
  | grep '@earendil-works/pi-coding-agent$' \
  | head -n1)/examples/extensions"

if [[ ! -d "$EXT_BASE" ]]; then
  echo "Fehler: Extension-Verzeichnis nicht gefunden: $EXT_BASE" >&2
  echo "Ist @earendil-works/pi-coding-agent global via pnpm installiert?" >&2
  exit 1
fi

# --- Symlinks anlegen --------------------------------------------------------
mkdir -p "$TARGET_DIR"
for ext in "${EXTENSIONS[@]}"; do
  ln -sfn "$EXT_BASE/$ext" "$TARGET_DIR/$ext"
done
echo "Refreshed ${#EXTENSIONS[@]} extension symlinks in $TARGET_DIR"

# --- .gitignore aktualisieren ------------------------------------------------
MARKER_START="# >>> pi-crew managed extension symlinks >>>"
MARKER_END="# <<< pi-crew managed extension symlinks <<<"

# Alten Block entfernen (falls vorhanden)
if [[ -f "$GITIGNORE" ]]; then
  awk -v start="$MARKER_START" -v end="$MARKER_END" '
    $0 == start { skip=1; next }
    $0 == end   { skip=0; next }
    !skip       { print }
  ' "$GITIGNORE" > "$GITIGNORE.tmp"
  mv "$GITIGNORE.tmp" "$GITIGNORE"

  # Trailing blank lines entfernen, damit kein doppelter Abstand entsteht
  awk '{lines[NR]=$0} END {
    last=NR
    while (last > 0 && lines[last] == "") last--
    for (i=1; i<=last; i++) print lines[i]
  }' "$GITIGNORE" > "$GITIGNORE.tmp"
  mv "$GITIGNORE.tmp" "$GITIGNORE"
fi

# Neuen Block anhängen
{
  [[ -s "$GITIGNORE" ]] && echo ""
  echo "$MARKER_START"
  for ext in "${EXTENSIONS[@]}"; do
    echo "agent/extensions/$ext"
  done
  echo "$MARKER_END"
} >> "$GITIGNORE"

echo "Updated $GITIGNORE"