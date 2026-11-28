#!/usr/bin/env bash
# sfx.sh: run sfx.py in a pinned, cached Python venv with earshot (CPU only, no API key, no model download).
# The venv lives in $HYPERFRAMES_CACHE/earshot/venv (default ~/.cache/hyperframes)
# and is rebuilt only when requirements.txt changes.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${HYPERFRAMES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/hyperframes}"
VENV="$CACHE/earshot/venv"
PY="${PYTHON:-python3}"
STAMP="$(sha256sum "$HERE/requirements.txt" | cut -c1-16)"
if [ "$(cat "$VENV/.stamp" 2>/dev/null)" != "$STAMP" ]; then
  echo "sfx: creating venv in $VENV (one time, ~1-2 min)" >&2
  rm -rf "$VENV"
  "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check -r "$HERE/requirements.txt" >&2
  echo "$STAMP" > "$VENV/.stamp"
fi
# earshot's decode cache and numba's compiled loops stay in the cache too; never download models.
export HYPERFRAMES_CACHE="$CACHE" EARSHOT_HOME="$CACHE/earshot/home" NUMBA_CACHE_DIR="$CACHE/earshot/numba"
export EARSHOT_OFFLINE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
if [ "${1:-}" = selftest ]; then
  exec "$VENV/bin/python" -I -B "$HERE/test_sfx.py" -v
fi
exec "$VENV/bin/python" -I -B "$HERE/sfx.py" "$@"
