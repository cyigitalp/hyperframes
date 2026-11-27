---
name: polyhaven-assets
description: Find, pick, cache and load free CC0 Poly Haven assets (3D models, PBR textures and materials, HDRI environments) for a HyperFrames Three.js scene. Load when a video needs a real 3D prop, a realistic surface material, HDRI lighting or an environment background. Ships polyhaven.mjs (search, automatic selection from scene requirements, md5-checked cache, offline verify) and polyhaven-three.js (HDRI, PBR material and glTF loaders).
license: Apache-2.0
metadata:
  internal: true
---

# Poly Haven assets in HyperFrames

[Poly Haven](https://polyhaven.com) publishes HDRIs, PBR textures and 3D models
under CC0 through a free [public API](https://github.com/Poly-Haven/Public-API).
This skill fetches only the assets a video uses, at the resolution the shot
needs, into the video project, so rendering never touches the network.

No API key, no Blender, no new engine: models come as glTF, materials as JPG
maps, HDRIs as `.hdr`, all loaded by the three.js already in the repo and
driven by the GSAP root timeline (`gsap-hyperframes`).

## Terms (keep these)

- Assets are CC0: no attribution required, any use.
- The API's [terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)
  require a unique User-Agent (`polyhaven.mjs` sends `HyperFrames-PolyHaven/1.0`,
  never personal details) and a light credit when content is found through the
  live API. Show `creditLine(manifest)` ("… Powered by Poly Haven (CC0)") on
  screen or in the end credits, and keep the generated `CREDITS.md`. Never
  imply Poly Haven made or endorses the video.
- Be gentle: one scene at a time, the cache stops repeat downloads, never
  mirror the library.

## 1. Describe the scene, let it pick

`scene.json` in the video project:

```json
{
  "output": { "width": 1920, "height": 1080 },
  "maxBytes": 41943040,
  "assets": {
    "model": { "type": "models", "query": "rubber duck toy", "coverage": 0.5 },
    "material": { "type": "textures", "query": "wooden floor planks", "coverage": 0.4 },
    "hdri": { "type": "hdris", "query": "studio softbox", "background": true, "blurred": true }
  }
}
```

```bash
node .claude/skills/polyhaven-assets/polyhaven.mjs scene scene.json --out <video-project>
```

Each role (any name; `type` is `models`, `textures` or `hdris`) is resolved by
Poly Haven's `/search` ranking (keyword ranking over names, tags and
categories if search is down), then the first candidate that has the needed
format and fits `maxBytes` (default 40 MB per asset) wins. Role options:

| Key                     | Meaning                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `query`                 | what the scene needs, in words                                       |
| `id`                    | pin an exact asset (skips search)                                    |
| `prefer`, `exclude`     | asset ids to try first / never                                       |
| `coverage`              | fraction of the frame height it fills (texture: one tile); sets size |
| `res`                   | force `1k`, `2k`, `4k`…                                              |
| `background`, `blurred` | HDRI also shown as the backdrop (needs more pixels than lighting)    |
| `displacement`          | also fetch the displacement map                                      |
| `maxBytes`              | per-role budget; smaller resolutions are tried before giving up      |

Resolution: smallest that holds `coverage × output height`; HDRIs 1k for
lighting only, 2× the output height blurred, 4× sharp. Usually 1k–2k.

The result lands in `<video-project>/polyhaven/`: the files, `manifest.json`
(role → id, author, resolution, entry files, md5s) and `CREDITS.md`. Running
`scene` again reuses the picks in `manifest.json` (stable renders); `--refresh`
re-selects. Browse first with
`polyhaven.mjs search textures mossy rock`; fetch one asset with
`polyhaven.mjs get hdris studio_small_09 --res 2k --out <dir> --role hdri`.

## 2. Cache and offline

Downloads are kept by md5 in `~/.cache/hyperframes/polyhaven`
(`POLYHAVEN_CACHE` to move it; `.polyhaven-cache/` is git-ignored if you put it
in the repo) and API answers for a day. A second project using the same asset
copies from the cache with no request. `--offline` (or `POLYHAVEN_OFFLINE=1`)
never touches the network and fails if something is missing. Before a render:

```bash
node .claude/skills/polyhaven-assets/polyhaven.mjs verify <video-project>
```

Never commit downloaded assets to this repo; a video project may keep its own
`polyhaven/` folder.

## 3. Load in the composition

Copy `polyhaven-three.js` next to `index.html`, with three's `build/` and the
`examples/jsm` loaders (`loaders/GLTFLoader.js`, `loaders/HDRLoader.js`,
`utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`) under `lib/three/`
and an import map for `three` and `three/addons/`. Hold the render until the
assets are on the GPU with `window.__hf.buildReady`, registered in the classic
script so it exists before the module runs:

```html
<script>
  // after the root timeline
  window.__hf = window.__hf || {};
  window.__hf.buildReady = window.__hf.buildReady || {};
  window.__hf.buildReady.polyhaven = new Promise((resolve, reject) => {
    window.__polyhavenDone = { resolve, reject };
  });
</script>
<script type="module">
  import * as THREE from "three";
  import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
  import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
  import * as PH from "./polyhaven-three.js";
  // renderer with preserveDrawingBuffer, ACES tone mapping, sRGB output
  HFGsapFrame.addRenderTrack(tl, draw);
  try {
    const manifest = await PH.loadManifest("polyhaven/manifest.json");
    const [, mat, model] = await Promise.all([
      PH.loadHdri({ THREE, HDRLoader, renderer, scene, manifest, blurriness: 0.25 }),
      PH.loadPbrMaterial({ THREE, manifest, repeat: [2, 2] }),
      PH.loadModel({ GLTFLoader, manifest }),
    ]);
    scene.add(PH.fitObject(THREE, model.object, 1.4));
    floor.material = mat.material;
    credit.textContent = PH.creditLine(manifest);
    draw(tl.time(), tl.time() / tl.duration());
    window.__polyhavenDone.resolve();
  } catch (err) {
    window.__polyhavenDone.reject(err); // check and render fail instead of capturing an empty scene
    throw err;
  }
</script>
```

| Helper                                                      | Does                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `loadHdri({… intensity, rotation, background, blurriness})` | PMREM environment lighting, optional backdrop             |
| `loadPbrMaterial({… repeat, displacementScale})`            | `MeshStandardMaterial`; `arm` = AO/rough/metal (glTF ORM) |
| `loadModel({ GLTFLoader, manifest })`                       | glTF scene with its own Poly Haven textures               |
| `fitObject(THREE, obj, size)`                               | scale to `size`, centre, rest on y = 0                    |
| `creditLine(manifest)`                                      | on-screen credit                                          |

Animate camera, object and light from the render track, never a render loop.
PixelFX overlays and GSAP DOM tweens sit on the same root timeline as usual.
A working example: `.github/workflows/fixtures/polyhaven/` (rendered in CI by
`media-deps.yml`).

## In this sandbox

Claude's cloud sandbox may block `api.polyhaven.com` and `dl.polyhaven.org`
(proxy 403). Then fetch on GitHub Actions (the media-deps job does exactly
this with `actions/cache`) or ask for those hosts to be allowed in the cloud
environment's network settings. Do not hand-make substitute assets for a real
video.
