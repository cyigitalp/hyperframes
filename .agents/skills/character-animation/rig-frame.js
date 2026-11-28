// rig-frame.js: layered 2D character rigs for HyperFrames.
// ES module, no dependencies, no clock. A rig is a list of parts (SVG art or
// photo cut-out pieces) with joint pivots and parents; animation is a stack of
// preset clips evaluated as a pure function of time, so every seek order lands
// on the same pose. DOM is touched only by mountRig() and its apply().
//
//   const rig = createRig(spec, { place: { x: 600, y: 980, scale: 0.9 } });
//   rig.add(walk({ start: 0.2, steps: 4, dir: 1 }));
//   rig.add(blink({ start: 0, end: 6, seed: 3 }));
//   const view = mountRig(svgElement, rig);
//   HFGsapFrame.addRenderTrack(tl, (t) => view.apply(t));

// ---- maths -----------------------------------------------------------------

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;

/** 2D affine matrix [a, b, c, d, e, f] (SVG order). */
export const M = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  t: (x, y) => [1, 0, 0, 1, x, y],
  r: (deg) => {
    const c = Math.cos(deg * DEG);
    const s = Math.sin(deg * DEG);
    return [c, s, -s, c, 0, 0];
  },
  s: (x, y) => [x, 0, 0, y, 0, 0],
  apply: (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  inv: (m) => {
    const det = m[0] * m[3] - m[1] * m[2];
    return [
      m[3] / det,
      -m[1] / det,
      -m[2] / det,
      m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det,
      (m[1] * m[4] - m[0] * m[5]) / det,
    ];
  },
  angle: (m) => Math.atan2(m[1], m[0]) / DEG,
  css: (m) => `matrix(${m.map((v) => +v.toFixed(5)).join(",")})`,
};

export const EASE = {
  linear: (p) => p,
  in: (p) => p * p,
  out: (p) => 1 - (1 - p) ** 2,
  inOut: (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
  out3: (p) => 1 - (1 - p) ** 3,
  in3: (p) => p ** 3,
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  elastic: (p) =>
    p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  sine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
};

/**
 * Piecewise curve: keys [[time, value, ease?], ...] sorted by time. The ease
 * names the move that arrives at that key. Holds before the first and after
 * the last key.
 */
export function curve(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (u <= t1) {
      const [t0, v0] = keys[i - 1];
      const f = typeof e === "function" ? e : EASE[e ?? "inOut"];
      return lerp(v0, v1, f(clamp((u - t0) / (t1 - t0 || 1), 0, 1)));
    }
  }
  return keys[keys.length - 1][1];
}

/** Seeded PRNG (mulberry32), same as HFGsapFrame.seededRandom. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two-bone IK: angles (deg, world) of bone 1 and bone 2 reaching target from root. */
export function solveTwoBone(root, target, l1, l2, bend = 1) {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const base = Math.atan2(dy, dx);
  const a1 = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const a2 = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  const ang1 = base - bend * a1;
  const ang2 = ang1 + bend * (Math.PI - a2);
  return { a1: ang1 / DEG, a2: ang2 / DEG, reach: Math.hypot(dx, dy) <= l1 + l2 };
}

// ---- rig -------------------------------------------------------------------

const ZERO = () => ({ r: 0, x: 0, y: 0, sx: 1, sy: 1, o: 1, v: null, vp: -1 });

/**
 * Create a rig. spec = { size: [w, h], ground: [x, y], parts: [{ id, parent,
 * pivot: [x, y], z, art, variants, rest, role }], roles: { name: partId },
 * ranges: { pupil: px }, limbs: { armL: [upper, fore, hand], ... } }.
 * Part art is drawn in one shared canvas, like layers of a PSD; the pivot is
 * the joint in that canvas. opts.place = { x, y, scale, facing } puts the
 * spec's ground point on the stage.
 */
