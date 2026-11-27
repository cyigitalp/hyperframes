// map-frame.js: frame-pure map helpers for HyperFrames compositions.
// Load as a classic script: <script src="map-frame.js"></script>
// Exposes globalThis.HFMap. No DOM, clock or network access, so every value is
// a pure function of its inputs and of the seeked time.
// Adapted from iart-ai/map-animation-skills (MIT), see UPSTREAM.md.
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  const MERC_MAX = 85.0511287798;
  const EPS = 1e-9;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const round = (v, d) => {
    const k = 10 ** (d == null ? 1 : d);
    return Math.round(v * k) / k;
  };

  // Raw projections: lambda, phi in radians -> unit [x, y] with y pointing up.
  const RAW = {
    mercator(l, p) {
      const c = Math.max(-MERC_MAX, Math.min(MERC_MAX, p / RAD)) * RAD;
      return [l, Math.log(Math.tan(Math.PI / 4 + c / 2))];
    },
    equirectangular(l, p) {
      return [l, p];
    },
    equalEarth(l, p) {
      const A1 = 1.340264;
      const A2 = -0.081106;
      const A3 = 0.000893;
      const A4 = 0.003796;
      const M = Math.sqrt(3) / 2;
      const t = Math.asin(M * Math.sin(p));
      const t2 = t * t;
      const t6 = t2 * t2 * t2;
      return [
        (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
        t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)),
      ];
    },
  };

  function assertLngLat(c) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      throw new TypeError("expected [lng, lat], got " + JSON.stringify(c));
    }
    if (Math.abs(c[1]) > 90 || Math.abs(c[0]) > 540) {
      throw new RangeError("coordinate out of range (is it [lat, lng]?): " + JSON.stringify(c));
    }
  }

  /** Every [lng, lat] of a Feature, FeatureCollection, geometry or array of features. */
  function eachCoord(obj, fn) {
    if (!obj) return;
    if (Array.isArray(obj)) return obj.forEach((o) => eachCoord(o, fn));
    if (obj.type === "FeatureCollection") return eachCoord(obj.features, fn);
    if (obj.type === "Feature") return eachCoord(obj.geometry, fn);
    const c = obj.coordinates;
    if (obj.type === "Point") return fn(c);
    if (obj.type === "MultiPoint" || obj.type === "LineString") return c.forEach(fn);
    if (obj.type === "Polygon" || obj.type === "MultiLineString")
      return c.forEach((r) => r.forEach(fn));
    if (obj.type === "MultiPolygon") return c.forEach((p) => p.forEach((r) => r.forEach(fn)));
    throw new TypeError("unsupported GeoJSON type " + obj.type);
  }

  /**
   * Projection fitted to a viewport. opts: { type: "mercator" | "equalEarth" |
   * "equirectangular", width, height, fit (GeoJSON to frame), padding, center
   * (central meridian, default 0) }. project([lng, lat]) gives [x, y] pixels.
   */
  function createProjection(opts) {
    const o = opts || {};
    const raw = RAW[o.type || "mercator"];
    if (!raw) throw new TypeError("unknown projection " + o.type);
    const W = o.width;
    const H = o.height;
    if (!(W > 0 && H > 0)) throw new TypeError("width and height are required");
    const lon0 = o.center || 0;
    const pad = o.padding || 0;
    const rawAt = (c) => {
      // Wrap only past the seam, so Natural Earth's +/-180 edges stay on their side.
      let l = c[0] - lon0;
      while (l > 180) l -= 360;
      while (l < -180) l += 360;
      return raw(l * RAD, c[1] * RAD);
    };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    eachCoord(
      o.fit || {
        type: "MultiPoint",
        coordinates: [
          [-180, -60],
          [180, 80],
        ],
      },
      (c) => {
        const r = rawAt(c);
        if (r[0] < x0) x0 = r[0];
        if (r[0] > x1) x1 = r[0];
        if (r[1] < y0) y0 = r[1];
        if (r[1] > y1) y1 = r[1];
      },
    );
    const k = Math.min(
      (W - 2 * pad) / Math.max(x1 - x0, EPS),
      (H - 2 * pad) / Math.max(y1 - y0, EPS),
    );
    const tx = W / 2 - (k * (x0 + x1)) / 2;
    const ty = H / 2 + (k * (y0 + y1)) / 2;
    function project(c) {
      assertLngLat(c);
      const r = rawAt(c);
      return [tx + k * r[0], ty - k * r[1]];
    }
    return { type: o.type || "mercator", width: W, height: H, scale: k, project: project };
  }

  /** SVG path data for a Polygon / MultiPolygon / LineString feature or geometry. */
  function pathD(obj, project, decimals) {
    const g = obj.type === "Feature" ? obj.geometry : obj;
    const d = decimals == null ? 1 : decimals;
    const line = (pts, close) =>
      pts
        .map((c, i) => {
          const p = project(c);
          return (i ? "L" : "M") + round(p[0], d) + " " + round(p[1], d);
        })
        .join("") + (close ? "Z" : "");
    if (g.type === "Polygon") return g.coordinates.map((r) => line(r, true)).join("");
    if (g.type === "MultiPolygon")
      return g.coordinates.map((p) => p.map((r) => line(r, true)).join("")).join("");
    if (g.type === "LineString") return line(g.coordinates, false);
    if (g.type === "MultiLineString") return g.coordinates.map((r) => line(r, false)).join("");
    throw new TypeError("pathD cannot draw " + g.type);
  }

  /** Projected pixel bounds [[x0, y0], [x1, y1]] of any GeoJSON. */
  function bounds(obj, project) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    eachCoord(obj, (c) => {
      const p = project(c);
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    });
    return [
      [x0, y0],
      [x1, y1],
    ];
  }

  /** Find a country by ISO A3 code or English name; throws when missing. */
  function findFeature(collection, query) {
    const q = String(query).toLowerCase();
    const f = collection.features.find(
      (x) => String(x.id).toLowerCase() === q || String(x.properties.name).toLowerCase() === q,
    );
    if (!f) throw new Error("no feature matches " + query);
    return f;
  }

  /** Outer rings of a polygon feature, largest first (for border draw-ons). */
  function outerRings(feature) {
    const g = feature.geometry || feature;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const area = (r) => {
      let s = 0;
      for (let i = 1; i < r.length; i++) s += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
      return Math.abs(s / 2);
    };
    return polys.map((p) => p[0]).sort((a, b) => area(b) - area(a));
  }

  /** `n + 1` points along the great circle from a to b, both [lng, lat] (d3.geoInterpolate). */
  function greatCircle(a, b, n) {
    assertLngLat(a);
    assertLngLat(b);
    const steps = n || 48;
    const l0 = a[0] * RAD;
    const p0 = a[1] * RAD;
    const l1 = b[0] * RAD;
    const p1 = b[1] * RAD;
    const cy0 = Math.cos(p0);
    const cy1 = Math.cos(p1);
    const kx0 = cy0 * Math.cos(l0);
    const ky0 = cy0 * Math.sin(l0);
    const kx1 = cy1 * Math.cos(l1);
    const ky1 = cy1 * Math.sin(l1);
    const h = (v) => Math.sin(v / 2) ** 2;
    const d = 2 * Math.asin(Math.sqrt(h(p1 - p0) + cy0 * cy1 * h(l1 - l0)));
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (d < EPS) {
        out.push([a[0], a[1]]);
        continue;
      }
      const B = Math.sin(t * d) / Math.sin(d);
      const A = Math.sin(d - t * d) / Math.sin(d);
      const x = A * kx0 + B * kx1;
      const y = A * ky0 + B * ky1;
      const z = A * Math.sin(p0) + B * Math.sin(p1);
      out.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD]);
    }
    out[0] = [a[0], a[1]];
    out[steps] = [b[0], b[1]];
    return out;
  }

  /** Great-circle distance in km between two [lng, lat] (haversine, mean radius 6371.0088 km). */
  function distanceKm(a, b) {
    assertLngLat(a);
    assertLngLat(b);
    const h = (v) => Math.sin(v / 2) ** 2;
    const p0 = a[1] * RAD;
    const p1 = b[1] * RAD;
    const x = h(p1 - p0) + Math.cos(p0) * Math.cos(p1) * h((b[0] - a[0]) * RAD);
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  /**
   * Partial polyline for draw-ons: the first `p` (0..1) of the path by length.
   * Returns { d, head: [x, y], angle (degrees), length }.
   */
  function partialPath(points, p, decimals) {
    const dec = decimals == null ? 1 : decimals;
    const n = points.length;
    if (n < 2) throw new RangeError("partialPath needs at least 2 points");
    const cum = [0];
    for (let i = 1; i < n; i++) {
      cum.push(
        cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
      );
    }
    const total = cum[n - 1];
    const target = clamp01(p) * total;
    const pt = (q) => round(q[0], dec) + " " + round(q[1], dec);
    let d = "M" + pt(points[0]);
    let head = points[0];
    let angle = Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]);
    for (let i = 1; i < n; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (cum[i] <= target + EPS) {
        d += "L" + pt(b);
        head = b;
        if (cum[i] > cum[i - 1]) angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        continue;
      }
      const seg = cum[i] - cum[i - 1];
      const t = seg > 0 ? (target - cum[i - 1]) / seg : 0;
      if (t > 0) {
        head = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        d += "L" + pt(head);
        angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
      break;
    }
    return {
      d: d,
      head: [round(head[0], dec), round(head[1], dec)],
      angle: angle / RAD,
      length: total,
    };
  }

  /**
   * Camera framing pixel bounds in a viewport: { x, y, zoom } where (x, y) is the
   * map pixel at the viewport centre. padding is a fraction of the viewport (0.1).
   */
  function cameraFor(b, viewport, padding) {
    const pad = padding == null ? 0.1 : padding;
    const w = Math.max(b[1][0] - b[0][0], EPS);
    const h = Math.max(b[1][1] - b[0][1], EPS);
    const zoom = Math.min(
      (viewport.width * (1 - 2 * pad)) / w,
      (viewport.height * (1 - 2 * pad)) / h,
    );
    return { x: (b[0][0] + b[1][0]) / 2, y: (b[0][1] + b[1][1]) / 2, zoom: zoom };
  }

  /**
   * Smooth zoom and pan between two cameras (van Wijk and Nuij, like
   * d3.interpolateZoom): pulls out on long moves, so global to regional reads
   * as one flight. Returns fn(p) -> camera for p in 0..1.
   */
  function flyTo(a, b, viewport, rho) {
    const R = rho || Math.SQRT2;
    const R2 = R * R;
    const R4 = R2 * R2;
    const w0 = viewport.width / a.zoom;
    const w1 = viewport.width / b.zoom;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    let at;
    if (d2 < 1e-12) {
      const S = Math.log(w1 / w0) / R;
      at = (t) => [a.x + t * dx, a.y + t * dy, w0 * Math.exp(R * t * S)];
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + R4 * d2) / (2 * w0 * R2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - R4 * d2) / (2 * w1 * R2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      const S = (r1 - r0) / R;
      at = (t) => {
        const s = t * S;
        const u = (w0 / (R2 * d1)) * (Math.cosh(r0) * Math.tanh(R * s + r0) - Math.sinh(r0));
        return [a.x + u * dx, a.y + u * dy, (w0 * Math.cosh(r0)) / Math.cosh(R * s + r0)];
      };
    }
    return function (p) {
      const t = clamp01(p);
      if (t === 0) return { x: a.x, y: a.y, zoom: a.zoom };
      if (t === 1) return { x: b.x, y: b.y, zoom: b.zoom };
      const v = at(t);
      return { x: v[0], y: v[1], zoom: viewport.width / v[2] };
    };
  }

  /** Map pixel -> viewport pixel under a camera (for labels and pins kept upright and unscaled). */
  function toScreen(cam, viewport, pt) {
    return [
      viewport.width / 2 + (pt[0] - cam.x) * cam.zoom,
      viewport.height / 2 + (pt[1] - cam.y) * cam.zoom,
    ];
  }

  /** SVG transform for the map group under a camera. Use vector-effect="non-scaling-stroke" on its paths. */
  function cameraTransform(cam, viewport) {
    const tx = viewport.width / 2 - cam.x * cam.zoom;
    const ty = viewport.height / 2 - cam.y * cam.zoom;
    return "translate(" + round(tx, 3) + " " + round(ty, 3) + ") scale(" + round(cam.zoom, 5) + ")";
  }

  /** Linear 0..1 progress of t through [start, start + duration]. Ease it with gsap.parseEase. */
  function local(t, start, duration) {
    return duration > 0 ? clamp01((t - start) / duration) : t >= start ? 1 : 0;
  }

  /** Quantize time to a slower graphic cadence (the 12 fps "stutter"), aligned to the render fps. */
  function stepTime(t, fps, stepFps) {
    const hold = Math.max(1, Math.round(fps / (stepFps || 12)));
    const frame = Math.floor(t * fps + 1e-6);
    return (Math.floor(frame / hold) * hold) / fps;
  }

  /** Blend two #rrggbb colours. */
  function mixColor(a, b, p) {
    const t = clamp01(p);
    const ch = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
    let out = "#";
    for (let i = 0; i < 3; i++) {
      out += Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
        .toString(16)
        .padStart(2, "0");
    }
    return out;
  }

  root.HFMap = {
    createProjection: createProjection,
    pathD: pathD,
    bounds: bounds,
    findFeature: findFeature,
    outerRings: outerRings,
    greatCircle: greatCircle,
    distanceKm: distanceKm,
    partialPath: partialPath,
    cameraFor: cameraFor,
    flyTo: flyTo,
    toScreen: toScreen,
    cameraTransform: cameraTransform,
    local: local,
    stepTime: stepTime,
    mixColor: mixColor,
  };
})(globalThis);
