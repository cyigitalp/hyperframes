---
name: lemo-opuscar-styles
description: Pick and follow one of the 99 Lemo-Opuscar film styles (CRT terminal, art deco, archive light table, line diagrams, liminal found footage and more) for a HyperFrames film, and use its vendored MIT helpers (CRT/videotape post, Three.js depth of field and bloom, easings, seeded PRNG). Load when a video should look like a named film style or needs CRT or tape post. Fetches one style guide on demand; never commit it.
license: MIT
metadata:
  internal: true
---

# Lemo-Opuscar styles

[Lemo-Opuscar](https://github.com/lemomo-ai/lemo-opuscar) by Lemomo (LemoLab),
pinned at commit `439b98af08b04400f8fd8a8dd19cd773c0c96532` (v2.0.0). Scope,
licences and update steps: `vendor/lemo-opuscar/UPSTREAM.md`.

## 1. Find a style without loading the index

`vendor/lemo-opuscar/styles.jsonl` has one line per style: `slug`, `en`,
`category`, `uses`, `line`, `tech`. Search it, never read it whole:

```bash
grep -i "crt\|terminal" vendor/lemo-opuscar/styles.jsonl
grep '"three-post"' vendor/lemo-opuscar/styles.jsonl | cut -c1-160
```

## 2. Fetch that one style guide, for this film only

The style guides are CC BY-NC 4.0 with an extra permission to follow them for
our own films, commercial ones included, but not to redistribute them. Fetch
one into the gitignored `.lemo/` folder (or the film's own project folder),
read it, and never commit it, paste it into the repo, or ship it in a product:

```bash
SLUG=ascii-crt
mkdir -p .lemo/$SLUG
curl -fsSL "https://raw.githubusercontent.com/lemomo-ai/lemo-opuscar/439b98af08b04400f8fd8a8dd19cd773c0c96532/styles/$SLUG/STYLE.md" -o .lemo/$SLUG/STYLE.md
```

Credit "Style after Lemo-Opuscar by Lemomo (LemoLab)" in the film's credits or
description when you follow a guide.

## 3. Build with our stack, not upstream's renderer

HyperFrames renders; GSAP is the clock (`gsap-hyperframes`). Copy the helpers
you need from `vendor/lemo-opuscar/core/` next to the composition:

| File                 | Use                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `core/post/crt.js`   | `makePost(outCanvas)`, then `post.render(sceneCanvas, glow, frame, subs, overrides)`: WebGL2 CRT/videotape pass over any canvas |
| `core/three/post.js` | `makePost(renderer, scene, camera, w, h, { ssaa, ao })`: GTAO, depth of field, bloom, grade for Three.js                        |
| `core/lib.js`        | easings, springs, envelopes, `mulberry(seed)` PRNG, monotone keyframe tracks                                                    |

Drive each pass from a `HFGsapFrame.addRenderTrack` callback so every seeked
frame redraws once. `.github/workflows/fixtures/lemo-opuscar/index.html` is a
working example (GSAP + Three.js + PixelFX + CRT post).
