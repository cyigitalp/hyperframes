# Project-local Codex CLI skills

Skills in this directory are auto-discovered by Codex CLI (verified against
Codex 0.144.3) when the `hyperframes` repo is opened as the working
directory. They are NOT part of the marketplace-distributed plugin (that
set lives under `skills/` and is manifested by `.codex-plugin/`). Two
separate namespaces, on purpose:

- `.agents/skills/` — **repo-native**, run only against this repo
  (weekly changelog videos, doctrine-heavy authoring flows). Codex CLI's
  project-local skill dir.
- `skills/` — **marketplace-distributable**, installed into other
  projects via `npx hyperframes skills` or `npx skills add
heygen-com/hyperframes`.

## Weekly changelog video

The `changelog-video` skill turns a weekly changelog markdown into a
~45–60s branded 1080×1080 MP4 (motion-doctrine layout, Annie VO,
seam-gated cuts, caption rail). It ships pre-configured — fonts,
background pattern, house BGM, lexicon, and the align-captions script
all live inside `changelog-video/`. Its five dependency skills
(`motion-doctrine`, `cut-the-curve`, `captions-overlay`, `seam-craft`,
`oversized-cursor`) sit alongside so the router graph is complete on
clone.

Weekly usage:

1. Regenerate the digest markdown for the target range:
   `bun run changelog:weekly --from YYYY-MM-DD --to YYYY-MM-DD` (this
   only reads git; the `--write` variant is what the docs cron uses).
2. In Codex CLI at the repo root, invoke `/changelog-video` with the
   generated markdown. The agent will present its script +
   visualization plan for review before rendering.
3. Accept, and the agent produces `weekly-changelog-<range>.mp4` gated
   by `hyperframes check` (0 errors) + `seam-gate verify` (0 fail/warn).

TTS uses the tracked `skills/hyperframes-media/scripts/heygen-tts.mjs`
(no extra install needed). Runtime dependencies you need on PATH:

