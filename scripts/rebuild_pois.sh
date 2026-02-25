#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT_PBF="${1:-}"
if [[ -z "$INPUT_PBF" ]]; then
  echo "Usage: scripts/rebuild_pois.sh <input.osm.pbf>"
  exit 1
fi

if [[ ! -f "$INPUT_PBF" ]]; then
  echo "Error: input PBF not found: $INPUT_PBF"
  exit 1
fi

if ! command -v osmium >/dev/null 2>&1; then
  echo "Error: osmium is not installed or not on PATH."
  exit 1
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Error: python3/python not found on PATH."
  exit 1
fi

FILTER_FILE="$REPO_ROOT/data/poi_filters.txt"
POIS_PBF="$REPO_ROOT/data/pois.osm.pbf"
POIS_RAW="$REPO_ROOT/data/pois_raw.geojson"
POIS_JSON="$REPO_ROOT/data/pois.geojson"
PUBLIC_DIR="$REPO_ROOT/public/data"
PUBLIC_POIS_JSON="$PUBLIC_DIR/pois.geojson"
POSTPROCESS_PY="$SCRIPT_DIR/postprocess_pois.py"

if [[ ! -f "$FILTER_FILE" ]]; then
  echo "Error: filter file missing: $FILTER_FILE"
  exit 1
fi

if [[ ! -f "$POSTPROCESS_PY" ]]; then
  echo "Error: postprocess script missing: $POSTPROCESS_PY"
  exit 1
fi

FILTERS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  trimmed="${line#"${line%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  if [[ -z "$trimmed" || "${trimmed:0:1}" == "#" ]]; then
    continue
  fi
  FILTERS+=("$trimmed")
done < "$FILTER_FILE"

if [[ ${#FILTERS[@]} -eq 0 ]]; then
  echo "Error: no usable filter expressions found in $FILTER_FILE"
  exit 1
fi

mkdir -p "$PUBLIC_DIR"

echo "[rebuild_pois] Repo root: $REPO_ROOT"
echo "[rebuild_pois] Input PBF: $INPUT_PBF"
echo "[rebuild_pois] Loaded ${#FILTERS[@]} filter expressions"

echo "[1/4] osmium tags-filter -> $POIS_PBF"
osmium tags-filter "$INPUT_PBF" "${FILTERS[@]}" -o "$POIS_PBF" --overwrite

echo "[2/4] osmium export -> $POIS_RAW"
osmium export "$POIS_PBF" -o "$POIS_RAW" --overwrite

echo "[3/4] postprocess -> $POIS_JSON"
"$PYTHON_BIN" "$POSTPROCESS_PY" "$POIS_RAW" "$POIS_JSON"

# Validate output and print counts before copying to the served file.
set +e
STATS_OUTPUT="$("$PYTHON_BIN" - "$POIS_JSON" <<'PY'
import json
import sys
from collections import Counter

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    gj = json.load(f)

features = gj.get("features") or []
counts = Counter()
for feat in features:
    kind = (feat.get("properties") or {}).get("kind")
    if kind:
        counts[kind] += 1

print(f"Feature count: {len(features)}")
print("Kind counts:")
if counts:
    for kind in sorted(counts):
        print(f"  {kind}: {counts[kind]}")
else:
    print("  (none)")

if len(features) == 0:
    sys.exit(42)
PY
)"
STATS_STATUS=$?
set -e

echo "$STATS_OUTPUT"

if [[ $STATS_STATUS -eq 42 ]]; then
  echo "Error: postprocessed output has 0 features; refusing to overwrite $PUBLIC_POIS_JSON"
  exit 1
fi
if [[ $STATS_STATUS -ne 0 ]]; then
  echo "Error: failed to inspect $POIS_JSON (python exit $STATS_STATUS)"
  exit $STATS_STATUS
fi

echo "[4/4] copy -> $PUBLIC_POIS_JSON"
cp "$POIS_JSON" "$PUBLIC_POIS_JSON"

echo "[rebuild_pois] Done."
