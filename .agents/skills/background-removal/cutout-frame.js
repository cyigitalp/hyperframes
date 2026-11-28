// cutout-frame.js: place and animate background-removed cutouts in HyperFrames.
// ES module, no dependencies, no clock or network beyond loading the manifest,
// so every function is deterministic under the seek-by-frame renderer.
//
// The manifest comes from `cutout.sh run ... --out <project>` and lives at
// <project>/cutouts/manifest.json. Each item has the source size, the subject
// bbox, the trimmed sprite rect, the alpha centroid and the foot point.

/** Fetch cutouts/manifest.json and index its items by name. */
export async function loadCutouts(url = "cutouts/manifest.json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cutouts manifest ${url}: HTTP ${res.status}`);
  return indexManifest(await res.json(), url.replace(/[^/]*$/, ""));
}

/** Index a parsed manifest. `base` is the folder the file paths are relative to. */
export function indexManifest(manifest, base = "cutouts/") {
  const byName = new Map(manifest.items.map((it) => [it.name, it]));
  return {
    manifest,
    base,
    names: [...byName.keys()],
    get(name) {
      const it = byName.get(name);
      if (!it)
        throw new Error(`no cutout named "${name}" (have: ${[...byName.keys()].join(", ")})`);
      return it;
    },
    /** URL of one output: "trim" (sprite), "cutout" (full frame), "mask", "plate". */
    url(name, kind = "trim") {
      const f = this.get(name).files[kind];
      if (!f) throw new Error(`cutout "${name}" has no ${kind} file`);
      return base + f.path;
    },
  };
}

/** Anchor point of an item in source pixels: "foot", "centroid" or "center". */
export function anchorOf(item, anchor = "foot") {
  if (anchor === "foot") return { x: item.foot[0], y: item.foot[1] };
  if (anchor === "centroid") return { x: item.centroid[0], y: item.centroid[1] };
  if (anchor === "center") {
    const [x0, y0, x1, y1] = item.bbox;
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  throw new Error(`unknown anchor ${anchor}`);
}

/**
 * Stage rect for the trimmed sprite so that its anchor lands on (x, y) and the
 * subject (bbox, not the padded sprite) is `height` (or `width`) pixels tall.
 * Returns { left, top, width, height, scale, origin } in stage pixels; origin
 * is the anchor inside the rect, for a CSS transform-origin.
 */
export function fitSprite(item, { x, y, height, width, anchor = "foot" }) {
  const [x0, y0, x1, y1] = item.bbox;
  const scale = height != null ? height / (y1 - y0) : width != null ? width / (x1 - x0) : 1;
  const a = anchorOf(item, anchor);
  const t = item.trim;
  const ox = (a.x - t.x) * scale;
  const oy = (a.y - t.y) * scale;
  return {
    left: x - ox,
    top: y - oy,
    width: t.width * scale,
    height: t.height * scale,
    scale,
    origin: { x: ox, y: oy },
  };
}

/** Position an <img> (or any element) at a fitSprite rect. */
export function placeElement(el, rect) {
  Object.assign(el.style, {
    position: "absolute",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transformOrigin: `${rect.origin.x}px ${rect.origin.y}px`,
  });
  return el;
}

/**
 * Parallax for one layer under a 2D camera. depth 0 = locked to the screen
 * (sky), 1 = moves with the camera (the subject plane), above 1 = foreground.
 * cam = { x, y, zoom } in stage pixels; returns a CSS-ready { x, y, scale }.
 */
export function parallax(depth, cam) {
  const zoom = cam.zoom ?? 1;
  return {
    x: -(cam.x ?? 0) * depth,
    y: -(cam.y ?? 0) * depth,
    scale: 1 + (zoom - 1) * depth,
  };
}

/** CSS transform string for parallax(depth, cam), plus optional extra offsets. */
export function parallaxTransform(depth, cam, extra = {}) {
  const p = parallax(depth, cam);
  const x = p.x + (extra.x ?? 0);
  const y = p.y + (extra.y ?? 0);
  const s = p.scale * (extra.scale ?? 1);
  const r = extra.rotate ?? 0;
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)}) rotate(${r.toFixed(2)}deg)`;
}

/** Linear interpolation of two cameras at progress p (ease it yourself). */
export function lerpCam(a, b, p) {
  const l = (k, d) => (a[k] ?? d) + ((b[k] ?? d) - (a[k] ?? d)) * p;
  return { x: l("x", 0), y: l("y", 0), zoom: l("zoom", 1) };
}

/**
 * Three.js plane for a cutout texture, sized so the subject is `height` world
 * units tall, with the anchor at the mesh origin (foot on the floor by default).
 * Pass the texture you loaded (TextureLoader) from manifest.url(name, "trim").
 */
export function cutoutPlane(THREE, texture, item, { height = 1, anchor = "foot" } = {}) {
  const r = fitSprite(item, { x: 0, y: 0, height, anchor });
  const geo = new THREE.PlaneGeometry(r.width, r.height);
  // Plane is centred; move it so the anchor sits at (0, 0). Stage y is down.
  geo.translate(r.left + r.width / 2, -(r.top + r.height / 2), 0);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

/** Stage point of an item's anchor inside a placed rect (e.g. to aim a pixelfx burst at the feet). */
export function anchorOnStage(item, rect, anchor = "foot") {
  const a = anchorOf(item, anchor);
  return {
    x: rect.left + (a.x - item.trim.x) * rect.scale,
    y: rect.top + (a.y - item.trim.y) * rect.scale,
  };
}

/** Resolve once every <img> passed in has decoded (use before the first render). */
export function imagesReady(imgs) {
  return Promise.all(imgs.map((img) => (img.decode ? img.decode() : Promise.resolve())));
}
