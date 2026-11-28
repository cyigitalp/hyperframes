---
name: character-animation
description: Perform layered 2D characters in HyperFrames with rig-frame.js - walk, run, talk with lip sync, blink, look, expressions, gestures, reach and hold props, hops, squash and stretch, follow-through and comedic takes - as reusable presets with timing, intensity and direction, deterministic under any seek. Load when a scene has a character, mascot, host or cut-out figure that must act, or when a character would otherwise slide across the frame as one still picture. Ships rig-frame.js and the original character Pip.
license: MIT
metadata:
  internal: true
---

# Character animation

A character that moves as one picture is not animated. `rig-frame.js` builds
a character from parts with joint pivots (SVG art or photo cut-out pieces)
and performs it with a stack of preset clips. Every pose is a pure function
of `t`: no clock, no state between frames, so any seek order gives the same
frame.

```js
import * as R from "./rig-frame.js";
import { pip } from "./characters/pip.js";

const rig = R.createRig(pip(), { place: { x: 160, y: 980, scale: 0.9 } })
  .add(R.walk({ start: 0, steps: 4, stepDur: 0.45, stride: 120, dir: 1 }))
  .add(R.blink({ start: 0, end: 8, seed: 3 }))
  .add(R.expression({ start: 0, emotion: "smug" }))
  .add(
    R.talk({
      words: [
        ["Hi!", 2.1, 2.4],
        ["I'm", 2.5, 2.7],
        ["Pip.", 2.7, 3.1],
      ],
    }),
  )
  .add(R.gesture({ start: 2.2, type: "wave", side: "R" }))
  .add(R.take({ start: 4.1, kind: "double-take", dir: -1 }))
  .follow("tuft", "head", { gain: 1.5 });
const view = R.mountRig(svgElement, rig, { idPrefix: "pip" });
HFGsapFrame.addRenderTrack(tl, (t) => view.apply(t), { start: sceneStart, duration });
```

Copy `rig-frame.js` and `characters/` next to the composition (or into
`lib/`) and import them from a `type="module"` script; resolve the root
timeline's `buildReady` promise after `mountRig`.

## Presets

All take `start` (s) and most take `intensity`, `dir` (1 right, -1 left) or
`side` (`"L"`/`"R"`). They layer: a walk, a blink, a look, an expression and a
gesture run at once on different parts.

| Preset       | What it does                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| `walk`/`run` | contact-passing cycle, hip bob, counter-swinging arms, travel and facing; `steps`, `stride`   |
| `talk`       | visemes per word from `[[word, t0, t1], ...]` (narration timings), nods on `emphasis` words   |
| `blink`      | seeded natural blinks between `start` and `end`, plus forced blinks `at: [t]`                 |
| `look`       | eyes lead, head follows (`dx`, `dy` in -1..1), blinks on a big turn                           |
| `expression` | `EMOTIONS`: neutral, happy, sad, angry, surprised, worried, smug; crossfades                  |
| `gesture`    | wave, point, present, shrug, fist-pump with anticipation and overshoot; `hold`                |
| `reach`      | two-bone IK to a stage `target`, `hold`, return; `propMatrix()` makes a prop ride in the hand |
| `hop`        | crouch (anticipation), stretch, arc, squash on landing                                        |
| `squash`     | elastic squash-and-stretch on any part                                                        |
| `take`       | comedic reactions: `double-take`, `jolt`, `deflate`                                           |
| `follow`     | rig method: hair, tails, antennae lag behind their driver (spring, follow-through)            |

`perform(rig, scene.character.actions)` builds the same stack from
`scenes.json`, e.g. `[{ "preset": "walk", "start": 0, "steps": 4 }, ...]`.

## Timing and acting

- **Motivate every action from the beat**: talk from the word timings,
  gestures on stressed words, takes on the reveal. A reaction lands 3-6
  frames after its cause.
- **Anticipate, act, settle.** The presets do this; do not cut a preset short.
- **One read at a time**: one big action plus small ones (blink, look,
  breath). Two big actions at once read as noise.
- **Comedy is timing**: a still beat before a take, a take faster than the
  setup, a hold after it.
- Face the action: `dir` follows where the character goes or what it reacts
  to (the camera side of the thing it saw, across cuts too).

## Your own characters

A spec is `{ size: [w, h], ground: [x, y], parts: [...] }`. Each part has
`id`, `parent`, `pivot: [x, y]` (its joint, in the shared canvas), `z`, and
`art`: an SVG string drawn in place, or a photo cut-out piece
`{ href, x, y, width, height, clip: [[x, y], ...] }`. Mouths use
`variants: { rest, smile, open, wide, round, mbp, fv, teeth, frown, smirk }`.
`roles` maps preset roles (`head`, `torso`, `upperArmR`, `handR`, `lidL`,
`mouth`, ...) to your part ids, so the presets work on any rig with those
joints; a missing role is skipped. Use `characters/pip.js` as the template.

For a real photo of a person or animal, cut it out with `background-removal`
(`cutout.sh`), split it into pieces along the joints (clip polygons) and
pivot the pieces; never animate a real person to say or do something they did
not.

A custom action is a clip `{ start, end, fn(u, rig) => ({ role: { r, x, y, sx, sy } }) }`
(`u` = seconds since start); `channel` makes later clips in that channel
replace it, `priority` decides which clip wins a part, `post(pose, rig, u)`
runs after mixing (IK).

## Check

`node --test rig-frame.test.mjs`. In the render, `creative-qc` flags any
element that moves as one rigid picture (`rigid-slide`); a performing rig
does not trigger it.
