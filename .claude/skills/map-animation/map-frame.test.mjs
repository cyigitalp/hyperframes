import { test } from "node:test";
import assert from "node:assert/strict";
import "./map-frame.js";
import "../../../vendor/natural-earth/countries-110m.js";

const M = globalThis.HFMap;
const world = globalThis.HFNaturalEarth["countries-110m"];
const VIEW = { width: 1280, height: 720 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, a + " != " + b);

test("Natural Earth data is valid, unique and in range", () => {
  assert.equal(world.type, "FeatureCollection");
  assert.ok(world.features.length >= 170);
  const ids = new Set();
  for (const f of world.features) {
    assert.match(f.id, /^[A-Z0-9]{3}$/);
    assert.ok(!ids.has(f.id), "duplicate " + f.id);
    ids.add(f.id);
    assert.ok(f.properties.name);
    assert.ok(["Polygon", "MultiPolygon"].includes(f.geometry.type));
    for (const r of M.outerRings(f)) {
      assert.deepEqual(r[0], r[r.length - 1], f.id + " ring not closed");
      for (const c of r) assert.ok(Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90);
    }
  }
  for (const iso of ["TUR", "GBR", "FRA", "NOR", "USA", "JPN", "BRA"]) assert.ok(ids.has(iso), iso);
});

test("projections fit the viewport and keep [lng, lat] order", () => {
  for (const type of ["mercator", "equalEarth", "equirectangular"]) {
    const land = world.features.filter((f) => f.id !== "ATA");
    const p = M.createProjection({ type, ...VIEW, fit: land, padding: 20 });
    const b = M.bounds(land, p.project);
    assert.ok(b[0][0] >= 19.99 && b[1][0] <= 1260.01, type + " x");
    assert.ok(b[0][1] >= 19.99 && b[1][1] <= 700.01, type + " y");
    const [ix, iy] = p.project([28.98, 41.01]);
    const [lx, ly] = p.project([-0.13, 51.51]);
    assert.ok(ix > lx && iy > ly, type + ": Istanbul is east and south of London");
  }
  const p = M.createProjection({
    type: "equirectangular",
    width: 360,
    height: 180,
    fit: {
      type: "MultiPoint",
      coordinates: [
        [-180, -90],
        [180, 90],
      ],
    },
  });
  assert.deepEqual(p.project([0, 0]), [180, 90]);
  assert.deepEqual(p.project([180, 90]), [360, 0]);
  assert.throws(() => p.project([41.01, 128.98]), RangeError);
});

test("the antimeridian edge stays on its own side", () => {
  const p = M.createProjection({ type: "mercator", ...VIEW });
  assert.ok(p.project([180, 60])[0] > p.project([179, 60])[0]);
  assert.ok(p.project([-180, 60])[0] < p.project([-179, 60])[0]);
});

test("great circle and distance", () => {
  const ist = [28.98, 41.01];
  const lon = [-0.13, 51.51];
  close(M.distanceKm(ist, lon), 2500, 15);
  const arc = M.greatCircle(ist, lon, 32);
  assert.equal(arc.length, 33);
  assert.deepEqual(arc[0], ist);
  assert.deepEqual(arc[32], lon);
  const half = M.distanceKm(ist, arc[16]);
  close(half, M.distanceKm(ist, lon) / 2, 0.01);
  assert.ok(arc[16][1] > (ist[1] + lon[1]) / 2, "great circle bows towards the pole");
});

test("partialPath draws by length and lands on the end", () => {
  const pts = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  assert.equal(M.partialPath(pts, 0).d, "M0 0");
  const h = M.partialPath(pts, 0.5);
  assert.deepEqual(h.head, [10, 0]);
  assert.equal(h.length, 20);
  const q = M.partialPath(pts, 0.75);
  assert.deepEqual(q.head, [10, 5]);
  assert.equal(q.angle, 90);
  assert.equal(M.partialPath(pts, 2).d, "M0 0L10 0L10 10");
});

test("camera framing and flight hit both ends exactly", () => {
  const cam = M.cameraFor(
    [
      [100, 100],
      [300, 200],
    ],
    VIEW,
    0.1,
  );
  assert.deepEqual([cam.x, cam.y], [200, 150]);
  close(cam.zoom, Math.min(1024 / 200, 576 / 100));
  const a = { x: 640, y: 360, zoom: 1 };
  const fly = M.flyTo(a, cam, VIEW);
  assert.deepEqual(fly(0), a);
  assert.deepEqual(fly(1), cam);
  assert.ok(fly(0.5).zoom > 1 && fly(0.5).zoom < cam.zoom);
  const s = M.toScreen(cam, VIEW, [200, 150]);
  assert.deepEqual(s, [640, 360]);
  assert.match(M.cameraTransform(a, VIEW), /^translate\(0 0\) scale\(1\)$/);
  const zoomOnly = M.flyTo(a, { x: 640, y: 360, zoom: 4 }, VIEW);
  close(zoomOnly(0.5).zoom, 2, 1e-9);
});

test("pathD, findFeature, stepTime and colours are deterministic", () => {
  const p = M.createProjection({ type: "mercator", ...VIEW });
  const tur = M.findFeature(world, "turkey");
  assert.equal(M.findFeature(world, "TUR"), tur);
  assert.throws(() => M.findFeature(world, "Atlantis"));
  const d = M.pathD(tur, p.project);
  assert.equal(d, M.pathD(tur, p.project));
  assert.match(d, /^M[\d.]+ [\d.]+L/);
  assert.ok(d.endsWith("Z"));
  assert.equal(M.stepTime(0.07, 30, 12), 0.0);
  assert.equal(M.stepTime(0.09, 30, 12), 0); // 30 fps holds 3 frames
  assert.equal(M.stepTime(0.1, 30, 12), 0.1);
  assert.equal(M.stepTime(0.12, 24, 12), 2 / 24);
  assert.equal(M.stepTime(1, 24, 12), 1);
  assert.equal(M.local(5, 4, 2), 0.5);
  assert.equal(M.local(9, 4, 2), 1);
  assert.equal(M.mixColor("#000000", "#ffffff", 0.5), "#808080");
});
