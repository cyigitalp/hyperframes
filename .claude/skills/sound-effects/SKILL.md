---
name: sound-effects
description: Add sound effects to a HyperFrames video on CPU with earshot (MIT, renders are free for commercial use) - cinematic hits, impacts, whooshes, risers, foley, ambience beds and comedic sounds - placed on animation frames, ducked under the narration, and checked for loudness, silence and audio/video sync. Load when a video needs sound effects, SFX, foley, ambience, a whoosh or impact on a cut, a riser into a drop, a cartoon boing, a mix of narration with music and effects, a loudness or true-peak check, silence detection, or a check that sound lands on the frame. Ships sfx.sh (cached venv, cached takes, offline mode) and sfx-frame.js (tweens anchored to cue ids).
license: MIT
metadata:
  internal: true
---

# Sound effects for HyperFrames

[earshot](https://github.com/Leonxlnx/earshot) (MIT, Leon Lin) renders a new
take of a sound from a request in words ("a heavy impact", "footsteps on
gravel", "a cartoon boing") from a catalogue of 922 designs and a bank of 252
film effects. Everything runs on CPU in a few seconds, with no model, no API
key, no paid service and no network once installed. This skill puts those
sounds on the frames of a composition, mixes them under the narration and
music, and checks the delivered render.

## Licences (keep these)

| Part                                         | Status  | Why                                                                                                                                                                                                   |
| -------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| earshot code (pinned commit `7a7f7c5`)       | used    | MIT; copy kept in `EARSHOT-LICENSE`                                                                                                                                                                   |
| sounds earshot renders (`make`, `sfx`, beds) | used    | upstream: they belong to whoever rendered them, any use, commercial too, no credit needed; learned designs come from CC0 / public-domain recordings credited in earshot's `earshot/data/*/CREDITS.md` |
| listening models (CLAP, AST; `listen` extra) | **off** | weights Apache-2.0 / BSD-3, but trained on LAION-Audio-630K and AudioSet, which include non-commercial and unlicensed audio; also downloaded from Hugging Face, which the sandbox cannot reach        |
| `earshot llm` (Gemini)                       | **off** | a paid API and an upload; never used                                                                                                                                                                  |

`sfx.sh` sets `EARSHOT_OFFLINE=1`, so no model is ever fetched. Every analysis
here is model-free (BS.1770 loudness, true peak, envelopes, cross-correlation).
`render` writes `sfx/CREDITS.md` into the project; keep it with the film.

## Narration stays as it is

Narration is made elsewhere (for example ElevenLabs through Higgsfield) and
handed in as a file. The mix reads it and never re-renders, re-levels or
re-times it: only one master gain for the whole mix touches it. Music, beds and
effects are set relative to its loudness, ducked while it speaks, and a guard
lowers anything that comes within `min_voice_margin_lu` (6 LU, 400 ms windows)
of the voice. Nothing in this skill calls Higgsfield or spends credits.

## 1. Write cues.json next to the composition

```json
{
  "fps": 30,
  "duration": 4,
  "narration": { "file": "audio/narration.mp3", "start": 0.4 },
  "music": { "file": "audio/music.mp3" },
  "library": {
    "hit": { "want": "a heavy impact", "align": "peak", "visual": true },
    "riser": { "bank": "riser/tension", "dur": 2.0, "align": "peak" }
  },
  "cues": [
    { "id": "title-slam", "use": "hit", "frame": 30 },
    { "id": "build", "use": "riser", "frame": 84 },
    { "id": "drop", "use": "hit", "frame": 84, "seed": 1, "gain_db": 1 }
  ],
  "beds": [{ "id": "room", "want": "room tone ambience", "from": 0, "to": 4 }]
}
```

- A cue is `want` (words), `sound` (a design id) or `bank` (a film-bank id;
  takes `dur`, `apex`, `pitch`), plus `at` (s) or `frame`, `align` (`onset`,
  `peak` default, or `end`: which moment of the sound lands on the frame),
  `gain_db`, `seed` (another take) and earshot's knobs (`dur`, `pitch`,
  `events`, `bright`, `hard`, `ring`, `size`, `space`, `width`, `energy`,
  `motion`, each -1..1). `visual: true` asks `check` to find a picture change
  on that frame.
- `library` holds reusable presets; a cue `use`s one and overrides any field.
- `music` is a file or an earshot loop (`"sound": "bed/warm"`); earshot makes
  no real music. `mix` overrides the levels (`target_lufs` -14,
  `music_under_voice_lu` 18, `bed_under_voice_lu` 20, `sfx_under_voice_lu` 3,
  `duck_db` 8, `min_voice_margin_lu` 6, `ceiling_dbtp` -1.5).
- Find designs: `<SKILL_DIR>/sfx.sh earshot sounds --search whoosh` and
  `<SKILL_DIR>/sfx.sh earshot sfx list`. Good starting words: cinematic `a
heavy impact`, `a deep boom`, `a fast whoosh`, `a tension riser` (or bank
  `riser/*`, `whoosh_big/*`, `impact/*`, `cut_hit/*`, `reverse_swell/*`);
  foley `a camera shutter`, `a door shutting`, `footsteps on gravel`;
  ambience `room tone ambience`, `rain on a window`, `a busy cafe`; comedic
  `a cartoon boing`, `a slapstick crack`. `earshot make --set film` makes a
  whole 17-sound motion-design set.

## 2. Render the sound

```bash
<SKILL_DIR>/sfx.sh render <project>/cues.json
```

The first call builds a pinned venv (`requirements.txt`) in
`~/.cache/hyperframes/earshot/venv` (about a minute; PyPI plus a git clone of
earshot from github.com). Takes are cached in
`~/.cache/hyperframes/earshot/takes` by their parameters and the earshot
commit, so a re-run or a fresh project makes nothing twice; `--offline` fails
instead of rendering. It writes into the project:

- `audio/mix.wav` (the finished mix) and `audio/stems/{voice,music,beds,sfx,rest}.wav`
- `sfx/cues.js` (`window.__sfxCues`: each cue's frame), `sfx/manifest.json`,
  `sfx/takes/*.wav`, `sfx/CREDITS.md`

## 3. Anchor the animation to the cues

```html
<script src="sfx/cues.js"></script>
<audio
  id="mix"
  class="clip"
  src="audio/mix.wav"
  data-start="0"
  data-duration="4"
  data-track-index="6"
  data-volume="1"
></audio>
<script type="module">
  import * as S from "./sfx-frame.js"; // copy <SKILL_DIR>/sfx-frame.js into the project
  S.land(tl, "title-slam", 6, (d) =>
    gsap.from("#title", { scale: 2.4, duration: d, ease: "power4.in" }),
  );
  S.hit(tl, "title-slam", "#flash", { opacity: 0.85 }, { opacity: 0 });
</script>
```

`land(tl, id, frames, make, {start})` ends a tween on the cue's frame (or
starts it there); `hit` sets a one-frame visual hit; `time(id, offsetFrames)`
and `frame(id)` give the numbers. Move a sound by editing `cues.json` and
re-running `render`: the picture follows. A cut placed by another skill uses
`S.time(id)` too.

## 4. Check the render

```bash
npx hyperframes lint && npx hyperframes check && npx hyperframes render -o out.mp4
<SKILL_DIR>/sfx.sh check <project> --render out.mp4
```

It fails (exit 1) on: no or silent audio, true peak over -1 dBTP, audio and
video starting at different times, a cue more than one frame
(`--tolerance-frames`) from its frame in the delivered audio, a `visual` cue
without a picture change on its frame, or music and effects within the
narration margin. It warns on loudness off target by more than 1.5 LU, a
silence longer than 1.5 s inside the film, audio and video lengths that
differ, and a cue 12 LU or more under voice and music. `sfx.sh analyze FILE`
measures any file or video (LUFS, true peak, LRA, silences, onsets).

## Limits

- earshot picks from a fixed catalogue: no speech, singing or melodies; a mood
  request is understood less well than one that names the thing. Read the
  `made ...` line `render` prints and pick another design (`sound`) or `seed`
  when it chose the wrong thing.
- Without the listening models, `earshot build` drafts and measures but does
  not hear, and `describe`, `match`, `timeline` and `critique` are not
  available.
- ogg/mp3 output needs ffmpeg on PATH (HyperFrames needs it anyway); the mix
  is WAV.
