# Vector map recipes

All snippets run inside one `addRenderTrack(tl, (t) => { ... })`. Setup:

```js
const M = HFMap;
const VIEW = { width: 1920, height: 1080 };
const world = HFNaturalEarth["countries-110m"];
const land = world.features.filter((f) => f.id !== "ATA");
const proj = M.createProjection({ type: "equalEarth", ...VIEW, fit: land, padding: 32 });
// Build one <path> per country once, outside the render track:
//   path.setAttribute("d", M.pathD(f, proj.project));
//   path.setAttribute("vector-effect", "non-scaling-stroke");
// Put them in <g id="map" data-layout-allow-overflow>; overlays go in a sibling group.
```

## Camera: zoom, pan and global to regional

```js
const worldCam = { x: VIEW.width / 2, y: VIEW.height / 2, zoom: 1 };
const fra = M.findFeature(world, "FRA");
const regionCam = M.cameraFor(M.bounds(fra, proj.project), VIEW, 0.2);
const flight = M.flyTo(worldCam, regionCam, VIEW);
const ease = gsap.parseEase("power2.inOut");
// in render(t):
const cam = flight(ease(M.local(t, 1, 2.5)));
mapG.setAttribute("transform", M.cameraTransform(cam, VIEW));
const screen = (lngLat) => M.toScreen(cam, VIEW, proj.project(lngLat));
```

Chain beats by flying from the previous camera: `flyTo(regionA, regionB, VIEW)`.
For a pan at constant zoom, interpolate `x` and `y` with the same zoom on both
cameras. France's 110m outline includes French Guiana; frame a region with
`outerRings(fra)[0]` (largest ring) or a hand-picked bounding box when an
overseas part would pull the camera away.

## Country highlight and comparison

```js
const lit = out(M.local(t, 3, 0.8));
target.setAttribute("fill", M.mixColor(BASE, ACCENT, lit));
others.forEach((p) => p.setAttribute("fill-opacity", String(1 - 0.4 * lit)));
```

Comparison: two targets, two fixed colours, one label each anchored at
`feature.properties.label`; reveal side A, then side B, then the number that
compares them (see `data-animation` for exact numbers). Continents or
subregions: filter on `properties.continent` / `properties.subregion` and light
the group together.

## Animated border

```js
const ring = M.outerRings(target)[0].map(proj.project);
// in render(t), screen space so the stroke width stays fixed:
border.setAttribute(
  "d",
  M.partialPath(
    ring.map((pt) => M.toScreen(cam, VIEW, pt)),
    p,
  ).d,
);
```

Draw all rings of a MultiPolygon by running `partialPath` on each with the
same progress. A dashed or pulsing border is a `stroke-dasharray` plus a
stroke-width keyed to `t`, not a CSS animation.

## Pins and labels

```js
const xy = screen([lng, lat]);
const k = M.local(t, start, 0.5);
pin.setAttribute("transform", `translate(${xy[0]} ${xy[1] - 40 * (1 - back(k))})`);
label.setAttribute("opacity", String(out(M.local(t, start + 0.3, 0.4))));
```

Stagger pins by 0.15 to 0.3 s in reading order. Labels sit beside the pin,
never on the route; use `text-anchor="end"` for pins near the right edge.

## Routes and flight paths

```js
const arc = M.greatCircle(from, to, 64).map(proj.project);
const r = M.partialPath(
  arc.map((pt) => M.toScreen(cam, VIEW, pt)),
  ease(M.local(t, 4, 1.6)),
);
route.setAttribute("d", r.d);
plane.setAttribute("transform", `translate(${r.head[0]} ${r.head[1]}) rotate(${r.angle})`);
```

Multi-stop route: concatenate `greatCircle` legs (drop each leg's first point
after the first) and draw with one progress, or one progress per leg for
stop-and-go. A road or rail line is a GeoJSON LineString: project its
coordinates instead of a great circle.

## One `beats` array

```js
const beats = [
  { at: 0, cam: worldCam },
  { at: 1, fly: 2.5, focus: "TUR", pins: [{ name: "Istanbul", at: [28.98, 41.01] }] },
  {
    at: 4,
    route: [
      [28.98, 41.01],
      [-0.13, 51.51],
    ],
    draw: 1.6,
  },
];
```

Derive cameras, pin times, route windows and the composition duration from the
array so a new dataset re-renders without retiming by hand.

## 12 fps stutter

`const s = M.stepTime(t, FPS, 12)` and use `s` for overlay timing only (pins,
labels, highlight, route); keep the camera on `t`. At 30 fps each overlay
value holds 3 frames, at 24 fps 2. Skip it when the piece should feel smooth.

## Gotchas

- `[lng, lat]`, never `[lat, lng]`; `project` throws on a latitude past 90.
- Mercator explodes near the poles: drop `ATA` from `fit`, or use `equalEarth` for world shots.
- The 110m data is for world and continent views. Past about zoom 6 build a 50m or 10m file for the region (`vendor/natural-earth/UPSTREAM.md`).
- Keep `center` at 0 unless no rendered country crosses the new seam; polygons are not cut at the antimeridian.
