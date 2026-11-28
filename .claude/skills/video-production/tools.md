# Tool selection

Pick per scene from what the shot must show, then load only the skills in the
"Load" column for the tools you picked. Each row is a summary; the skill named
is the source of truth for how to use it. Paid = Higgsfield credits, which go
through `production.mjs spend` first.

| Tool                 | Best for                                                                                                      | Limits                                                     | Load                                                      | Cost |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ---- |
| HyperFrames          | every scene, the master timeline, render, check                                                               | the render contract (`/hyperframes`)                       | `/hyperframes`, `/hyperframes-cli`                        | free |
| Registry blocks      | named visuals: transitions, titles, kinetic type, captions, lower thirds, grain                               | edit the installed source, don't rebuild                   | `/hyperframes-registry`                                   | free |
| GSAP                 | all timing, eases, camera moves, text and layer motion                                                        | one paused root timeline                                   | `gsap-hyperframes` (+ one `gsap-*` skill if needed)       | free |
| Three.js             | cinematic 3D: objects, products, globes, depth, real camera moves                                             | heavy scenes slow the render; keep polycount low           | `gsap-hyperframes`; style post from `lemo-opuscar-styles` | free |
| Poly Haven           | real 3D props, PBR materials, HDRI light for Three.js                                                         | CC0; sandbox can't reach it (CI fetches and caches)        | `polyhaven-assets`                                        | free |
| PixelFX              | pixel-art, dithering, retro and game looks                                                                    | a look, not a whole film                                   | `gsap-hyperframes` (`pixelfx-frame.js`)                   | free |
| Lemo-Opuscar         | one named film style for the whole video; CRT, tape, DOF, bloom post                                          | style guides are fetched per film, never committed         | `lemo-opuscar-styles`                                     | free |
| Data animation       | exact numbers: races, line reveals, counters, comparisons                                                     | needs a dataset with a source                              | `data-animation`                                          | free |
| Map animation        | places, borders, routes, fly-to between global and local                                                      | Natural Earth countries only, no street maps               | `map-animation`                                           | free |
| Rembg                | cutouts of real photos or AI images for parallax and collage                                                  | u2net only (licence); stills, not video                    | `background-removal`                                      | free |
| Earshot              | whooshes, hits, risers, foley, ambience, comedic sounds; loudness and sync check                              | no music; listen models off                                | `sound-effects`                                           | free |
| Higgsfield image     | an image that can't be found: a scene, a character, a stylised plate                                          | must not fake a real person, event or document             | `generate_image`                                          | paid |
| Higgsfield video     | a short live or character shot that motion graphics can't sell                                                | 5–10 s clips; most expensive item, use for key beats only  | `generate_video`                                          | paid |
| Higgsfield narration | the voice: `generate_audio` with `model: "text2speech_v2"`, `variant: "elevenlabs"`, voice from `list_voices` | generated once, then never altered                         | —                                                         | paid |
| Higgsfield music     | a bed when no free track fits: `suno_music`, instrumental                                                     | 15–360 s                                                   | —                                                         | paid |
| Real photography     | authentic people, places, objects, archive moments                                                            | licence must allow commercial use; credit what asks for it | `visual-director` (`photo-search.mjs`), `/media-use`      | free |
| Character rigs       | characters that walk, talk, emote, gesture, react and hold props                                              | 2D layered rigs; real people only from their own footage   | `character-animation` (`rig-frame.js`)                    | free |
| Virtual camera       | dolly, track, push-in, parallax, rack focus, shake across layered planes or Three.js                          | needs layers at depths to read as space                    | `cinematography` (`camera-frame.js`)                      | free |
| Creative QC          | scoring the render, finding weak scenes, partial re-render and splice                                         | ffmpeg; evaluation needs someone to look at the sheets     | `creative-qc` (`cqc.mjs`)                                 | free |
| Transcribe           | word timings from the narration for timing and captions                                                       | local                                                      | `npx hyperframes transcribe`                              | free |

Price every paid call with `estimate_image_cost`, `estimate_video_cost` or
`estimate_audio_cost` before it, and check the account with `balance` once per
production. Never use the paid `remove_background` when Rembg can do it.

## Picking per scene

Ask what the beat must make the viewer believe, and take the cheapest tool
that sells it:

- **A fact that happened or a real thing**: real photography or archive
  (`photo-search.mjs`), cut out with Rembg, layered with moving annotations
  and effects under a motivated camera, or a map or chart when the fact is a
  place or a number. A generated image of a real thing is labeled.
- **A number**: data animation. **A place or a route**: map animation.
- **An idea, a mechanism, a "what if"**: Three.js with Poly Haven props and
  light, or motion graphics from registry blocks.
- **A character, a joke, a scene no camera caught**: a rig performance
  (`character-animation`; a Higgsfield image cut into rig parts when the look
  needs it), Higgsfield video only for a key beat.
- **Texture and era**: a Lemo-Opuscar style or PixelFX look across the film,
  not per scene.

Combine freely: a Higgsfield plate behind a Rembg cutout with a data overlay
is one scene. Do not use a tool because it is available; most videos need
four to six of these, not all of them.

## When a tool is unavailable

| Failure                                 | Do instead                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Poly Haven blocked (sandbox)            | push the branch and let CI fetch, or use primitives with a procedural material; never stall                                                                      |
| Higgsfield not connected or over budget | real photography, Three.js or motion graphics for visuals; local `npx hyperframes tts` only as a scratch voice for timing, never shipped without the owner's yes |
| Hugging Face blocked                    | nothing here needs it; don't pick a tool that does                                                                                                               |
| A render or check crash                 | `/hyperframes-cli` recovery; mark the scene `failed` with the error and move on                                                                                  |
| A licence unclear                       | don't use the asset; find another                                                                                                                                |
