---
name: gsap-hyperframes
description: Bridge between the official GSAP skills (gsap-core, gsap-timeline, gsap-utils, gsap-plugins, gsap-performance) and the HyperFrames render contract. Load when writing GSAP animation for a HyperFrames composition, driving Three.js, canvas or pixelfx pixel-art effects from a GSAP timeline, or needing frame-accurate timing helpers (gsap-frame.js, pixelfx-frame.js).
license: MIT
---

# GSAP in HyperFrames

The `gsap-*` skills next to this one are vendored verbatim from
[greensock/gsap-skills](https://github.com/greensock/gsap-skills) (MIT, see
`UPSTREAM.md`). They describe GSAP for interactive pages. HyperFrames renders
by seeking a paused timeline frame by frame, so apply them with these rules,
which win where they differ.

## Render contract overrides

- One paused root timeline per composition on `window.__timelines[id]`. Never call `play()`, and never rely on `gsap.ticker`, `requestAnimationFrame` or `delayedCall` for timing.
- Every animation is finite and lives on the timeline: no `repeat: -1`, no standalone tweens outside the root, no `yoyo` without a finite `repeat`.
- Skip interaction and scroll plugins: ScrollTrigger (its skill is not vendored), ScrollSmoother, Draggable, Inertia, Observer, GSDevTools. They depend on user input or wall time.
- Deterministic plugins are fine: SplitText, Flip (record states before building), MotionPath, DrawSVG, MorphSVG, CustomEase, EasePack. Register them before building the timeline.
- `gsap.utils.random()` is unseeded. Use `HFGsapFrame.seededRandom(seed)`.
- `gsap.matchMedia()` and `prefers-reduced-motion` do not apply to a fixed-size render.

## Frame-accurate helpers (`gsap-frame.js`)

Copy `gsap-frame.js` beside the composition and load it after GSAP:

```html
<script src="lib/gsap.min.js"></script>
<script src="gsap-frame.js"></script>
<script>
  const FPS = 30;
  const F = HFGsapFrame;
  const tl = F.createRootTimeline(gsap, { fps: FPS, durationFrames: 90 });
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl; // keep this literal: `hyperframes lint` looks for it
  tl.from(".title", { y: 80, opacity: 0, duration: F.frames(12, FPS) }, F.frames(6, FPS));
  tl.to(
    ".dots",
    { x: 200, stagger: F.frames(2, FPS), duration: F.frames(20, FPS) },
    F.frames(30, FPS),
  );
</script>
```

| Helper                                              | Use                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `frames(n, fps)`                                    | durations, positions, staggers in frames                               |
| `frameToTime`, `timeToFrame`, `snapTime`            | convert and snap without float drift                                   |
| `createRootTimeline(gsap, { fps, durationFrames })` | paused root, padded to an exact length                                 |
| `seekFrame(tl, frame, fps)`                         | seek tests and previews to a frame start                               |
| `addRenderTrack(tl, render, { start, duration })`   | linear proxy tween calling `render(localTime, progress)` on every seek |
| `frameSteps(gsap, durationFrames, holdFrames)`      | stepped ease for on-twos or pixel-style motion                         |
| `seededRandom(seed)`                                | deterministic PRNG                                                     |

## Three.js and canvas

Drive renderers from the timeline, never from a render loop. Create the
renderer with `preserveDrawingBuffer: true`, then:

```js
F.addRenderTrack(tl, (t) => {
  mesh.rotation.y = t * Math.PI;
  renderer.render(scene, camera);
});
```

Use `ease: "none"` on the proxy (the helper does) and put easing inside the
render function, so the seeked time maps one to one to scene state.

## PixelFX pixel-art effects

`pixelfx` (github:patch-gg/pixelfx, pinned in the root `package.json`) ships
244 code-driven pixel effects. Its sims step forward only, so drive them with
`pixelfx-frame.js`, which replays from frame 0 in fixed `1 / fps` steps on any
backwards seek. Every seek order lands on the same pixels.

Copy `node_modules/pixelfx/src` into the project (for example `lib/pixelfx/`),
then:

```html
<canvas
  id="pixels"
  class="clip"
  width="288"
  height="192"
  style="width: 576px; height: 384px; image-rendering: pixelated"
></canvas>
<script type="module">
  import * as pixelfx from "./lib/pixelfx/core/index.js";
  import * as nova from "./lib/pixelfx/fx/ice/frost-nova.js";
  import { addPixelfxTrack } from "./pixelfx-frame.js";
  addPixelfxTrack(tl, {
    pixelfx,
    fx: nova,
    fps: 30,
    start: 0.5,
    ctx: document.getElementById("pixels").getContext("2d"),
    options: { seed: 4, palette: ["#102", "#215", "#43a", "#8cf", "#cff", "#fff"] },
    bg: null, // transparent over the Three.js / DOM layers
  });
</script>
```

Set the canvas to the effect's pixel size (`fx.meta.size`) and scale it with
CSS. Keep `seed` fixed for repeatable renders.
