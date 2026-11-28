---
name: background-removal
description: Cut subjects out of photos on CPU with rembg (U^2-Net, Apache-2.0, cleared for commercial use) and use them as layers in HyperFrames, GSAP, Three.js and PixelFX compositions. Load when a video needs a transparent PNG, a subject or character isolated from its photo, an object cutout, a batch of cutouts, foreground/background separation, a background plate, layered parallax or a cutout that moves across the frame. Ships cutout.sh (cached venv, md5-checked weights, cached results, offline mode) and cutout-frame.js (placement, parallax, Three.js planes).
license: Apache-2.0
metadata:
  internal: true
---

# Background removal for HyperFrames

[rembg](https://github.com/danielgatis/rembg) (MIT) runs a segmentation model
through onnxruntime on CPU: no GPU, no API key, no paid service. About 0.3 s
per image after the model loads. This skill wraps it so the cutouts land in
the video project with a manifest the composition reads, and nothing is
downloaded or computed twice.

## Model and licences (keep these)

| Model                     | Status  | Why                                                                                      |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `u2net` (default, 176 MB) | allowed | U^2-Net weights, Apache-2.0, published by the authors (xuebinqin/U-2-Net)                |
| `silueta` (44 MB)         | allowed | the same U^2-Net weights size-reduced by the rembg author; drafts, softer edges          |
| `isnet-general-use`       | blocked | code Apache-2.0, but trained on DIS5K, whose terms forbid commercial use of derived work |
| `birefnet-*`              | blocked | code MIT, general weights also trained on DIS5K                                          |
| `bria-rmbg`               | blocked | BRIA licence, non-commercial without a paid agreement                                    |
| `u2net_human_seg`, others | blocked | training-data terms not verified                                                         |

`cutout.py` refuses blocked models, so a "better" model cannot slip in by
accident. To add one, verify both the weights licence and the training-data
terms, then add it to `MODELS` with its md5. Each run writes
`cutouts/CREDITS.md` (rembg MIT, U^2-Net Apache-2.0 and its citation); keep it
with the project and add the licence of every source photo you cut.

## 1. Cut

```bash
<SKILL_DIR>/cutout.sh run photos/ hero.jpg --out <video-project> --plate
```

The first call builds a pinned venv (`requirements.txt`) in
`~/.cache/hyperframes/rembg/venv` (about a minute) and downloads the model
once to `~/.cache/hyperframes/rembg/models`, checked by md5. Inputs are files
or folders (batch). For each image `<name>` it writes into
`<video-project>/cutouts/`:

| File               | Use                                                                          |
| ------------------ | ---------------------------------------------------------------------------- |
| `<name>.png`       | full-frame transparent cutout, registers pixel for pixel with the source     |
| `<name>.trim.png`  | the subject cropped to its bbox (+ `--pad`, default 8): sprites, characters  |
| `<name>.mask.png`  | the alpha matte (8-bit), for CSS `mask-image` or shaders                     |
| `<name>.plate.jpg` | with `--plate`: the photo with the subject removed and the hole filled       |
| `manifest.json`    | per item: size, `bbox`, `trim` rect, `centroid`, `foot`, model, md5 of files |

Options: `--matting` (pymatting alpha matting for hair and fur, slower),
`--post-process` (smoother mask for hard-edged objects), `--model silueta`
(faster draft), `--name-prefix`, `--offline`. Edges are colour-decontaminated
by default, so no halo from the old background.

The plate fill is a soft diffusion, not generative inpainting: it is meant to
sit behind the cutout (which hides most of it) and under some blur. If the
subject moves far from its hole, cover the gap or blur the plate.

`cutout.sh models` lists models and licences, `cutout.sh fetch` pre-downloads
weights, `cutout.sh verify <project>` checks every file against the manifest,
`cutout.sh cache` shows cache sizes, `cutout.sh selftest` runs the unit tests.

## 2. Cache and offline

Results are cached in `~/.cache/hyperframes/cutouts/` by the sha256 of the
image bytes plus model and options. A repeat run, or another project using
the same photo, copies from the cache with no inference (it prints
`0 inference(s), N cache hit(s)`). `--offline` never downloads and fails if
the weights are missing. `HYPERFRAMES_CACHE` moves the whole cache.

Never commit model weights or cutouts to this repo; a video project may keep
its own `cutouts/` folder.

## 3. Use in the composition

Copy `cutout-frame.js` next to `index.html`. Hold the render until images and
textures are decoded with `window.__hf.buildReady` (register it in the classic
script after the root timeline, exactly as the fixture does), and drive every
layer from one render track so any seek order lands on the same frame:

```js
import * as C from "./cutout-frame.js";
const cuts = await C.loadCutouts("cutouts/manifest.json");
const hero = cuts.get("hero");
// subject 560 px tall, feet at the bottom of the frame
const rect = C.fitSprite(hero, { x: 900, y: 750, height: 560 });
C.placeElement(heroImg, rect); // heroImg.src = cuts.url("hero") (trim.png)
HFGsapFrame.addRenderTrack(tl, (t, p) => {
  const cam = C.lerpCam({ x: -70 }, { x: 90, zoom: 1.08 }, ease(p));
  plateImg.style.transform = C.parallaxTransform(0.15, cam); // far
  heroImg.style.transform = C.parallaxTransform(1, cam, { x: walkX(t) }); // subject plane
});
```

| Helper                                          | Does                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `loadCutouts(url)` / `indexManifest(json)`      | items by name; `url(name, "trim" \| "cutout" \| "mask" \| "plate")`           |
| `fitSprite(item, { x, y, height, anchor })`     | stage rect putting the `foot` / `centroid` / `center` anchor on (x, y)        |
| `placeElement(el, rect)`                        | absolute position + transform origin at the anchor                            |
| `parallax(depth, cam)`, `parallaxTransform(…)`  | depth 0 = locked, 1 = subject plane, above 1 = foreground; `cam` = x, y, zoom |
| `lerpCam(a, b, p)`                              | camera between two keys (ease `p` with `gsap.parseEase`)                      |
| `cutoutPlane(THREE, texture, item, { height })` | transparent Three.js plane, anchor at the origin (feet on the floor)          |
| `anchorOnStage(item, rect, anchor)`             | stage point of an anchor, e.g. to aim a PixelFX burst at a character          |
| `imagesReady(imgs)`                             | resolves when every `<img>` has decoded                                       |

Patterns:

- **Foreground/background separation**: put `<name>.plate.jpg` and the
  full-frame `<name>.png` at the same rect and depth; the subject sits in its
  own hole, then animate only the cutout (lift, scale, parallax at a nearer
  depth).
- **Character movement**: animate `trim.png` with GSAP or the render track;
  `foot` keeps it planted on a floor line while it walks or bobs.
- **Three.js**: `cutoutPlane` gives billboards or cards that turn in 3D;
  textures from `cuts.url(name)`.
- **PixelFX**: canvas layers sit between cutout layers by z-order; place the
  effect with `anchorOnStage`.

A working example (plate + lifting rocket, walking character, Three.js cup,
PixelFX burst, 3-depth parallax): `.github/workflows/fixtures/background-removal/`,
rendered in CI by the background-removal step of `.github/workflows/media-deps.yml`.

## In this sandbox

PyPI and the rembg GitHub release (`github.com/danielgatis/rembg/releases`,
redirecting to `release-assets.githubusercontent.com`) are reachable from
Claude's cloud sandbox as of 2026-11-28; Hugging Face is not (proxy 403),
which is another reason the default model comes from the GitHub release. If
the release becomes unreachable, set `REMBG_MODEL_MIRROR` to a folder URL
that holds the same `.onnx` files (for example a release asset on your own
repo); the md5 check still applies. CI keeps the venv, weights and processed
cutouts in `actions/cache`.
