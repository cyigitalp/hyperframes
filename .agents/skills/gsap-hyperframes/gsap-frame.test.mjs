import { test } from "node:test";
import assert from "node:assert/strict";
import { gsap } from "gsap";
import "./gsap-frame.js";

const F = globalThis.HFGsapFrame;

test("frame/time conversions are drift tolerant", () => {
  assert.equal(F.frameToTime(30, 30), 1);
  assert.equal(F.timeToFrame(0.1 + 0.2, 10), 3);
  assert.equal(F.timeToFrame(F.frameToTime(59, 60), 60), 59);
  assert.equal(F.snapTime(0.51, 30), 15 / 30);
  assert.throws(() => F.frames(1, 0));
});

test("root timeline is paused and padded", () => {
  const tl = F.createRootTimeline(gsap, { fps: 30, durationFrames: 90 });
  assert.equal(tl.paused(), true);
  assert.equal(tl.duration(), 3);
});

test("seekFrame lands exact tween values and drives render tracks", () => {
  const tl = F.createRootTimeline(gsap, { fps: 30, durationFrames: 60 });
  const box = { x: 0 };
  tl.to(box, { x: 60, duration: 2, ease: "none" }, 0);
  const seen = [];
  F.addRenderTrack(tl, (t) => seen.push(t), { duration: 2 });
  for (const f of [45, 15, 30]) {
    F.seekFrame(tl, f, 30);
    assert.ok(Math.abs(box.x - f) < 1e-9);
    assert.ok(Math.abs(seen.at(-1) - f / 30) < 1e-9);
  }
});

test("seededRandom is reproducible", () => {
  const a = F.seededRandom(7);
  const b = F.seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
