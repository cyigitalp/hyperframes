---
name: map-animation
description: Editorial map motion for HyperFrames with real geography on every frame. Load when a video needs an animated world map, a country or region highlight, a geographic comparison, an animated border, location pins and labels, a route or flight path, or a camera zoom and pan between global and regional views. Ships map-frame.js (projections, country paths, great-circle routes, smooth fly-to camera) and Natural Earth country data (public domain). Adapted from iart-ai/map-animation-skills (MIT).
license: MIT
metadata:
  internal: true
---

# Map animation in HyperFrames

Adapted from [iart-ai/map-animation-skills](https://github.com/iart-ai/map-animation-skills)
(MIT, see `UPSTREAM.md`). Upstream renders vector maps in Remotion or composites
Google Earth Studio footage in After Effects. Here the map is SVG drawn from
Natural Earth data and the clock is the seeked GSAP root timeline
(`gsap-hyperframes`). No map tiles, no map API, no D3, no Earth Studio.

## The rule

Every map value is a pure function of the seeked time. Put one
`HFGsapFrame.addRenderTrack(tl, render)` on the root timeline and set the
camera, fills, borders, pins and routes inside `render(t)` with `map-frame.js`.
Load the country data with a `<script>` tag before the timeline is built; never
fetch tiles or GeoJSON at render time.

## Files

Copy next to `index.html`, after GSAP and `gsap-frame.js`:

```html
<script src="map-frame.js"></script>
<script src="countries-110m.js"></script>
<!-- from vendor/natural-earth/ -->
```

`countries-110m.js` sets `HFNaturalEarth["countries-110m"]`: 177 countries,
id = ISO A3 (`TUR`, `GBR`, `FRA`...), `properties` = `name`, `iso_a3`,
`continent`, `subregion`, `label` ([lng, lat] label point). For a closer zoom or
admin-1 regions, build another file from Natural Earth with
`vendor/natural-earth/build.mjs` (see its `UPSTREAM.md`) and commit it to the
video project, not to this repo.

## map-frame.js (globalThis.HFMap)

Coordinates are always `[lng, lat]`. Tested in `map-frame.test.mjs`.

| Need                                 | Call                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projection fitted to the frame       | `createProjection({ type: "mercator" \| "equalEarth" \| "equirectangular", width, height, fit, padding, center })`, then `p.project([lng, lat])` |
| Country path                         | `pathD(feature, p.project)`; `findFeature(world, "TUR" \| "Turkey")`                                                                             |
| Camera on a region                   | `cameraFor(bounds(features, p.project), view, 0.15)` gives `{ x, y, zoom }`                                                                      |
| Global to regional flight            | `flyTo(camA, camB, view)(p)` (pulls out on long moves, lands exactly)                                                                            |
| Apply the camera                     | `<g transform>` = `cameraTransform(cam, view)`; paths get `vector-effect="non-scaling-stroke"`                                                   |
| Pins and labels upright and unscaled | `toScreen(cam, view, p.project(lngLat))`                                                                                                         |
| Route or flight path                 | `greatCircle(a, b, 64).map(p.project)`, map to screen, `partialPath(pts, progress)` gives `d`, `head`, `angle`                                   |
| Animated border                      | `partialPath(outerRings(feature)[0].map(project).map(toScreen), progress)`                                                                       |
| Highlight                            | `mixColor(base, accent, progress)` on the target, `fill-opacity` down on the rest                                                                |
| Distance label                       | `distanceKm(a, b)`                                                                                                                               |
| Timing                               | `local(t, start, duration)` eased with `gsap.parseEase`; `stepTime(t, fps, 12)` for the 12 fps overlay stutter                                   |

The working example is `.github/workflows/fixtures/map-animation/index.html`
(camera zoom, country highlight with border draw-on, pins, great-circle route),
rendered by the `Media deps` workflow.

## Craft checklist

- Projection: `equalEarth` for world views and area comparisons, `mercator` for regional zooms (drop `ATA` from `fit`). One projection for the whole film; the camera moves, the projection does not.
- Camera: slow and eased, 1.5 to 3 s per flight; establish the world, then go in. Keep the camera smooth on every frame; step only the overlays (`stepTime`) if the piece wants the editorial 12 fps cadence.
- Focus and context: light one target, dim the rest to about 60 %, never recolour a meaning mid-piece. For a comparison give each side one colour and one label.
- Order: highlight, then pins, then labels, then the route, in reading order; hold the final state 1.5 s or more.
- Labels stay horizontal and inside the safe area, at least 19 px at 720p, with a dark halo (`paint-order: stroke`). Pins and labels live outside the zoomed group so they do not scale.
- Accuracy: check every pin against a known city on a still; a label in the wrong place reads as an error. Borders follow Natural Earth's de facto lines; state that in the source line when a border is disputed.
- Source line on screen: "Map data: Natural Earth (public domain)".
- Render stills at the first frame, mid flight and the last frame (`npx hyperframes snapshot`) before the full render; `npx hyperframes lint` and `check` must pass.

## References

- `references/vector-maps.md`: recipes for highlights, comparisons, borders, pins, routes, fly-to sequences driven by one `beats` array, and the 12 fps stutter.
- `references/globe-and-effects.md`: a Three.js globe from the same data, and PixelFX or GSAP accents on arrivals.

Do not add a map library, a tile service or a paid API for motion. The
registry has map blocks (`world-map`, `us-map`, `us-map-flow`, `spain-map`,
`nyc-paris-flight`); `world-map` and the `us-map` family load D3 and
world-atlas from a CDN, so for an offline render swap that for
`countries-110m.js` and `map-frame.js` rather than adding the CDN scripts.