- Node ≥ 22
- HeyGen CLI ≥ 0.3.0, authenticated via `heygen auth login --oauth`
- `ffmpeg` (for VO wav conversion + frame QA)
- A headless Chrome for HyperFrames rendering (`hyperframes doctor`
  will point out the exact ask if it's missing)

The parallel set at `.claude/skills/` is a byte-identical copy so
Claude Code users get the same auto-discover behaviour — keep the two
in sync when editing. A `scripts/check-skill-mirror.mjs` check enforces
this at CI time.

Each repo-native skill declares `metadata.internal: true`. That excludes it from
normal `npx skills add` discovery and from `npx skills add ... --all`. A named
`npx skills add ... --skill <name>` still installs a matching skill regardless of
`metadata.internal`; no environment variable is needed. `INSTALL_INTERNAL_SKILLS=1`
opts internal skills into normal discovery and bulk installation. This does not
change local agent discovery.

## GSAP skills

`gsap-core`, `gsap-timeline`, `gsap-utils`, `gsap-plugins` and
`gsap-performance` are the official
[greensock/gsap-skills](https://github.com/greensock/gsap-skills), copied
unmodified (MIT). `gsap-hyperframes` adapts them to the render contract and
ships `gsap-frame.js`, frame-accurate helpers for GSAP, Three.js and canvas.
Upstream commit and update steps are in `gsap-hyperframes/UPSTREAM.md`.

## Lemo-Opuscar styles

`lemo-opuscar-styles` makes the 99 [Lemo-Opuscar](https://github.com/lemomo-ai/lemo-opuscar)
film styles searchable (`vendor/lemo-opuscar/styles.jsonl`, one line per style)
and documents its vendored MIT helpers: CRT/videotape post, Three.js depth of
field and bloom, and easings. Style guides (CC BY-NC) are fetched per film,
never committed. Scope and update steps: `vendor/lemo-opuscar/UPSTREAM.md`.

## Data animation

`data-animation` adapts [iart-ai/data-animation-skills](https://github.com/iart-ai/data-animation-skills)
(MIT) to the render contract: bar chart races, line reveals, counters,
financial comparisons and data infographics with exact numbers on every
frame. It ships `data-frame.js` (CSV parsing and validation, rounding,
`Intl` formatting, race ranks, line paths) and loads one reference at a time.
Upstream commit and scope: `data-animation/UPSTREAM.md`.

## Map animation

`map-animation` adapts [iart-ai/map-animation-skills](https://github.com/iart-ai/map-animation-skills)
(MIT) to the render contract: animated world maps, country and region
highlights, comparisons, border draw-ons, pins, great-circle routes and a
smooth fly-to camera between global and regional views. It ships
`map-frame.js` (projections, country paths, routes, camera) with no
dependency, and uses Natural Earth country data (public domain) from
`vendor/natural-earth/`. Upstream commit and scope: `map-animation/UPSTREAM.md`.

## Poly Haven assets

`polyhaven-assets` brings free CC0 [Poly Haven](https://polyhaven.com) 3D
models (glTF), PBR materials and HDRIs into Three.js compositions. It picks
assets from scene requirements through the public API, sizes them to the
shot, caches downloads by md5 outside the repo, copies them into the video
project for offline rendering, and writes the "Powered by Poly Haven" credit
the API terms ask for. Nothing downloaded is committed here.

## Background removal

`background-removal` cuts subjects out of photos on CPU with
[rembg](https://github.com/danielgatis/rembg) (MIT) and the U^2-Net model
(Apache-2.0; models with non-commercial weights or training data are
refused). It writes transparent cutouts, trimmed sprites, mattes and
hole-filled background plates into the video project with a manifest, caches
the pinned venv, the md5-checked weights and every processed image outside
the repo, and ships `cutout-frame.js` for placement, parallax and Three.js
planes. Nothing downloaded or generated is committed here.

## Sound effects

`sound-effects` adds cinematic hits, whooshes, risers, foley, ambience and
comedic sounds with [earshot](https://github.com/Leonxlnx/earshot) (MIT; the
sounds it renders are free for any use) on CPU, with no model, API key or
paid service. A cue list next to the composition names each sound and its
frame; `sfx.sh render` places each take on its frame, ducks music and beds
under a supplied narration file (never altered), and writes the mix, stems,
the cue times the frame helper anchors tweens to, and a credits file.
`sfx.sh check` verifies loudness, true peak, silences, the narration margin
and frame sync in the render. The pinned venv and every take are cached
outside the repo.

## Video production

`video-production` is the entry point for making a whole video from an
approved idea with no stops: research, script, ElevenLabs narration through
Higgsfield, per-scene tool selection across every skill above (`tools.md`),
animation, sound, render, QC and delivery of the MP4, thumbnail, title and
description. `production.mjs` keeps resumable checkpoints in the video
project (stages, scenes and assets hashed, so nothing finished is redone or
paid for twice) and refuses Higgsfield spend past the owner's budget.

## Creative direction, characters, camera and QC

`visual-director` picks each scene's medium from what the viewer must believe:
real, commercially licensed evidence for real things (`photo-search.mjs`:
Openverse, Wikimedia Commons, NASA, with credits), labeled recreations,
layered photo scenes and one art direction; `plan-check.mjs` lints the scene
plan. `character-animation` performs layered 2D rigs (`rig-frame.js`: walk,
talk with visemes, blink, look, expressions, gestures, reach with IK, takes,
follow-through) with the original character Pip. `cinematography` moves a
virtual camera through layers at depths (`camera-frame.js`: dolly, track,
push-in, parallax, rack focus, dolly zoom, handheld). `creative-qc` scores the
rendered video (`cqc.mjs`: measured holds, rigid slides, camera-only moves,
hook, audio; evaluator scores with timestamped evidence; a gate that refuses
inflated scores) and repairs weak scenes by partial render and splice.
Demos and the QC repair loop run in CI from `.github/workflows/fixtures/creative/`.
