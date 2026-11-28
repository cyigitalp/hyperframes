import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "./sfx-frame.js";
const C = {
  fps: 30,
  duration: 4,
  cues: { hit: { at: 1, frame: 30 }, rise: { at: 2.5, frame: 75 } },
};
function fakeTl() {
  const calls = [];
  return {
    calls,
    add: (tw, t) => calls.push(["add", tw, t]),
    set: (tg, v, t) => calls.push(["set", tg, v, t]),
    to: (tg, v, t) => calls.push(["to", tg, v, t]),
  };
}
test("time and frame come from the cue frame", () => {
  assert.equal(S.time("hit", 0, C), 1);
  assert.equal(S.time("hit", -6, C), 0.8);
  assert.equal(S.frame("rise", C), 75);
});
test("land ends a tween on the cue, or starts it there", () => {
  const tl = fakeTl();
  assert.equal(
    S.land(tl, "hit", 9, (d) => ({ d }), null, C),
    0.7,
  );
  assert.deepEqual(tl.calls[0], ["add", { d: 0.3 }, 0.7]);
  assert.equal(
    S.land(tl, "hit", 9, (d) => ({ d }), { start: true }, C),
    1,
  );
});
test("hit sets on the frame and eases off from the next", () => {
  const tl = fakeTl();
  S.hit(tl, "rise", "#f", { opacity: 1 }, { opacity: 0 }, C);
  assert.deepEqual(tl.calls[0], ["set", "#f", { opacity: 1 }, 2.5]);
  assert.equal(tl.calls[1][3], 2.5 + 1 / 30);
});
test("unknown cues and missing cue files fail loudly", () => {
  assert.throws(() => S.time("nope", 0, C), /no cue "nope"/);
  assert.throws(() => S.cues(undefined), /load sfx\/cues.js/);
  assert.throws(() => S.land(fakeTl(), "hit", 40, () => ({}), null, C), /before 0/);
});