export function createRig(spec, opts = {}) {
  const parts = new Map(spec.parts.map((p) => [p.id, p]));
  for (const p of spec.parts) {
    if (p.parent && !parts.has(p.parent))
      throw new Error(`part ${p.id}: unknown parent ${p.parent}`);
    if (!Array.isArray(p.pivot)) throw new Error(`part ${p.id}: pivot [x, y] required`);
  }
  // parents before children
  const order = [];
  const seen = new Set();
  const visit = (p) => {
    if (seen.has(p.id)) return;
    if (p.parent) visit(parts.get(p.parent));
    seen.add(p.id);
    order.push(p);
  };
  spec.parts.forEach(visit);

  const roles = { ...(spec.roles ?? {}) };
  for (const p of spec.parts) if (!roles[p.id]) roles[p.id] = p.id;
  const clips = [];
  const followers = [];
  const place = { x: 0, y: 0, scale: 1, facing: 1, ...(opts.place ?? {}) };
  const ground = spec.ground ?? [spec.size[0] / 2, spec.size[1]];

  const rig = {
    spec,
    parts,
    order,
    roles,
    clips,
    place,
    ground,
    ranges: { pupil: 7, ...(spec.ranges ?? {}) },
    /** Part id for a role (or the id itself); undefined when the rig lacks it. */
    part(role) {
      const id = roles[role];
      return id && parts.has(id) ? id : undefined;
    },
    /** Add one clip (or an array of clips) from a preset. Returns the rig. */
    add(c) {
      for (const x of [c].flat()) clips.push({ seq: clips.length, priority: 0, fade: 0.12, ...x });
      return rig;
    },
    /** Secondary motion: `role` lags behind `driver` like hair, a tail or an antenna. */
    follow(role, driver, o = {}) {
      followers.push({ role, driver, freq: 2.2, damping: 0.35, gain: 1, inertia: 0.06, ...o });
      return rig;
    },
    /** Root travel (stage px) and facing at time t. */
    travel(t) {
      let x = 0;
      let y = 0;
      let facing = place.facing;
      for (const c of clips) {
        if (!c.travel) continue;
        const u = clamp(t - c.start, 0, c.end - c.start);
        if (t < c.start) continue;
        const tr = c.travel(u, rig);
        x += tr.x ?? 0;
        y += tr.y ?? 0;
        if (tr.facing) facing = tr.facing;
      }
      return { x, y, facing };
    },
    /** Pose (local channels per part id) at time t, before secondary motion. */
    basePose(t) {
      const pose = {};
      for (const p of order) pose[p.id] = { ...ZERO(), ...(p.rest ?? {}) };
      const active = activeClips(clips, t);
      for (const { clip, w } of active) {
        if (!clip.fn) continue;
        const out = clip.fn(t - clip.start, rig, t) ?? {};
        for (const [role, ch] of Object.entries(out)) {
          const id = rig.part(role);
          if (!id) continue;
          mix(pose[id], ch, w, clip.priority + clip.seq * 1e-6);
        }
      }
      for (const p of order)
        for (const [ch, [lo, hi]] of Object.entries(p.limits ?? {}))
          pose[p.id][ch] = clamp(pose[p.id][ch], lo, hi);
      for (const { clip, w } of active) if (clip.post) clip.post(t - clip.start, rig, pose, w, t);
      return pose;
    },
    /** Full pose at t including secondary motion. */
    pose(t) {
      const pose = rig.basePose(t);
      for (const f of followers) applyFollow(rig, f, pose, t);
      return pose;
    },
    /** Stage matrix of the rig canvas at time t (placement + travel). */
    rootMatrix(t) {
      const tr = rig.travel(t);
      const s = place.scale;
      return M.mul(
        M.mul(M.t(place.x + tr.x, place.y + tr.y), M.s(s * tr.facing, s)),
        M.t(-ground[0], -ground[1]),
      );
    },
    /** World (stage) matrices for every part at t. */
    matrices(t, pose = rig.pose(t)) {
      const out = {};
      const root = rig.rootMatrix(t);
      for (const p of order) {
        const ch = pose[p.id];
        const [px, py] = p.pivot;
        const local = M.mul(
          M.mul(M.mul(M.t(px + ch.x, py + ch.y), M.r(ch.r)), M.s(ch.sx, ch.sy)),
          M.t(-px, -py),
        );
        out[p.id] = M.mul(p.parent ? out[p.parent] : root, local);
      }
      return out;
    },
    /** Stage position of a canvas point on a part (e.g. the palm) at time t. */
    pointOn(t, role, point) {
      const id = rig.part(role);
      if (!id) throw new Error(`rig has no ${role}`);
      return M.apply(rig.matrices(t)[id], point ?? parts.get(id).pivot);
    },
    /** Canvas-space point -> stage at time t (for targets authored on the canvas). */
    toStage(t, point) {
      return M.apply(rig.rootMatrix(t), point);
    },
    /** Stage point -> canvas space at time t. */
    toCanvas(t, point) {
      return M.apply(M.inv(rig.rootMatrix(t)), point);
    },
  };
  return rig;
}

function activeClips(clips, t) {
  // A clip in a `channel` (expression, look) is cut, with a crossfade, when a
  // later clip in the same channel starts. Others fade out after their end.
  const ramp = (x) => EASE.inOut(clamp(x, 0, 1));
  const out = [];
  for (const c of clips) {
    if (t < c.start) continue;
    let end = c.end;
    if (c.channel)
      for (const d of clips)
        if (d !== c && d.channel === c.channel && d.start > c.start && d.start < end) end = d.start;
    const fin = c.fadeIn ?? c.fade;
    const fout = c.fadeOut ?? c.fade;
    let w = fin > 0 ? ramp((t - c.start) / fin) : 1;
    if (t > end) {
      if (t > end + fout) continue;
      w = Math.min(w, 1 - ramp((t - end) / (fout || 1e-9)));
    }
    if (w > 1e-4) out.push({ clip: c, w });
  }
  return out;
}

function mix(dst, ch, w, prio) {
  if (ch.r != null) dst.r += ch.r * w;
  if (ch.x != null) dst.x += ch.x * w;
  if (ch.y != null) dst.y += ch.y * w;
  if (ch.sx != null) dst.sx *= lerp(1, ch.sx, w);
  if (ch.sy != null) dst.sy *= lerp(1, ch.sy, w);
  if (ch.s != null) {
    dst.sx *= lerp(1, ch.s, w);
    dst.sy *= lerp(1, ch.s, w);
  }
  if (ch.o != null) dst.o *= lerp(1, ch.o, w);
  if (ch.v != null && w >= 0.5 && prio >= dst.vp) {
    dst.v = ch.v;
    dst.vp = prio;
  }
}

