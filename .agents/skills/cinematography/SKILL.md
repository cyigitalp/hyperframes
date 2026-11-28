---
name: cinematography
description: Direct a virtual camera through layered HyperFrames scenes with camera-frame.js - establishing and close shots, dolly, tracking, crane, push-in and pull-out, 2.5D parallax, rack focus and depth of field, dolly zoom, punch-ins, whip pans, handheld and impact shake, atmospheric depth and seamless shot-to-shot continuity - deterministic and frame-accurate, synced to narration words. Load when a scene needs camera movement, depth, parallax, focus pulls or shot planning, or when a photo or illustration should feel like a filmed space instead of a slide.
license: MIT
metadata:
  internal: true
---

# Cinematography

`camera-frame.js` is one camera for a stack of flat layers (photos, cut-outs,
SVG, text) placed at depths. It moves in real units (dolly `z`, track `x`,
crane `y`, lens `zoom`, `roll`, `focus`, `aperture`), and each layer gets the
scale, shift and thin-lens blur that depth implies: near layers move more and
blur when out of focus, far layers barely move and can fade into haze. A dolly
changes perspective, a zoom does not. Every value is a pure function of `t`.

```js
import * as C from "./camera-frame.js";

const cam = C.cameraTrack(
  C.sequence(
    C.shots.establish({ t0: 0, t1: 1.6, from: { z: -340, y: -90 }, to: { z: -120 } }),
    C.shots.track({ t0: 1.6, t1: 3.4, x: 200 }),
    C.shots.rackFocus({ t: 3.4, from: 430, to: 1000, aperture: 7 }),
    C.shots.pushIn({ t0: C.atWord(words, "inside"), t1: 6, z: 180 }),
  ),
);
const layers = [
  { el: $("sky"), depth: 4000, atmosphere: { near: 1500, far: 5000, amount: 0.4 } },
  { el: $("subject"), depth: 1000 }, // depth 1000 = the focal plane: 1:1 at rest
  { el: $("foreground"), depth: 450 },
];
HFGsapFrame.addRenderTrack(tl, (t) =>
  C.applyLayers(layers, C.addCam(cam(t), C.handheld(t, { amp: 2 })), { maxBlur: 14 }),
);
```

Each layer element is a full-stage plane (`position:absolute; inset:0` or
`left:0; top:0; width/height` of the stage). Oversize far layers so a move
never shows their edge (`data-layout-allow-overflow` on the clip). Authored
CSS filters on a layer are kept; the camera adds blur and haze on top.

## Shot vocabulary

| Helper                         | Use it for                                                                |
| ------------------------------ | ------------------------------------------------------------------------- |
| `shots.establish`              | open wide on the place, then settle: where are we                         |
| `shots.pushIn` / `pullOut`     | push in = attention, realisation; pull out = context, isolation, a reveal |
| `shots.track` / `crane`        | follow a subject or reveal along the set; crane to change status or scale |
| `shots.rackFocus`              | move attention between depths without a cut                               |
| `shots.dollyZoom`              | the ground shifts under the subject: vertigo, a shock                     |
| `shots.punchIn`                | a comic or emphatic hit on a word, 4-6 frames                             |
| `shots.whipPan`                | a fast handoff between two ideas; pair with a whip on the next shot       |
| `shots.lock`                   | hold still: let a performance or a joke land                              |
| `handheld`, `impact`           | subtle documentary life; a hit that shakes the frame and decays           |
| `zForShot`, `aimAt`, `thirds`  | frame a subject at a shot size (`SHOT_SIZES`), on a thirds point          |
| `atWord(words, text, n)`       | the time of a narration word: cut and move on the beat                    |
| `seamContinuity(a, tA, b, tB)` | match velocity across a cut so two scenes read as one move                |
| `syncThreeCamera`              | drive a Three.js camera from the same track, so 3D and 2D layers agree    |

## Rules

- **Every move has a reason**: a word, a reveal, a subject that moves. Write
  it in `scenes.json` as `camera.motivation`. No reason, no move: `lock`.
- **One move per idea.** A push-in plus a track plus roll is three ideas.
- **Depth is earned by layers**: at least a background, the subject and a
  foreground element (grass, glass, dust, a hand). Cut photos into planes
  with `background-removal` (subject + clean plate).
- **Hierarchy**: the subject sits on a thirds point or dead centre for a
  confrontation, in focus, brightest; everything else supports it.
- **Vary scale across the film**: wide, medium, close. Three shots in a row
  at the same size and move read as a slideshow.
- **Transitions continue a move** (`motion-doctrine`, `cut-the-curve`):
  exit and enter on the same vector; `seamContinuity` checks the speeds.
- Light and air: a light beam layer with `mix-blend-mode: screen`, dust
  motes at two depths, `atmosphere` haze on far layers, a vignette last.

## Check

`node --test camera-frame.test.mjs`. In the render, `creative-qc` measures
camera-only motion (a Ken Burns move with nothing else alive) and still holds.
