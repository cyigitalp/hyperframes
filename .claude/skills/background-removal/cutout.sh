#!/usr/bin/env bash
# cutout.sh: run cutout.py in a pinned, cached Python venv (CPU only, no API key).
# The venv lives in $HYPERFRAMES_CACHE/rembg/venv (default ~/.cache/hyperframes)
# and is rebuilt only when requirements.txt changes.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${HYPERFRAMES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/hyperframes}"
VENV="$CACHE/rembg/venv"
PY="${PYTHON:-python3}"
STAMP="$(sha256sum "$HERE/requirements.txt" | cut -c1-16)"
if [ "$(cat "$VENV/.stamp" 2>/dev/null)" != "$STAMP" ]; then
  echo "cutout: creating venv in $VENV (one time, ~1-2 min)" >&2
  rm -rf "$VENV"
  "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check -r "$HERE/requirements.txt" >&2
  echo "$STAMP" > "$VENV/.stamp"
fi
export HYPERFRAMES_CACHE="$CACHE" NUMBA_CACHE_DIR="$CACHE/rembg/numba"
if [ "${1:-}" = selftest ]; then
  exec "$VENV/bin/python" -I -B "$HERE/test_cutout.py" -v
fi
exec "$VENV/bin/python" -I -B "$HERE/cutout.py" "$@"