// Damped spring on the driver's world angle and horizontal velocity, integrated
// in fixed steps from a few seconds back, so the result depends on t only.
function applyFollow(rig, f, pose, t) {
  const id = rig.part(f.role);
  const did = rig.part(f.driver);
  if (!id || !did) return;
  const dt = 1 / 240;
  const window = 3;
  const t0 = Math.max(0, t - window);
  const sample = (tt) => {
    const m = rig.matrices(tt, rig.basePose(tt));
    return { a: M.angle(m[did]), x: m[did][4] };
  };
  const steps = Math.ceil((t - t0) / dt);
  let prev = sample(t0);
  let pos = prev.a;
  let vel = 0;
  const w = 2 * Math.PI * f.freq;
  let target = prev.a;
  for (let i = 1; i <= steps; i += 4) {
    // sample the driver every 4 steps (60 Hz) and integrate at 240 Hz
    const tt = Math.min(t, t0 + i * dt);
    const cur = sample(tt);
    const vx = (cur.x - prev.x) / (4 * dt);
    target = cur.a - vx * f.inertia;
    for (let k = 0; k < 4; k++) {
      const acc = w * w * (target - pos) - 2 * f.damping * w * vel;
      vel += acc * dt;
      pos += vel * dt;
    }
    prev = cur;
  }
  pose[id].r += (pos - target) * f.gain;
}

// ---- DOM -------------------------------------------------------------------

const SVGNS = "http://www.w3.org/2000/svg";

/**
 * Mount a rig into an <svg> (or <g>) in the stage's coordinate space. Each
 * part becomes a flat <g> with its own world matrix, sorted by z, so a back
 * arm can sit behind the torso while still being its child in the hierarchy.
 * Part art: an SVG string, or { href, clip: [[x, y], ...], x, y, width,
 * height } for a photo cut-out piece. `variants` = { name: svgString }.
 * Returns { apply(t), groups }.
 */
export function mountRig(svg, rig, { idPrefix = "rig" } = {}) {
  const doc = svg.ownerDocument;
  const root = doc.createElementNS(SVGNS, "g");
  root.setAttribute("data-rig", idPrefix);
  svg.appendChild(root);
  const defs = doc.createElementNS(SVGNS, "defs");
  root.appendChild(defs);
  const groups = {};
  const variants = {};
  const sorted = [...rig.order].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const p of sorted) {
    const g = doc.createElementNS(SVGNS, "g");
    g.setAttribute("data-part", p.id);
    if (p.art) appendArt(doc, g, defs, p.art, `${idPrefix}-${p.id}`);
    if (p.variants) {
      variants[p.id] = {};
      for (const [name, art] of Object.entries(p.variants)) {
        const vg = doc.createElementNS(SVGNS, "g");
        vg.setAttribute("data-variant", name);
        appendArt(doc, vg, defs, art, `${idPrefix}-${p.id}-${name}`);
        g.appendChild(vg);
        variants[p.id][name] = vg;
      }
    }
    root.appendChild(g);
    groups[p.id] = g;
  }
  return {
    root,
    groups,
    apply(t) {
      const pose = rig.pose(t);
      const mats = rig.matrices(t, pose);
      for (const p of rig.order) {
        const g = groups[p.id];
        g.setAttribute("transform", M.css(mats[p.id]));
        g.setAttribute("opacity", String(+pose[p.id].o.toFixed(4)));
        if (variants[p.id]) {
          const want = pose[p.id].v ?? p.defaultVariant ?? Object.keys(variants[p.id])[0];
          for (const [name, vg] of Object.entries(variants[p.id]))
            vg.setAttribute("display", name === want ? "inline" : "none");
        }
      }
      return { pose, mats };
    },
  };
}

function appendArt(doc, g, defs, art, uid) {
  if (typeof art === "string") {
    const tmp = doc.createElementNS(SVGNS, "g");
    tmp.innerHTML = art;
    while (tmp.firstChild) g.appendChild(tmp.firstChild);
    return;
  }
  // photo cut-out piece: an image clipped to a polygon, in canvas coordinates
  const img = doc.createElementNS(SVGNS, "image");
  img.setAttribute("href", art.href);
  for (const k of ["x", "y", "width", "height"]) img.setAttribute(k, String(art[k] ?? 0));
  if (art.clip) {
    const cp = doc.createElementNS(SVGNS, "clipPath");
    cp.setAttribute("id", `${uid}-clip`);
    const poly = doc.createElementNS(SVGNS, "polygon");
    poly.setAttribute("points", art.clip.map((p) => p.join(",")).join(" "));
    cp.appendChild(poly);
    defs.appendChild(cp);
    img.setAttribute("clip-path", `url(#${uid}-clip)`);
  }
  g.appendChild(img);
}

/**
 * A prop that the character picks up: it stays at its stage pose until
 * `grab`, then rides rigidly in `role` (the hand) keeping the offset it had
 * at the grab, until `release` (where it stays). Returns the prop's stage
 * matrix at t; set it on the prop's <g> transform.
 */
export function propMatrix(rig, t, { role = "handR", rest, grab = Infinity, release = Infinity }) {
  const restM = rest ?? M.id();
  if (t < grab) return restM;
  const id = rig.part(role);
  const handAt = (tt) => rig.matrices(tt)[id];
  const offset = M.mul(M.inv(handAt(grab)), restM);
  const tt = Math.min(t, release);
  return M.mul(handAt(tt), offset);
}

// ---- presets ----------------------------------------------------------------
// Each preset returns a clip: { start, end, fn(u, rig) -> { role: channels },
// travel?, post?, priority, channel, fade }. Channels: r (deg), x, y, sx, sy,
// s, o, v (variant). Rotations add, scales multiply. `intensity` scales the
// performance; `dir` is +1 (right) or -1 (left). Arm side "L"/"R" is the side
// of the screen when the rig faces the camera.

