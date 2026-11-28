import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "./rig-frame.js";
import { pip } from "./characters/pip.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const performance = () =>
  R.createRig(pip(), { place: { x: 300, y: 900, scale: 0.8 } })
    .add(R.walk({ start: 0, steps: 4, stepDur: 0.5, stride: 100 }))
    .add(R.blink({ start: 0, end: 6, seed: 4 }))
    .add(R.look({ start: 2.1, dx: -1 }))
    .add(R.gesture({ start: 2.4, type: "wave", side: "R" }))
    .add(
      R.talk({
        words: [
          ["Hello", 2.5, 2.9],
          ["there!", 3.0, 3.5],
        ],
      }),
    )
    .add(R.expression({ start: 2.0, emotion: "happy" }))
    .add(R.take({ start: 4.0, kind: "double-take", dir: -1 }))
    .follow("tuft", "head");

test("two-bone IK reaches a reachable target", () => {
  const ik = R.solveTwoBone([0, 0], [100, 50], 80, 80);
  const elbow = [80 * Math.cos((ik.a1 * Math.PI) / 180), 80 * Math.sin((ik.a1 * Math.PI) / 180)];
  const hand = [
    elbow[0] + 80 * Math.cos((ik.a2 * Math.PI) / 180),
    elbow[1] + 80 * Math.sin((ik.a2 * Math.PI) / 180),
  ];
  near(hand[0], 100, 1e-6);
  near(hand[1], 50, 1e-6);
  assert.equal(ik.reach, true);
});

test("pose is a pure function of time: any seek order gives the same pose", () => {
  const a = performance();
  const b = performance();
  const times = [0, 0.37, 1.9, 2.66, 3.2, 4.55, 5.9];
  const fwd = times.map((t) => JSON.stringify(a.matrices(t)));
  const rev = [...times]
    .reverse()
    .map((t) => JSON.stringify(b.matrices(t)))
    .reverse();
  assert.deepEqual(fwd, rev);
});

test("walk travels stride per step and flips facing with dir", () => {
  const rig = R.createRig(pip()).add(
    R.walk({ start: 1, steps: 4, stepDur: 0.5, stride: 100, dir: -1 }),
  );
  assert.equal(rig.travel(0.5).x, 0);
  near(rig.travel(2).x, -200);
  near(rig.travel(10).x, -400); // travel persists after the walk
  assert.equal(rig.travel(2).facing, -1);
  assert.ok(rig.rootMatrix(2)[0] < 0, "mirrored on stage");
});

test("independent body parts move at once (not a rigid slide)", () => {
  const rig = performance();
  const p0 = rig.pose(0.6);
  const moving = Object.entries(p0)
    .filter(([, c]) => Math.abs(c.r) > 1 || Math.abs(c.y) > 1)
    .map(([id]) => id);
  for (const id of ["thighL", "thighR", "upperArmL", "upperArmR", "body"])
    assert.ok(moving.includes(id), id);
  assert.ok(moving.length >= 6, moving.join(","));
});

test("talk picks visemes from word timings, mouth rests between words", () => {
  const rig = performance();
  assert.deepEqual(R.visemes("Bob"), ["mbp", "round", "mbp"]);
  assert.deepEqual(R.visemes("Hello"), ["wide", "teeth", "round"]);
  assert.equal(rig.pose(2.52).mouth.v, "wide");
  assert.equal(rig.pose(2.95).mouth.v, "rest");
});

test("blinks are seeded and close the lids", () => {
  const b = R.blink({ start: 0, end: 20, seed: 9 });
  assert.deepEqual(b.times, R.blink({ start: 0, end: 20, seed: 9 }).times);
  assert.ok(b.times.length >= 4);
  const rig = R.createRig(pip()).add(R.blink({ start: 0, end: 5, at: [1] }));
  assert.ok(rig.pose(1.06).lidL.sy > 0.8);
  assert.ok(rig.pose(0.5).lidL.sy < 0.05);
});

test("expressions crossfade in their channel", () => {
  const rig = R.createRig(pip())
    .add(R.expression({ start: 0, emotion: "happy" }))
    .add(R.expression({ start: 2, emotion: "sad" }));
  assert.equal(rig.pose(1).mouth.v, "smile");
  assert.equal(rig.pose(3).mouth.v, "frown");
});

test("reach puts the wrist on the target and the prop follows the hand", () => {
  const target = [380, 320];
  const rig = R.createRig(pip(), { place: { x: 500, y: 800, scale: 1 } }).add(
    R.reach({ start: 0, target, side: "R", dur: 0.4, hold: 1 }),
  );
  const wrist = R.M.apply(R.M.inv(rig.rootMatrix(0.8)), rig.pointOn(0.8, "handR"));
  near(wrist[0], target[0], 0.5);
  near(wrist[1], target[1], 0.5);
  const rest = R.M.t(100, 100);
  const m1 = R.propMatrix(rig, 0.2, { role: "handR", rest, grab: 0.6 });
  assert.deepEqual(m1, rest);
  const at = R.propMatrix(rig, 0.6, { role: "handR", rest, grab: 0.6 });
  near(at[4], 100, 1e-6);
  const later = R.propMatrix(rig, 1.7, { role: "handR", rest, grab: 0.6 });
  assert.ok(Math.hypot(later[4] - 100, later[5] - 100) > 5, "prop moved with the returning hand");
});

test("secondary motion: the tuft lags behind a moving head", () => {
  const rig = R.createRig(pip())
    .add(R.run({ start: 0, steps: 6 }))
    .follow("tuft", "head");
  const base = rig.basePose(0.9).tuft.r;
  const full = rig.pose(0.9).tuft.r;
  assert.notEqual(full, base);
});

test("perform builds clips from scenes.json actions", () => {
  const rig = R.perform(R.createRig(pip()), [
    { preset: "walk", start: 0, steps: 2 },
    { preset: "gesture", start: 1, type: "point", side: "L" },
  ]);
  assert.equal(rig.clips.length, 2);
  assert.throws(() => R.perform(rig, [{ preset: "moonwalk" }]));
});
