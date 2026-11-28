import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indexManifest,
  anchorOf,
  fitSprite,
  parallax,
  parallaxTransform,
  lerpCam,
  anchorOnStage,
} from "./cutout-frame.js";

const item = {
  name: "hero",
  width: 400,
  height: 300,
  bbox: [100, 50, 300, 250],
  trim: { x: 92, y: 42, width: 216, height: 216 },
  centroid: [200, 150],
  foot: [210, 250],
  files: { trim: { path: "hero.trim.png" }, cutout: { path: "hero.png" } },
};

test("indexManifest resolves urls and rejects unknown names", () => {
  const m = indexManifest({ items: [item] }, "assets/cutouts/");
  assert.deepEqual(m.names, ["hero"]);
  assert.equal(m.url("hero"), "assets/cutouts/hero.trim.png");
  assert.equal(m.url("hero", "cutout"), "assets/cutouts/hero.png");
  assert.throws(() => m.get("nope"), /no cutout named/);
  assert.throws(() => m.url("hero", "plate"), /no plate/);
});

test("anchors", () => {
  assert.deepEqual(anchorOf(item), { x: 210, y: 250 });
  assert.deepEqual(anchorOf(item, "center"), { x: 200, y: 150 });
  assert.deepEqual(anchorOf(item, "centroid"), { x: 200, y: 150 });
});

test("fitSprite puts the foot on the target and sizes the subject", () => {
  const r = fitSprite(item, { x: 640, y: 700, height: 400 });
  assert.equal(r.scale, 2);
  assert.equal(r.width, 432);
  const foot = anchorOnStage(item, r);
  assert.ok(Math.abs(foot.x - 640) < 1e-9 && Math.abs(foot.y - 700) < 1e-9);
  // subject bottom edge = foot y; subject top = 700 - 400
  assert.ok(Math.abs(r.top + (item.bbox[1] - item.trim.y) * r.scale - 300) < 1e-9);
});

test("parallax scales with depth", () => {
  const cam = { x: 100, y: -20, zoom: 1.2 };
  assert.deepEqual(parallax(0, cam), { x: -0, y: 0, scale: 1 });
  const p = parallax(0.5, cam);
  assert.equal(p.x, -50);
  assert.equal(p.y, 10);
  assert.ok(Math.abs(p.scale - 1.1) < 1e-12);
  assert.match(
    parallaxTransform(1, cam, { x: 5 }),
    /^translate\(-95\.00px, 20\.00px\) scale\(1\.2000\)/,
  );
});

test("lerpCam is linear and fills defaults", () => {
  assert.deepEqual(lerpCam({ x: 0 }, { x: 10, zoom: 2 }, 0.5), { x: 5, y: 0, zoom: 1.5 });
});
