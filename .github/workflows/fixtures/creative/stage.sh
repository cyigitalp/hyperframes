#!/usr/bin/env bash
# Assemble one creative demo into a render folder:
#   stage.sh <demo> <workdir> <media-dir>
# <media-dir> holds cutouts/ (cutout.sh run coffee.png chelsea.png --plate) and
# textures/ (brick.png, grass.png, coffee.png): CC0 sample photos bundled with scikit-image.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEMO="$1"; W="$2"; MEDIA="$3"
SK="$ROOT/.claude/skills"
mkdir -p "$W/lib" "$W/characters"
cp -r "$ROOT/.github/workflows/fixtures/creative/$DEMO/." "$W/"
cp "$ROOT/node_modules/gsap/dist/gsap.min.js" "$W/lib/"
cp "$SK/gsap-hyperframes/gsap-frame.js" "$SK/cinematography/camera-frame.js" \
   "$SK/character-animation/rig-frame.js" "$SK/background-removal/cutout-frame.js" "$W/"
cp "$SK/character-animation/characters/pip.js" "$W/characters/"
cp -r "$MEDIA/cutouts" "$MEDIA/textures" "$W/"