const side = (s) => (s === "L" ? 1 : -1); // rotation sign that lifts that arm outward

/** Walk cycle: contact, down, passing, up; arms counter-swing; root travels. */
export function walk({
  start = 0,
  steps = 4,
  stepDur = 0.5,
  stride = 110,
  intensity = 1,
  dir = 1,
  bob = 9,
  lean = 4,
} = {}) {
  const dur = steps * stepDur;
  const f = -dir; // rotation sign that swings a leg forward
  const env = (u) => Math.min(1, u / 0.25, (dur - u) / 0.25);
  return {
    kind: "walk",
    start,
    end: start + dur,
    fade: 0.15,
    travel: (u) => ({ x: dir * stride * (u / stepDur), facing: dir }),
    fn(u) {
      const th = Math.PI * (u / stepDur);
      const e = clamp(env(u), 0, 1) * intensity;
      const A = 24 * e;
      const B = 46 * e;
      const legs = (phase) => {
        const s = Math.sin(th + phase);
        const c = Math.cos(th + phase);
        const thigh = f * A * s;
        const knee = -f * B * Math.max(0, c) * Math.max(0, c);
        return { thigh, knee, foot: -(thigh + knee) * 0.8 + f * 8 * e * Math.max(0, -s) };
      };
      const L = legs(0);
      const R = legs(Math.PI);
      const s = Math.sin(th);
      return {
        thighL: { r: L.thigh },
        shinL: { r: L.knee },
        footL: { r: L.foot },
        thighR: { r: R.thigh },
        shinR: { r: R.knee },
        footR: { r: R.foot },
        body: { y: -bob * e * Math.cos(2 * th) },
        torso: { r: f * -lean * e + 2 * e * s },
        head: { y: bob * 0.35 * e * Math.cos(2 * th - 0.6), r: -1.5 * e * s },
        upperArmL: { r: -f * 18 * e * s },
        foreArmL: { r: f * (4 + 10 * Math.max(0, -s)) * e },
        upperArmR: { r: f * 18 * e * s },
        foreArmR: { r: f * (4 + 10 * Math.max(0, s)) * e },
      };
    },
  };
}

/** Run cycle: flight phase, strong lean, pumping bent arms. */
export function run({
  start = 0,
  steps = 6,
  stepDur = 0.28,
  stride = 190,
  intensity = 1,
  dir = 1,
} = {}) {
  const dur = steps * stepDur;
  const f = -dir;
  return {
    kind: "run",
    start,
    end: start + dur,
    fade: 0.1,
    travel: (u) => ({ x: dir * stride * (u / stepDur), facing: dir }),
    fn(u) {
      const th = Math.PI * (u / stepDur);
      const e = clamp(Math.min(1, u / 0.15, (dur - u) / 0.15), 0, 1) * intensity;
      const legs = (phase) => {
        const s = Math.sin(th + phase);
        const c = Math.cos(th + phase);
        const thigh = f * 42 * e * s + f * 10 * e;
        const knee = -f * (20 + 70 * Math.max(0, c)) * e;
        return { thigh, knee, foot: -(thigh + knee) * 0.6 };
      };
      const L = legs(0);
      const R = legs(Math.PI);
      const s = Math.sin(th);
      return {
        thighL: { r: L.thigh },
        shinL: { r: L.knee },
        footL: { r: L.foot },
        thighR: { r: R.thigh },
        shinR: { r: R.knee },
        footR: { r: R.foot },
        body: { y: -22 * e * Math.abs(Math.sin(th)) + 8 * e },
        torso: { r: f * -12 * e },
        head: { r: f * 6 * e, y: 6 * e * Math.cos(2 * th - 0.8) },
        upperArmL: { r: -f * 40 * e * s + f * 10 * e },
        foreArmL: { r: f * 75 * e },
        upperArmR: { r: f * 40 * e * s + f * 10 * e },
        foreArmR: { r: f * 75 * e },
        mouth: { v: "open" },
      };
    },
  };
}

