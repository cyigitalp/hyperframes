# Globe and effects

## Three.js globe from the same data

Draw the countries into a canvas with the `equirectangular` projection, then
use the canvas as the texture of a sphere. One draw before the timeline, no
tiles.

```js
const W = 4096,
  H = 2048;
const proj = HFMap.createProjection({
  type: "equirectangular",
  width: W,
  height: H,
  fit: {
    type: "MultiPoint",
    coordinates: [
      [-180, -90],
      [180, 90],
    ],
  },
});
const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#0a1420";
ctx.fillRect(0, 0, W, H);
for (const f of world.features) {
  ctx.fillStyle = f.id === "TUR" ? "#e0892b" : "#243447";
  ctx.fill(new Path2D(HFMap.pathD(f, proj.project)));
}
const tex = new THREE.CanvasTexture(canvas);
tex.colorSpace = THREE.SRGBColorSpace;
const globe = new THREE.Mesh(
  new THREE.SphereGeometry(1, 128, 64),
  new THREE.MeshBasicMaterial({ map: tex }),
);
```

With the default SphereGeometry UVs a `[lng, lat]` (radians) sits at
`x = cos(lat) * cos(lng)`, `y = sin(lat)`, `z = -cos(lat) * sin(lng)`, so
longitude 0 faces +X; `globe.rotation.y = -Math.PI / 2` turns it to a camera
on +Z. Parent pins and arcs to the globe and check one known city on a still.
Animate the rotation and
camera distance from the render track and call `renderer.render` there, as in
`gsap-hyperframes`. To go from globe to flat map, cross-fade to the SVG map at
the moment the globe camera matches `cameraFor` of the region.

## Accents

- Arrival burst on a pin: a PixelFX effect seeked by `pixelfx-frame.js`, placed at `toScreen` of the pin, starting when the pin lands.
- Look and post: a Lemo-Opuscar style (`lemo-opuscar-styles`) such as CRT or archive light table over the map, keeping labels legible.
- Numbers on the map (population, distance, share): `data-animation` (`data-frame.js`) for exact counts and formatting.
