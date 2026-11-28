---
name: creative-qc
description: Creative quality control on a rendered video - hook in the first 1-3 s, story, visual variety, animation, character expressiveness, cinematography, humor, pacing, narration sync, music and SFX balance, factual accuracy and thumbnail - from measured frames, motion and audio plus an evaluator's timestamped scores, with a gate that refuses inflated or unevidenced scores and a scene-only repair loop (partial render and splice). Load before delivering any video, when asked to review, critique or score a render, or to fix weak scenes without re-rendering the whole film. Ships cqc.mjs.
license: MIT
metadata:
  internal: true
---

# Creative QC

A render that succeeds is a technical result, not a creative one. Creative QC
looks at the actual MP4: it measures what pixels and sound can prove, makes
sheets an evaluator reads, caps any score the measurements contradict, and
names the scenes to repair. Needs Node 18+ and ffmpeg.

## Loop

```bash
CQC=<SKILL_DIR>/cqc.mjs
node $CQC analyze renders/final.mp4 --out production/qc --scenes production/scenes.json \
  --words production/words.json --thumbnail renders/thumbnail.png --thumb-text "Two Words" \
  --research production/research.md --project .
# look at the sheets, write production/qc/eval.json (rubric.md)
node $CQC gate production/qc/review.json --eval production/qc/eval.json --project .
```

1. **analyze** writes review.json and sheets: `contact.png` (one frame per
   scene or shot), `hook.png` (0-3 s at 4 fps), `motion-*.png` for every
   flagged span. Measured findings: still holds, mostly-static scenes,
   camera-only moves on a still, rigid slides (an element moving as one
   picture), repeated compositions, long shots, a late hook, beats with no
   visual event (`--words`), loudness, peaks, silences and the narration/SFX
   mix (`sfx.sh check` when the project has `sfx/manifest.json`), thumbnail
   words and legibility. A `technical` block (resolution, fps, duration,
   codec) never raises a creative score.
2. **Evaluate**: look at every sheet and the frames you need
   (`ffmpeg -ss T -i video -frames:v 1 f.png`). Score each dimension 0-5 with
   timestamped evidence, per `rubric.md`. In a video production the
   evaluator is the creative director (Fable when the Agent tool accepts
   `model: "fable"`; otherwise do it here, from the sheets, not memory).
3. **gate** merges the evaluation and fails on: a score over its measured cap,
   a score without evidence (two timestamps for 4 or 5), `unverified` on
   something the frames always show (hook, story, visual engagement,
   animation, cinematography, pacing), any dimension under 3, hook under 4,
   mean under 3.5, an open P0 or P1 finding, or a video that changed since
   analyze. With `--project` it writes production/qc/gate.json (the deliver
   gate of `video-production` requires it for the exact delivered file) and
   marks the scenes to repair `failed`.

`unverified` is allowed, with a reason, only for what cannot be inspected
here (sync without word timings, audio mix without stems, factual accuracy
without research notes). It is never a pass.

## Repair the weak scenes, keep the rest

```bash
npx hyperframes render -o seg-a.mp4 --start 0 --end 3      # only the repaired scene
node $CQC splice renders/final.mp4 seg-a.mp4@0 seg-c.mp4@6 --out renders/final.v2.mp4
node $CQC compare renders/final.mp4 renders/final.v2.mp4 --ranges 3-6   # untouched scenes stay identical (PSNR)
```

Fix the cause named in the finding (static title card: open on the subject in
motion; rigid slide: perform the character with `character-animation`;
camera-only: animate a layer; hold: cut or add a performance), keep the
scene's timing, render only its range, splice, then run analyze and the
evaluation again on the new file. Do not re-score from memory.

## Thresholds

`T` in `cqc.mjs`, all on a 96x54 / 160x90 grey decode at 10 fps: still =
mean change under 0.25 %; a hold = 1.2 s still; a scene over 50 % still is
mostly static; camera-only = 92 % of the motion explained by one transform for
2.5 s; rigid slide = over 91.5 % of changed pixels explained by one shift
(5-sample running median) for 0.8 s, inside a local box. Measurements cap
scores; they never award them.

## Check

`node --test cqc.test.mjs` (synthetic film: a title hold, a rigid slide and a
deforming patch).
