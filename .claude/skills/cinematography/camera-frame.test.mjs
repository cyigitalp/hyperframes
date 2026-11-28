import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "./camera-frame.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("rest camera leaves every layer untouched", () => {
  for (const depth of [300, 1000, 5000]) {
    const p = C.project({ depth }, C.REST);
    near(p.scale, 1);
    near(p.x, 0);
    assert.equal(p.blur, 0);
  }
});

test("parallax: lateral move shifts near layers more than far ones", () => {
  const cam = { ...C.REST, x: 100 };
  const near1 = C.project({ depth: 500 }, cam).x;
  const subj = C.project({ depth: 1000 }, cam).x;
  const far = C.project({ depth: 4000 }, cam).x;
  near(subj, -100);
  assert.ok(Math.abs(near1) > Math.abs(subj) && Math.abs(subj) > Math.abs(far));
});

test("dolly changes perspective, zoom does not", () => {
  const dolly = { ...C.REST, z: 500 };
  const ratioDolly =
    C.project({ depth: 1000 }, dolly).scale / C.project({ depth: 4000 }, dolly).scale;
  const zoom = { ...C.REST, zoom: 2 };
  const ratioZoom = C.project({ depth: 1000 }, zoom).scale / C.project({ depth: 4000 }, zoom).scale;
  assert.ok(ratioDolly > 1.5);
  near(ratioZoom, 1);
});

test("a layer the camera passes through is hidden", () => {
  assert.equal(C.project({ depth: 300 }, { ...C.REST, z: 400 }).visible, false);
});

test("rack focus: the focused plane is sharp, others blur", () => {
  const cam = { ...C.REST, focus: 1000, aperture: 1 };
  assert.equal(C.project({ depth: 1000 }, cam).blur, 0);
  assert.ok(C.project({ depth: 400 }, cam).blur > 1);
  assert.ok(C.project({ depth: 4000 }, cam).blur > 0.5);
  const track = C.cameraTrack(C.shots.rackFocus({ t: 1, from: 400, to: 1000 }));
  assert.equal(C.project({ depth: 400 }, track(0.5)).blur, 0);
  assert.equal(C.project({ depth: 1000 }, track(2)).blur, 0);
});

test("camera track holds, eases and carries keys over", () => {
  const track = C.cameraTrack([
    { t: 1, x: 0, z: 0 },
    { t: 3, x: 200, ease: "none" },
    { t: 4, z: 100 },
  ]);
  assert.equal(track(0).x, 0);
  near(track(2).x, 100);
  assert.equal(track(3.5).x, 200);
  assert.equal(track(9).z, 100);
});

test("deterministic: same t, same camera, any order", () => {
  const keys = C.sequence(C.shots.establish({ t0: 0, t1: 2 }), C.shots.pushIn({ t0: 2, t1: 4 }));
  const a = C.cameraTrack(keys);
  const b = C.cameraTrack(keys);
  const ts = [3.3, 0.1, 2.5, 1.7];
  assert.deepEqual(
    ts.map((t) => C.addCam(a(t), C.handheld(t))),
    ts.map((t) => C.addCam(b(t), C.handheld(t))),
  );
});

test("dolly zoom keeps the subject size and stretches the background", () => {
  const track = C.cameraTrack(C.shots.dollyZoom({ t0: 0, t1: 1, depth: 1000, dz: 400 }));
  near(C.project({ depth: 1000 }, track(1)).scale, 1, 1e-9);
  assert.ok(C.project({ depth: 4000 }, track(1)).scale < 0.9);
});

test("shot sizes and aiming", () => {
  const z = C.zForShot("close-up", { depth: 1000, height: 400 });
  near(C.project({ depth: 1000 }, { ...C.REST, z }).scale * 400, 2.0 * 1080, 1e-6);
  const aim = C.aimAt({ px: 300, py: 0, depth: 1000 }, { sx: C.thirds().upperLeft.sx });
  const p = C.project({ depth: 1000 }, { ...C.REST, ...aim });
  near(300 * p.scale + p.x, -1920 / 6, 1e-6);
});

test("narration cues and seam continuity", () => {
  const words = [
    ["So", 0, 0.2],
    ["Canada,", 0.3, 0.8],
    ["canada", 2, 2.4],
  ];
  assert.equal(C.atWord(words, "canada"), 0.3);
  assert.equal(C.atWord(words, "Canada", 2), 2);
  assert.throws(() => C.atWord(words, "Mexico"));
  const a = C.cameraTrack([
    { t: 0, x: 0 },
    { t: 2, x: 400, ease: "none" },
  ]);
  const same = C.cameraTrack([
    { t: 0, x: 400 },
    { t: 2, x: 800, ease: "none" },
  ]);
  const stop = C.cameraTrack([{ t: 0, x: 0 }]);
  assert.ok(C.seamContinuity(a, 2, same, 0).mismatch < 0.05);
  assert.ok(C.seamContinuity(a, 2, stop, 0).mismatch > 0.9);
});

test("impact shake decays to zero", () => {
  assert.equal(C.impact(0.5, 1).x, 0);
  assert.ok(Math.abs(C.impact(1.05, 1).x) + Math.abs(C.impact(1.05, 1).y) > 0);
  assert.ok(Math.abs(C.impact(2.9, 1).x) < 1e-3);
});
