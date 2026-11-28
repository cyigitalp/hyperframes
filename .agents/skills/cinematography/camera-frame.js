// camera-frame.js: a deterministic 2.5D multiplane camera for HyperFrames.
// ES module, no dependencies, no clock, DOM touched only by applyLayers().
// Every value is a pure function of the seeked time, so any seek order lands
// on the same frame.
//
// Model: each layer is authored full-frame as it looks with the camera at
// rest, and sits `depth` px in front of the camera. The rest focal length is
// `focal` px: a layer at depth === focal is the subject plane and moves 1:1
// with a lateral camera move; farther layers move less, nearer ones more.
// Dolly (z) changes perspective and parallax; zoom changes the lens only.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;

export const EASES = {
  none: (p) => p,
  linear: (p) => p,
  "sine.inOut": (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  "sine.out": (p) => Math.sin((Math.PI * p) / 2),
  "sine.in": (p) => 1 - Math.cos((Math.PI * p) / 2),
  "power2.inOut": (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
  "power2.out": (p) => 1 - (1 - p) ** 2,
  "power2.in": (p) => p * p,
  "power3.inOut": (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  "power3.out": (p) => 1 - (1 - p) ** 3,
  "power4.out": (p) => 1 - (1 - p) ** 4,
  "power4.in": (p) => p ** 4,
  "expo.out": (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  "expo.inOut": (p) =>
    p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2,
  "back.out": (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};

/** An ease from a name, a function (e.g. gsap.parseEase(...)) or undefined. */
export function easeFn(e) {
  if (typeof e === "function") return e;
  if (e == null) return EASES["sine.inOut"];
  const f = EASES[e];
  if (!f)
    throw new Error(
      `unknown ease "${e}" (have ${Object.keys(EASES).join(", ")}; or pass a function)`,
    );
  return f;
}

export const CAMERA_KEYS = ["x", "y", "z", "zoom", "roll", "pan", "tilt", "focus", "aperture"];
export const REST = Object.freeze({
  x: 0, // truck right (+) / left, world px at the subject plane
  y: 0, // pedestal down (+) / up
  z: 0, // dolly in (+) / out
  zoom: 1, // lens zoom: uniform scale, no parallax change
  roll: 0, // degrees
  pan: 0, // screen px, all depths equally (rotation, no parallax)
  tilt: 0,
  focus: null, // world depth in focus; null = everything sharp
  aperture: 0, // blur px per unit of defocus; 0 = pinhole
});

/**
 * Camera track from keyframes: [{ t, ...camera keys, ease }]. A key's `ease`
 * shapes the move that arrives at it. Properties a key leaves out carry over
 * from the previous key. Before the first key and after the last the camera
 * holds. Returns a function camAt(t) -> full camera.
 */
export function cameraTrack(keys) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("cameraTrack needs keys");
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const full = [];
  let prev = { ...REST };
  for (const k of sorted) {
    if (!Number.isFinite(k.t)) throw new Error("every camera key needs a numeric t");
    const c = { ...prev };
    for (const key of CAMERA_KEYS) if (k[key] !== undefined) c[key] = k[key];
    full.push({ t: k.t, cam: c, ease: easeFn(k.ease) });
    prev = c;
  }
  const at = (t) => {
    if (t <= full[0].t) return { ...full[0].cam };
    const end = full[full.length - 1];
    if (t >= end.t) return { ...end.cam };
    let i = 1;
    while (full[i].t < t) i++;
    const a = full[i - 1];
    const b = full[i];
    const p = b.ease(clamp((t - a.t) / (b.t - a.t || 1), 0, 1));
    const out = {};
    for (const key of CAMERA_KEYS) {
      const va = a.cam[key];
      const vb = b.cam[key];
      if (va == null || vb == null) out[key] = p < 0.5 ? va : vb;
      else out[key] = lerp(va, vb, p);
    }
    return out;
  };
  at.keys = full.map((k) => ({ t: k.t, ...k.cam }));
  at.start = full[0].t;
  at.end = full[full.length - 1].t;
  return at;
}

/** Velocity of a camera track at t (units per second), by central difference. */
export function velocityAt(track, t, h = 1 / 240) {
  const a = track(t - h);
  const b = track(t + h);
  const v = {};
  for (const k of ["x", "y", "z", "zoom", "roll", "pan", "tilt"]) v[k] = (b[k] - a[k]) / (2 * h);
  return v;
}

/**
 * Screen transform of one layer under a camera. Returns { x, y, scale,
 * rotate, blur, visible } for a full-frame layer scaled about the stage
 * centre. `fixed` layers (HUD, captions) ignore the camera.
 */
export function project(layer, cam, { focal = 1000, maxBlur = 24 } = {}) {
  if (layer.fixed) return { x: 0, y: 0, scale: 1, rotate: 0, blur: 0, visible: true };
  const depth = layer.depth ?? focal;
  const d = depth - (cam.z ?? 0); // distance from the camera now
  if (d <= 1) return { x: 0, y: 0, scale: 0, rotate: 0, blur: 0, visible: false }; // passed through
  const zoom = cam.zoom ?? 1;
  const scale = (zoom * depth) / d;
  const k = (zoom * focal) / d; // screen px per world px at this depth
  const x = -(cam.x ?? 0) * k - (cam.pan ?? 0) + (layer.x ?? 0) * scale;
  const y = -(cam.y ?? 0) * k - (cam.tilt ?? 0) + (layer.y ?? 0) * scale;
  let blur = 0;
  if (cam.focus != null && cam.aperture > 0) {
    const fd = cam.focus - (cam.z ?? 0);
    if (fd > 1) blur = Math.min(maxBlur, cam.aperture * focal * Math.abs(1 / fd - 1 / d));
  }
  return { x, y, scale, rotate: cam.roll ?? 0, blur, visible: true };
}

/** CSS transform string for project(); the origin must be the stage centre. */
export function toCss(p) {
  return `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) rotate(${p.rotate.toFixed(3)}deg) scale(${p.scale.toFixed(5)})`;
}

/**
 * Atmospheric perspective: far layers lose contrast and saturation and take
 * the haze colour. Returns CSS filter parts; 0 at `near`, `amount` at `far`.
 */
export function atmosphere(depth, { near = 800, far = 6000, amount = 0.5 } = {}) {
  const h = clamp((depth - near) / (far - near), 0, 1) * amount;
  return {
    haze: h,
    filter: `saturate(${(1 - 0.6 * h).toFixed(3)}) contrast(${(1 - 0.45 * h).toFixed(3)}) brightness(${(1 + 0.15 * h).toFixed(3)})`,
  };
}

/**
 * Apply a camera to DOM layers: [{ el, depth, fixed, x, y, atmosphere: {...},
 * filter: "extra css filter" }]. Sets transform, filter and visibility. Every
 * layer scales about the stage centre, whatever its own box, so layers may be
 * oversized or offset (opts.width / height = stage size, default the
 * element's offsetParent).
 */
export function applyLayers(layers, cam, opts = {}) {
  for (const L of layers) {
    const p = project(L, cam, opts);
    const s = L.el.style;
    const par = L.el.offsetParent;
    const W = opts.width ?? par?.clientWidth;
    const H = opts.height ?? par?.clientHeight;
    s.transformOrigin =
      W && H ? `${W / 2 - (L.el.offsetLeft ?? 0)}px ${H / 2 - (L.el.offsetTop ?? 0)}px` : "50% 50%";
    s.transform = toCss(p);
    s.visibility = p.visible ? "visible" : "hidden";
    // keep the filter the layer was authored with (colour grade, tint)
    if (L.baseFilter === undefined) {
      const f = typeof getComputedStyle === "function" ? getComputedStyle(L.el).filter : s.filter;
      L.baseFilter = f && f !== "none" ? f : "";
    }
    const parts = [];
    if (L.baseFilter) parts.push(L.baseFilter);
    if (L.filter) parts.push(L.filter);
    if (L.atmosphere) parts.push(atmosphere(L.depth ?? opts.focal ?? 1000, L.atmosphere).filter);
    if (p.blur > 0.05) parts.push(`blur(${p.blur.toFixed(2)}px)`);
    s.filter = parts.join(" ") || "none";
  }
}

/** Smooth seeded noise in [-1, 1] as a pure function of t (sum of sines). */
export function noise1(seed, t) {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  let v = 0;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    const f = 0.6 + i * 0.83 + rnd() * 0.4;
    const ph = rnd() * Math.PI * 2;
    const w = 1 / (i + 1);
    v += Math.sin(t * f * Math.PI * 2 + ph) * w;
    norm += w;
  }
  return v / norm;
}

/**
 * Deterministic handheld offset to add to a camera: { x, y, roll }. `amp` in
 * px, `freq` scales the noise speed. Use sparingly and only when motivated
 * (found footage, an impact, a nervous POV).
 */
export function handheld(t, { seed = 1, amp = 6, freq = 1, roll = 0.25, envelope = 1 } = {}) {
  const e = typeof envelope === "function" ? envelope(t) : envelope;
  return {
    x: noise1(seed, t * freq) * amp * e,
    y: noise1(seed + 101, t * freq) * amp * 0.7 * e,
    roll: noise1(seed + 202, t * freq * 0.7) * roll * e,
  };
}

/** Add offsets to a camera (handheld, a punch, a shake). */
export function addCam(cam, ...offsets) {
  const out = { ...cam };
  for (const o of offsets)
    for (const k of Object.keys(o))
      if (typeof o[k] === "number" && typeof out[k] === "number") out[k] += o[k];
  return out;
}

/** Decaying impact shake from time t0 (a hit, a slam, a landing). */
export function impact(t, t0, { amp = 18, decay = 6, freq = 14, seed = 3 } = {}) {
  const u = t - t0;
  if (u < 0 || u > 2) return { x: 0, y: 0, roll: 0 };
  const e = Math.exp(-decay * u);
  return {
    x: noise1(seed, u * freq) * amp * e,
    y: noise1(seed + 7, u * freq) * amp * e,
    roll: noise1(seed + 9, u * freq) * amp * 0.04 * e,
  };
}

// ---- Shot grammar --------------------------------------------------------
// Each returns camera keys; join them with sequence(). Depths are layer
// depths in px (the subject plane is `focal`).

export const SHOT_SIZES = {
  // subject height as a fraction of frame height
  "extreme-wide": 0.12,
  wide: 0.3,
  full: 0.75,
  medium: 1.1,
  "close-up": 2.0,
  "extreme-close-up": 4.0,
};

/**
 * Camera z that makes a subject at `depth`, `height` px tall at rest, fill
 * `size` (a SHOT_SIZES name or fraction of frame height `frameH`).
 */
export function zForShot(size, { depth, height, frameH = 1080, zoom = 1 }) {
  const frac = typeof size === "string" ? SHOT_SIZES[size] : size;
  if (!frac) throw new Error(`unknown shot size ${size}`);
  const scale = (frac * frameH) / height; // wanted scale relative to rest
  return depth - (zoom * depth) / scale;
}

/**
 * Camera x/y that puts a world point (rest-screen coords relative to centre,
 * at `depth`) on a target screen point, e.g. a thirds intersection.
 */
export function aimAt({ px, py, depth }, { sx = 0, sy = 0, z = 0, zoom = 1, focal = 1000 }) {
  const d = depth - z;
  const scale = (zoom * depth) / d;
  const k = (zoom * focal) / d;
  return { x: (px * scale - sx) / k, y: (py * scale - sy) / k };
}

/** Thirds intersections relative to the frame centre. */
export function thirds(w = 1920, h = 1080) {
  const xs = [-w / 6, w / 6];
  const ys = [-h / 6, h / 6];
  return {
    upperLeft: { sx: xs[0], sy: ys[0] },
    upperRight: { sx: xs[1], sy: ys[0] },
    lowerLeft: { sx: xs[0], sy: ys[1] },
    lowerRight: { sx: xs[1], sy: ys[1] },
    center: { sx: 0, sy: 0 },
  };
}

export const shots = {
  /** Wide establishing drift: starts pulled back and high, settles. */
  establish({ t0, t1, from = {}, to = {}, ease = "sine.inOut" }) {
    return [
      { t: t0, z: -260, y: -40, ...from },
      { t: t1, z: 0, y: 0, ...to, ease },
    ];
  },
  /** Push in toward the subject (dolly), ending on a beat at t1. */
  pushIn({ t0, t1, z = 220, ease = "power2.inOut", ...rest }) {
    return [{ t: t0 }, { t: t1, z, ease, ...rest }];
  },
  /** Pull out to reveal context. */
  pullOut({ t0, t1, z = -320, ease = "power3.out", ...rest }) {
    return [{ t: t0 }, { t: t1, z, ease, ...rest }];
  },
  /** Lateral tracking move with parallax (truck). */
  track({ t0, t1, x = 240, ease = "sine.inOut", ...rest }) {
    return [{ t: t0 }, { t: t1, x, ease, ...rest }];
  },
  /** Crane / pedestal move. */
  crane({ t0, t1, y = -200, ease = "sine.inOut", ...rest }) {
    return [{ t: t0 }, { t: t1, y, ease, ...rest }];
  },
  /** Pull focus from one depth to another over `dur`, ending at t + dur. */
  rackFocus({ t, dur = 0.6, from, to, aperture = 0.9, ease = "power2.inOut" }) {
    return [
      { t, focus: from, aperture },
      { t: t + dur, focus: to, aperture, ease },
    ];
  },
  /**
   * Dolly zoom (vertigo): dolly by dz while the lens compensates so the
   * subject at `depth` keeps its size; the background stretches or squeezes.
   */
  dollyZoom({ t0, t1, depth, dz = 300, ease = "power2.inOut", steps = 12 }) {
    const keys = [];
    for (let i = 0; i <= steps; i++) {
      const p = easeFn(ease)(i / steps);
      const z = dz * p;
      keys.push({ t: lerp(t0, t1, i / steps), z, zoom: (depth - z) / depth, ease: "none" });
    }
    return keys;
  },
  /** Comedic punch-in on a beat: fast in, tiny overshoot, holds. */
  punchIn({ t, amount = 0.18, dur = 0.16 }) {
    return [
      { t, zoom: 1 },
      { t: t + dur, zoom: 1 + amount, ease: "back.out" },
    ];
  },
  /** Whip pan: very fast pan that motion blur and a cut can hide. */
  whipPan({ t, dur = 0.22, pan = 1800, ease = "expo.inOut" }) {
    return [
      { t, pan: 0 },
      { t: t + dur, pan, ease },
    ];
  },
  /** Locked-off: an explicit hold. Stillness is a choice, record it. */
  lock({ t0, t1 }) {
    return [{ t: t0 }, { t: t1, ease: "none" }];
  },
};

/** Merge shot key lists into one track's keys (later keys win on equal t). */
export function sequence(...lists) {
  const byT = new Map();
  for (const k of lists.flat()) byT.set(k.t, { ...(byT.get(k.t) ?? {}), ...k });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Start time of the n-th occurrence of a word in narration timings. */
export function atWord(words, text, n = 1) {
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}$%]+/gu, "");
  const want = norm(text);
  let seen = 0;
  for (const w of words) {
    const [word, start] = Array.isArray(w) ? w : [w.word ?? w.text, w.start];
    if (norm(word) === want && ++seen === n) return start;
  }
  throw new Error(`word "${text}" (#${n}) not in narration timings`);
}

/**
 * Seam continuity between two scenes' camera tracks: compares the outgoing
 * velocity of `a` at tA with the incoming velocity of `b` at tB. A cut that
 * should feel like one move wants a small mismatch (motion-doctrine's vector
 * law). Returns { mismatch, a, b } with velocities in units per second.
 */
export function seamContinuity(a, tA, b, tB) {
  const va = velocityAt(a, tA - 1 / 120);
  const vb = velocityAt(b, tB + 1 / 120);
  const keys = ["x", "y", "z", "pan", "tilt"];
  const mag = (v) => Math.hypot(...keys.map((k) => v[k]));
  const diff = Math.hypot(...keys.map((k) => va[k] - vb[k]));
  return { mismatch: diff / Math.max(1, mag(va), mag(vb)), a: va, b: vb };
}

/**
 * Sync a Three.js PerspectiveCamera to the same camera, so DOM layers and a
 * WebGL layer share one move. World units: 1 px at the subject plane = 1 unit
 * divided by `unit` (default 100 px per unit). Returns the focus distance in
 * world units for a depth-of-field pass.
 */
export function syncThreeCamera(camera, cam, { focal = 1000, height = 1080, unit = 100 } = {}) {
  const zoom = cam.zoom ?? 1;
  camera.fov = (2 * Math.atan(height / 2 / (focal * zoom)) * 180) / Math.PI;
  camera.position.set(
    (cam.x + (cam.pan ?? 0)) / unit,
    -(cam.y + (cam.tilt ?? 0)) / unit,
    (focal - (cam.z ?? 0)) / unit,
  );
  camera.rotation.set(0, 0, ((cam.roll ?? 0) * Math.PI) / 180);
  camera.updateProjectionMatrix();
  return cam.focus == null ? null : (cam.focus - (cam.z ?? 0)) / unit;
}