/** Turn a word into viseme names timed across its duration. */
export function visemes(word) {
  const w = String(word)
    .toLowerCase()
    .replace(/[^a-z']/g, "");
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const pair = w.slice(i, i + 2);
    let v;
    if (pair === "th" || pair === "sh" || pair === "ch") {
      v = "teeth";
      i++;
    } else if ("mbp".includes(c)) v = "mbp";
    else if ("fv".includes(c)) v = "fv";
    else if ("ouw".includes(c)) v = "round";
    else if ("ei".includes(c)) v = "wide";
    else if ("ay".includes(c)) v = "open";
    else if ("sztdnlrkgcjxq".includes(c)) v = "teeth";
    else continue;
    if (out[out.length - 1] !== v) out.push(v);
  }
  return out.length ? out : ["open"];
}

const VISEME_FALLBACK = {
  mbp: "rest",
  fv: "teeth",
  teeth: "wide",
  wide: "open",
  round: "open",
  open: "rest",
};

/**
 * Talking: mouth shapes from narration word timings ([[word, start, end]] or
 * {word,start,end}), head accents on long or stressed words, brow lifts on
 * emphasis (a word ending in "!" or listed in `emphasis`).
 */
export function talk({ words, start, end, intensity = 1, emphasis = [], nod = 3 } = {}) {
  const ws = words.map((w) => (Array.isArray(w) ? { word: w[0], start: w[1], end: w[2] } : w));
  const s0 = start ?? ws[0].start - 0.12; // fade in before the first sound
  const s1 = end ?? ws[ws.length - 1].end;
  const emph = new Set(emphasis.map((e) => e.toLowerCase()));
  return {
    kind: "talk",
    start: s0,
    end: s1,
    fade: 0.08,
    priority: 2,
    fn(_u, rig, t) {
      const has = (v) => rig.spec.parts.some((p) => p.id === rig.part("mouth") && p.variants?.[v]);
      const pick = (v) => {
        let x = v;
        while (x && !has(x)) x = VISEME_FALLBACK[x];
        return x ?? "rest";
      };
      const out = {
        mouth: { v: pick("rest") },
        head: { r: 0, y: 0 },
        browL: { y: 0 },
        browR: { y: 0 },
      };
      for (const w of ws) {
        const lead = 0.04; // mouth leads the sound slightly
        if (t < w.start - lead || t > w.end) continue;
        const vs = visemes(w.word);
        const k = clamp(
          Math.floor(((t + lead - w.start) / (w.end - w.start || 1)) * vs.length),
          0,
          vs.length - 1,
        );
        out.mouth.v = pick(vs[k]);
        const stressed =
          emph.has(w.word.toLowerCase().replace(/[^a-z0-9']/g, "")) || /!$/.test(w.word);
        const big = stressed || w.word.replace(/[^a-z]/gi, "").length >= 6;
        const p = clamp((t - w.start) / Math.min(0.3, w.end - w.start || 0.3), 0, 1);
        const bump = Math.sin(Math.PI * p);
        if (big)
          out.head = { r: nod * intensity * bump * (stressed ? 1.6 : 1), y: 3 * intensity * bump };
        if (stressed) out.browL.y = out.browR.y = -9 * intensity * bump;
      }
      return out;
    },
  };
}

/** Seeded natural blinks between start and end, ~every 2-5 s, sometimes double. */
export function blink({ start = 0, end = 10, seed = 1, rate = 0.3, dur = 0.16, at = [] } = {}) {
  const rnd = seeded(seed);
  const times = [...at];
  let t = start + 0.4 + rnd() * 1.2;
  while (t < end) {
    times.push(t);
    if (rnd() < 0.18) times.push(t + dur + 0.08);
    t += 1.6 + (-Math.log(1 - rnd()) / rate) * 0.6;
  }
  times.sort((a, b) => a - b);
  return {
    kind: "blink",
    start,
    end,
    fade: 0,
    priority: 3,
    times,
    fn(_u, _rig, tt) {
      let c = 0;
      for (const b of times) {
        const p = (tt - b) / dur;
        if (p >= 0 && p <= 1)
          c = Math.max(c, p < 0.4 ? EASE.in(p / 0.4) : 1 - EASE.out((p - 0.4) / 0.6));
      }
      return { lidL: { sy: 1 + c * 60 }, lidR: { sy: 1 + c * 60 } };
    },
  };
}

/**
 * Look: eyes lead, the head follows ~0.08 s later. `dx`, `dy` in -1..1
 * (screen direction), or `at` = a canvas point. Holds until `end`.
 */
export function look({
  start,
  dur = 0.25,
  end = Infinity,
  dx = 0,
  dy = 0,
  at,
  head = 1,
  blinkOnTurn = true,
} = {}) {
  return {
    kind: "look",
    channel: "look",
    start,
    end,
    fade: 0.15,
    fn(u, rig) {
      let vx = dx;
      let vy = dy;
      if (at) {
        // canvas point; the eyes sit ~80 px above the neck pivot
        const hp = rig.parts.get(rig.part("head") ?? "")?.pivot ?? rig.ground;
        vx = clamp((at[0] - hp[0]) / 300, -1, 1);
        vy = clamp((at[1] - (hp[1] - 80)) / 300, -1, 1);
      }
      const pe = EASE.out3(clamp(u / dur, 0, 1));
      const ph = EASE.inOut(clamp((u - 0.08) / (dur * 1.4), 0, 1));
      const R = rig.ranges.pupil;
      const lid =
        blinkOnTurn && Math.abs(vx) > 0.5
          ? Math.max(0, Math.sin(Math.PI * clamp(u / 0.18, 0, 1)))
          : 0;
      return {
        pupilL: { x: vx * R * pe, y: vy * R * 0.7 * pe },
        pupilR: { x: vx * R * pe, y: vy * R * 0.7 * pe },
        head: { r: vx * 7 * head * ph, x: vx * 5 * head * ph, y: vy * 4 * head * ph },
        lidL: { sy: 1 + lid * 30 },
        lidR: { sy: 1 + lid * 30 },
      };
    },
  };
}

export const EMOTIONS = {
  neutral: {},
  happy: {
    browL: { y: -6 },
    browR: { y: -6 },
    mouth: { v: "smile" },
    head: { r: -2 },
    lidL: { sy: 6 },
    lidR: { sy: 6 },
  },
  sad: {
    browL: { r: 14, y: -2 },
    browR: { r: -14, y: -2 },
    mouth: { v: "frown" },
    head: { r: 4, y: 8 },
    torso: { y: 6 },
    lidL: { sy: 12 },
    lidR: { sy: 12 },
  },
  angry: {
    browL: { r: -16, y: 5 },
    browR: { r: 16, y: 5 },
    mouth: { v: "teeth" },
    head: { y: 5 },
    torso: { r: 2 },
  },
  surprised: {
    browL: { y: -14 },
    browR: { y: -14 },
    mouth: { v: "round" },
    pupilL: { s: 0.8 },
    pupilR: { s: 0.8 },
    head: { y: -5 },
  },
  worried: {
    browL: { r: 10, y: -6 },
    browR: { r: -10, y: -6 },
    mouth: { v: "wide" },
    head: { r: 2 },
  },
  smug: {
    browL: { y: -10, r: -4 },
    browR: { y: 2 },
    mouth: { v: "smirk" },
    lidL: { sy: 18 },
    lidR: { sy: 18 },
    head: { r: -5 },
  },
};

/** Facial expression held until `end` or the next expression (channel). */
export function expression({
  start,
  emotion = "neutral",
  end = Infinity,
  fade = 0.2,
  intensity = 1,
} = {}) {
  const e = EMOTIONS[emotion];
  if (!e) throw new Error(`unknown emotion ${emotion} (have ${Object.keys(EMOTIONS).join(", ")})`);
  return {
    kind: "expression",
    channel: "expression",
    start,
    end,
    fade,
    priority: 1,
    fn() {
      const out = {};
      for (const [k, ch] of Object.entries(e)) {
        out[k] = {};
        for (const [c, v] of Object.entries(ch))
          out[k][c] =
            c === "v"
              ? v
              : c === "s" || c === "sx" || c === "sy"
                ? 1 + (v - 1) * intensity
                : v * intensity;
      }
      return out;
    },
  };
}

/**
 * Arm gestures with anticipation and follow-through baked into the curves:
 * wave, point, present, shrug, fist-pump, facepalm-lite (hand to head).
 */
export function gesture({ start, type = "wave", side: sd = "R", intensity = 1, hold = 0.8 } = {}) {
  const s = side(sd);
  const up = `upperArm${sd}`;
  const fo = `foreArm${sd}`;
  const ha = `hand${sd}`;
  const k = intensity;
  const T = {
    wave: {
      dur: 0.5 + hold + 0.35,
      fn: (u) => {
        const raise = curve(u, [
          [0, 0],
          [0.1, -12],
          [0.42, 155, "back"],
          [0.42 + hold, 155],
          [0.42 + hold + 0.35, 0, "inOut"],
        ]);
        const wag = u > 0.38 && u < 0.42 + hold ? Math.sin((u - 0.38) * Math.PI * 2 * 2.6) * 24 : 0;
        return {
          [up]: { r: s * raise * k },
          [fo]: { r: s * (12 + wag) * k },
          [ha]: { r: s * wag * 0.5 * k },
          torso: { r: -s * 3 * k * (raise / 155) },
        };
      },
    },
    point: {
      dur: 0.35 + hold + 0.3,
      fn: (u) => {
        const r = curve(u, [
          [0, 0],
          [0.12, -18, "out"],
          [0.3, 82, "back"],
          [0.3 + hold, 80],
          [0.6 + hold, 0, "inOut"],
        ]);
        return {
          [up]: { r: s * r * k },
          [fo]: { r: s * 8 * k * (r / 80) },
          head: { r: s * -3 * (r / 80) },
          torso: { r: s * -2 * (r / 80) },
        };
      },
    },
    present: {
      dur: 0.45 + hold + 0.35,
      fn: (u) => {
        const p = curve(u, [
          [0, 0],
          [0.12, -0.15, "out"],
          [0.45, 1, "back"],
          [0.45 + hold, 1],
          [0.8 + hold, 0, "inOut"],
        ]);
        return {
          [up]: { r: s * 48 * p * k },
          [fo]: { r: s * 35 * p * k },
          [ha]: { r: s * -20 * p },
          head: { r: s * -4 * p },
        };
      },
    },
    shrug: {
      dur: 0.3 + hold + 0.3,
      fn: (u) => {
        const p = curve(u, [
          [0, 0],
          [0.25, 1, "back"],
          [0.25 + hold, 1],
          [0.6 + hold, 0, "inOut"],
        ]);
        return {
          upperArmL: { r: 15 * p * k, y: -10 * p },
          foreArmL: { r: 65 * p * k },
          upperArmR: { r: -15 * p * k, y: -10 * p },
          foreArmR: { r: -65 * p * k },
          head: { r: 6 * p, y: 6 * p },
          browL: { y: -8 * p },
          browR: { y: -8 * p },
          torso: { y: -4 * p },
        };
      },
    },
    "fist-pump": {
      dur: 0.25 + hold + 0.3,
      fn: (u) => {
        const a = curve(u, [
          [0, 0],
          [0.1, -14, "out"],
          [0.22, 100, "back"],
          [0.22 + hold, 100],
          [0.55 + hold, 0, "inOut"],
        ]);
        const pump =
          u > 0.22 && u < 0.22 + hold ? Math.abs(Math.sin((u - 0.22) * Math.PI * 3)) * 16 : 0;
        return {
          [up]: { r: s * (a - pump) * k },
          [fo]: { r: s * 80 * clamp(a / 100, 0, 1) * k },
          body: { y: -6 * clamp(a / 100, 0, 1) },
        };
      },
    },
  };
  const g = T[type];
  if (!g) throw new Error(`unknown gesture ${type} (have ${Object.keys(T).join(", ")})`);
  return { kind: "gesture", start, end: start + g.dur, fade: 0.05, fn: (u) => g.fn(u) };
}

/** Squash and stretch on a part (default the whole body), volume preserving. */
export function squash({ start, part = "body", amount = 0.2, dur = 0.3, ease = "elastic" } = {}) {
  return {
    kind: "squash",
    start,
    end: start + dur,
    fade: 0,
    fn(u) {
      const p = clamp(u / dur, 0, 1);
      const a = amount * (1 - EASE[ease](p));
      const sy = 1 - a;
      return { [part]: { sy, sx: 1 / Math.sqrt(Math.max(0.2, sy)) } };
    },
  };
}

/** Hop: crouch (anticipation), stretch on launch, arc, squash on landing, settle. */
export function hop({
  start,
  height = 140,
  air = 0.42,
  crouch = 0.16,
  dx = 0,
  dir = 1,
  intensity = 1,
} = {}) {
  const tL = crouch;
  const tA = crouch + air;
  const dur = tA + 0.3;
  return {
    kind: "hop",
    start,
    end: start + dur,
    fade: 0.05,
    travel: (u) => ({ x: dir * dx * clamp((u - tL) / air, 0, 1) }),
    fn(u) {
      const f = -dir;
      let y = 0;
      let sy = 1;
      let knee = 0;
      if (u < tL) {
        const p = EASE.out(u / tL);
        y = 26 * p;
        sy = 1 - 0.14 * p;
        knee = 40 * p;
      } else if (u < tA) {
        const p = (u - tL) / air;
        y = -height * 4 * p * (1 - p);
        sy = 1 + 0.2 * (1 - p) * (1 - p) - 0.05 * p;
        knee = 25 * Math.sin(Math.PI * p);
      } else {
        const p = clamp((u - tA) / 0.3, 0, 1);
        const sq = Math.sin(Math.PI * clamp(p * 1.6, 0, 1)) * (1 - p);
        y = 18 * sq;
        sy = 1 - 0.18 * sq;
        knee = 34 * sq;
      }
      const k = intensity;
      return {
        body: { y: y * k, sy: 1 + (sy - 1) * k, sx: 1 / Math.sqrt(1 + (sy - 1) * k) },
        thighL: { r: f * knee * 0.6 * k },
        shinL: { r: -f * knee * k },
        footL: { r: f * knee * 0.4 * k },
        thighR: { r: f * knee * 0.6 * k },
        shinR: { r: -f * knee * k },
        footR: { r: f * knee * 0.4 * k },
        upperArmL: { r: 40 * Math.max(0, -y / height) * k },
        upperArmR: { r: -40 * Math.max(0, -y / height) * k },
      };
    },
  };
}

/**
 * Exaggerated comedic reactions:
 *  "double-take": glance, beat, snap back with squash-stretch and eye pop;
 *  "jolt": jump scare: squash, launch, arms up, shiver on landing;
 *  "deflate": slow sag of body, head and arms.
 * `dir` is the side the thing that caused the take is on (+1 right).
 */
export function take({ start, kind = "double-take", dir = 1, intensity = 1 } = {}) {
  const k = intensity;
  if (kind === "double-take") {
    return {
      kind: "take",
      start,
      end: start + 1.5,
      fade: 0.08,
      priority: 4,
      fn(u) {
        const glance = curve(u, [
          [0, 0],
          [0.12, 1, "out"],
          [0.42, 1],
          [0.5, -0.2, "in"],
          [0.62, 1.15, "back"],
          [1.5, 1],
        ]);
        const pop = curve(u, [
          [0.5, 0],
          [0.56, -0.12, "out"],
          [0.66, 1, "back"],
          [1.1, 1],
          [1.5, 0.4, "inOut"],
        ]);
        const sqz = curve(u, [
          [0.44, 0],
          [0.52, -1, "out"],
          [0.62, 1, "out"],
          [0.8, 0, "elastic"],
        ]);
        return {
          head: { r: dir * 9 * glance * k, x: dir * 8 * glance * k, y: -18 * Math.max(0, sqz) * k },
          pupilL: { x: dir * 7 * glance, s: 1 - 0.25 * pop },
          pupilR: { x: dir * 7 * glance, s: 1 - 0.25 * pop },
          eyeL: { s: 1 + 0.35 * pop * k },
          eyeR: { s: 1 + 0.35 * pop * k },
          browL: { y: -16 * pop * k },
          browR: { y: -16 * pop * k },
          mouth: pop > 0.5 ? { v: "round" } : {},
          body: { sy: 1 + 0.16 * sqz * k, sx: 1 - 0.1 * sqz * k },
          tuft: { r: -dir * 20 * pop },
        };
      },
    };
  }
  if (kind === "jolt") {
    return {
      kind: "take",
      start,
      end: start + 1.3,
      fade: 0.05,
      priority: 4,
      fn(u) {
        const air = curve(u, [
          [0, 0],
          [0.06, 0.25, "out"],
          [0.22, -1, "out"],
          [0.42, 0, "in"],
          [0.5, 0.15, "out"],
          [0.7, 0, "inOut"],
        ]);
        const arms = curve(u, [
          [0.05, 0],
          [0.18, 1, "back"],
          [0.6, 0.9],
          [1.3, 0, "inOut"],
        ]);
        const shiver = u > 0.45 && u < 1.0 ? Math.sin(u * 90) * 3 * (1 - (u - 0.45) / 0.55) : 0;
        return {
          body: { y: air * 120 * k, x: shiver, sy: 1 - air * 0.22 * k, sx: 1 + air * 0.12 * k },
          upperArmL: { r: 140 * arms * k },
          upperArmR: { r: -140 * arms * k },
          foreArmL: { r: 20 * arms },
          foreArmR: { r: -20 * arms },
          eyeL: { s: 1 + 0.4 * arms * k },
          eyeR: { s: 1 + 0.4 * arms * k },
          pupilL: { s: 0.6 },
          pupilR: { s: 0.6 },
          browL: { y: -18 * arms },
          browR: { y: -18 * arms },
          mouth: { v: "open" },
        };
      },
    };
  }
  if (kind === "deflate") {
    return {
      kind: "take",
      start,
      end: start + 2.2,
      fade: 0.3,
      priority: 4,
      fn(u) {
        const p = curve(u, [
          [0, 0],
          [0.25, -0.1, "out"],
          [1.4, 1, "inOut"],
          [2.2, 1],
        ]);
        return {
          body: { y: 14 * p * k, sy: 1 - 0.06 * p * k },
          torso: { r: dir * 3 * p, y: 8 * p },
          head: { y: 16 * p * k, r: -dir * 6 * p },
          upperArmL: { r: -6 * p },
          upperArmR: { r: 6 * p },
          browL: { r: 12 * p, y: 4 * p },
          browR: { r: -12 * p, y: 4 * p },
          lidL: { sy: 1 + 16 * p },
          lidR: { sy: 1 + 16 * p },
          mouth: { v: "frown" },
        };
      },
    };
  }
  throw new Error(`unknown take ${kind} (double-take, jolt, deflate)`);
}

/**
 * Reach for a canvas-space target with two-bone IK (shoulder, elbow, wrist):
 * wind-up, arrive with ease-out, hold, return. `target` may be a function of
 * t (a moving object). Combine with propMatrix() to pick something up.
 */
export function reach({
  start,
  target,
  side: sd = "R",
  dur = 0.45,
  hold = 0.8,
  back = 0.4,
  bend,
} = {}) {
  const up = `upperArm${sd}`;
  const fo = `foreArm${sd}`;
  const ha = `hand${sd}`;
  const total = dur + hold + back;
  return {
    kind: "reach",
    start,
    end: start + total,
    fade: 0.05,
    fn: (u) => ({
      torso: {
        r:
          side(sd) *
          4 *
          curve(u, [
            [0, 0],
            [dur, 1, "out3"],
            [dur + hold, 1],
            [total, 0],
          ]),
      },
    }),
    post(u, rig, pose, w, t) {
      const uid = rig.part(up);
      const fid = rig.part(fo);
      const hid = rig.part(ha);
      if (!uid || !fid || !hid) return;
      const P = rig.parts;
      const sh = P.get(uid).pivot;
      const el = P.get(fid).pivot;
      const wr = P.get(hid).pivot;
      const l1 = Math.hypot(el[0] - sh[0], el[1] - sh[1]);
      const l2 = Math.hypot(wr[0] - el[0], wr[1] - el[1]);
      const rest1 = Math.atan2(el[1] - sh[1], el[0] - sh[0]) / DEG;
      const rest2 = Math.atan2(wr[1] - el[1], wr[0] - el[0]) / DEG;
      // world (canvas) frame of the shoulder's parent under the current pose
      const mats = rig.matrices(t, pose);
      const parentM = M.mul(M.inv(rig.rootMatrix(t)), mats[P.get(uid).parent]);
      const parentAngle = M.angle(parentM);
      const shW = M.apply(mats[uid], sh);
      const shC = M.apply(M.inv(rig.rootMatrix(t)), shW);
      const tg = typeof target === "function" ? target(t) : target;
      const b = bend ?? (sd === "R" ? 1 : -1);
      const ik = solveTwoBone(shC, tg, l1, l2, b);
      // IK runs in canvas space, so a mirrored (facing -1) rig needs no change.
      const want1 = ik.a1 - rest1 - parentAngle;
      const want2 = ik.a2 - ik.a1 - rest2 + rest1;
      const p =
        u < dur
          ? EASE.out3(clamp(u / dur, 0, 1))
          : u < dur + hold
            ? 1
            : 1 - EASE.inOut(clamp((u - dur - hold) / back, 0, 1));
      const wind = u < dur * 0.3 ? Math.sin(Math.PI * (u / (dur * 0.3))) * 0.12 : 0;
      const cur1 = pose[uid].r;
      const cur2 = pose[fid].r;
      pose[uid].r = lerp(cur1, normAngle(want1, cur1), p * w) - side(sd) * 14 * wind;
      pose[fid].r = lerp(cur2, normAngle(want2, cur2), p * w);
    },
  };
}

function normAngle(a, ref) {
  let x = a;
  while (x - ref > 180) x -= 360;
  while (x - ref < -180) x += 360;
  return x;
}

/** All presets by name, for scenes.json-driven performances. */
export const PRESETS = {
  walk,
  run,
  talk,
  blink,
  look,
  expression,
  gesture,
  squash,
  hop,
  take,
  reach,
};

/**
 * Build a performance from a list like scenes.json `character.actions`:
 * [{ preset: "walk", start: 0.2, steps: 4 }, { preset: "talk", words }, ...].
 */
export function perform(rig, actions) {
  for (const a of actions) {
    const { preset, ...params } = a;
    const fn = PRESETS[preset];
    if (!fn) throw new Error(`unknown preset ${preset} (have ${Object.keys(PRESETS).join(", ")})`);
    rig.add(fn(params));
  }
  return rig;
}
