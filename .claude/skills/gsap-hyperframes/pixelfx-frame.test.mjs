import { test } from "node:test";
import assert from "node:assert/strict";
import { gsap } from "gsap";
import * as pixelfx from "pixelfx";
import * as nova from "pixelfx/fx/ice/frost-nova";
import "./gsap-frame.js";
import { addPixelfxTrack } from "./pixelfx-frame.js";

const F = globalThis.HFGsapFrame;

function setup() {
  const shots = [];
  const ctx = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => shots.push(Buffer.from(img.data).toString("base64")),
  };
  const tl = F.createRootTimeline(gsap, { fps: 30, durationFrames: 90 });
  addPixelfxTrack(tl, { pixelfx, fx: nova, ctx, fps: 30, bg: 0xff140d0b });
  return { tl, shots };
}

test("pixelfx frames match whatever the seek order", () => {
  const a = setup();
  for (let f = 0; f <= 60; f++) F.seekFrame(a.tl, f, 30);
  const linear = a.shots.at(-1);
  const b = setup();
  for (const f of [80, 10, 60]) F.seekFrame(b.tl, f, 30);
  assert.equal(b.shots.at(-1), linear);
  F.seekFrame(b.tl, 0, 30);
  assert.notEqual(b.shots.at(-1), linear);
});
