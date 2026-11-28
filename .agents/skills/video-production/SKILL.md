---
name: video-production
description: Produce a finished animated YouTube video end to end from an approved idea, without stops - research, script, ElevenLabs narration through Higgsfield, mixed-media visuals, animation, sound, render, QC, then MP4, thumbnail, title and SEO description. Load when the owner approves a video idea or says make, produce or finish a video or episode, or to resume an interrupted production. Picks the tools per scene, keeps resumable checkpoints and a credit budget (production.mjs).
license: MIT
metadata:
  internal: true
---

# Autonomous video production

The owner approves an idea. You deliver a finished, playable video. In
between you make every creative and technical decision yourself; the owner
does not pick tools, approve scenes or watch intermediate stages.

## Stop for the owner only when

1. **Spend is not authorised**: a paid call that `spend --check` refuses.
   Ask once with the estimate and what it buys; keep building everything
   that doesn't need it while you wait.
2. **A technical blocker has no workaround** in `tools.md` ("When a tool is
   unavailable").
3. **A creative decision is genuinely open**: the facts change the story the
   owner approved, or two directions differ in what the video is about. Taste
   is not open: decide.

Everything else, including style, voice, music, tools and scene order, is
yours. Report once, at delivery.

## Start or resume

```bash
node <SKILL_DIR>/production.mjs init <project> --title "<working title>" --credits <budget>
node <SKILL_DIR>/production.mjs status <project>
```

`status` names the stage to resume (`next`), any file that changed since its
stage finished (`stale`), later stages to re-confirm (`recheck`) and scenes
to repair. Always run it first in a new session: never redo a `done` stage,
an `ok` scene or a registered asset. After each stage, `done <project>
<stage> <its files>` checkpoints it. The budget is the credits the owner
approved with the idea; if none was given, ask for it once together with the
narration estimate, before the first paid call.

Production files live in `<project>/production/`; the HyperFrames project is
`<project>` itself (`npx hyperframes init`).

## Roles

Fable 5.2 does creative direction, planning and the final evaluation; Opus
5.5 does research, script, assets, animation, editing, rendering and fixes.
When this session's Agent tool accepts `model: "fable"`, run `direction` and
the evaluation in `qc` as a Fable subagent; otherwise do them here. The
handoff is files only, never the conversation:

- **To Fable (direction)**: `brief.md`, `research.md`, `script.md`,
  `tools.md`. It returns `direction.md` (look, tone, music, camera language)
  and `scenes.json`: per scene `id`, narration line range, what the viewer
  must believe, tools, assets with source (find / generate / build), camera,
  transition in.
- **To Fable (evaluation)**: `script.md`, `scenes.json`, the snapshot
  contact sheet and `REVIEW.md`. It returns a pass, or a list of scene ids
  with one concrete fix each.

## Stages

| Stage     | Do                                                                                                                                                                 | Output in `production/`             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| brief     | the approved idea, audience, target length, budget                                                                                                                 | `brief.md`                          |
| research  | verify every claim the video makes with WebSearch; two sources for anything surprising; drop what can't be sourced                                                 | `research.md` (claim → source URL)  |
| script    | American English, spoken rhythm, a hook that lands in the first 1–3 s, a joke or turn every 20–30 s, ~150 words a minute; only sourced claims                      | `script.md`                         |
| direction | creative direction and the scene plan (Fable, above); tools from `tools.md`                                                                                        | `direction.md`, `scenes.json`       |
| narration | estimate, `spend`, then Higgsfield `generate_audio` (`text2speech_v2`, `elevenlabs`); register it with `asset`; word timings with `npx hyperframes transcribe`     | `assets/narration.*`, timings       |
| assets    | per asset in `scenes.json`: `asset <key>` first (exit 0 = reuse), else find or generate it, then `asset <key> --path ... --source ... --licence ... --credits ...` | files under `assets/`, `CREDITS.md` |
| scenes    | build each scene as its own sub-composition timed to its narration words; `scene <id> built`, then `npx hyperframes check` on it; `ok` or `failed` with the error  | `compositions/*.html`               |
| edit      | master timeline, transitions (`motion-doctrine`, registry), music bed and SFX via `sound-effects` with the narration as the reference                              | `index.html`, mix files             |
| render    | `npx hyperframes render`                                                                                                                                           | `renders/final.mp4`                 |
| qc        | `check`, `snapshot --review` + `REVIEW.md`, `sfx.sh check --render`, then the evaluation                                                                           | `REVIEW.md`                         |
| deliver   | thumbnail, title, description, `production.mjs deliver` must exit 0                                                                                                | `delivery.json`                     |

## Repair, don't rebuild

A failed check, a review note or an evaluation fix names scenes. For each:
`scene <id> failed --note "<why>"`, fix only that composition, check it, mark
it `ok`, then re-run `edit` (if the timeline changed), `render` and `qc`.
Never regenerate an asset that `asset <key>` reports `ok`; a generated asset
that is wrong gets one corrected prompt, and its cost is booked again. After
three failed attempts on one scene, replace its approach with a cheaper tool
from `tools.md` rather than retrying.

## Standards that gate delivery

- Hook on screen and in the voice within 3 s; no logo or title card first.
- Every scene moves with intent: a camera move, a reveal or a cut on the
  narration; no static slides, no idle wobble.
- Mixed media: real photos or footage, generated images, 3D and motion
  graphics across the film, chosen per beat, not code-only graphics.
- Narration is the clock: scene and cue times come from its word timings.
- Music sits at least 6 LU under the narration and SFX never mask a word
  (`sfx.sh check` measures both).
- Thumbnail: 1280×720, at most three words, readable at phone size, built as
  a HyperFrames composition and saved with `snapshot`.
- Title under 70 characters for search; description with a two-line
  summary, chapters from scene times, sources from `research.md` and every
  credit `CREDITS.md` asks for.

## Delivery

`production/delivery.json`:

```json
{
  "video": "renders/final.mp4",
  "thumbnail": "renders/thumbnail.png",
  "thumbnailText": "Two Words",
  "title": "...",
  "description": "..."
}
```

`node <SKILL_DIR>/production.mjs deliver <project>` checks files, the
three-word thumbnail and that every stage and scene is done. Then give the
owner the MP4, thumbnail, title and description in one short message, with
credits spent.
