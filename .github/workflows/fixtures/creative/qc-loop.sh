#!/usr/bin/env bash
# The creative QC loop on a deliberately weak cut, end to end:
#   qc-loop.sh <workdir> <media-dir>
# 1. render the weak cut (static title card, a character slid as one picture)
# 2. analyze it; inflated scores must fail the gate; an honest evaluation
#    must fail it and name only the two weak scenes for repair
# 3. fix those scenes, render only their ranges, splice them in, prove the
#    untouched scene is identical, and pass the gate on the repaired cut.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
W="$1"
MEDIA="$2"
HF="${HF:-npx -y hyperframes@0.9.104}"
CQC="$HERE/../../../../.claude/skills/creative-qc/cqc.mjs"
CQC="$(cd "$(dirname "$CQC")" && pwd)/cqc.mjs"
frames() { ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$1"; }

bash "$HERE/stage.sh" qc "$W" "$MEDIA"
cd "$W"
grep -q "const FIXED = false;" index.html
$HF lint
$HF check
$HF render -f 30 -o weak.mp4 --quiet
test "$(frames weak.mp4)" -eq 270

node "$CQC" analyze weak.mp4 --out qc-weak --scenes scenes.json
if node "$CQC" gate qc-weak/review.json --eval eval-inflated.json > gate-inflated.json; then
  echo "::error::inflated scores passed the gate" && exit 1
fi
if node "$CQC" gate qc-weak/review.json --eval eval-weak.json > gate-weak.json; then
  echo "::error::the weak cut passed the gate" && exit 1
fi
node -e '
  const g = JSON.parse(require("fs").readFileSync("gate-weak.json", "utf8"));
  const r = [...g.repair].sort().join(",");
  console.log("repair:", r);
  if (r !== "a_hook,c_walk") throw new Error(`expected repair a_hook,c_walk, got ${r}`);
'

sed -i 's/const FIXED = false;/const FIXED = true;/' index.html
$HF check
$HF render -f 30 -o seg-a.mp4 --start 0 --end 3 --quiet
$HF render -f 30 -o seg-c.mp4 --start 6 --end 9 --quiet
node "$CQC" splice weak.mp4 seg-a.mp4@0 seg-c.mp4@6 --out repaired.mp4
test "$(frames repaired.mp4)" -eq 270
node "$CQC" compare weak.mp4 repaired.mp4 --ranges 0-3,3-6,6-9 | tee compare.json
node -e '
  const c = JSON.parse(require("fs").readFileSync("compare.json", "utf8"));
  if (!(c[1].minPsnr > 40)) throw new Error(`untouched scene b changed: ${JSON.stringify(c[1])}`);
  if (!(c[0].meanPsnr < 30 && c[2].meanPsnr < 30)) throw new Error("repaired scenes did not change");
'
node "$CQC" analyze repaired.mp4 --out qc-repaired --scenes scenes.json
node "$CQC" gate qc-repaired/review.json --eval eval-repaired.json | tee gate-repaired.json
