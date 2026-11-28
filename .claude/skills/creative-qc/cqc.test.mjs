import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Q from "./cqc.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-"));
const ff = (args) =>
  assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", ...args]).status, 0, args.join(" "));

// 6 s at 30 fps over a still textured background: 0-2 s a still title, 2-4 s
// a still box slid rigidly across it, 4-6 s a moving patch that stretches
// and squashes every frame (what a performing character looks like to the test).
function makeFilm(file) {
  const bg = path.join(tmp, "bg.png");
  ff(["-f", "lavfi", "-i", "testsrc2=s=320x180", "-frames:v", "1", bg]);
  ff([
    "-loop",
    "1",
    "-framerate",
    "30",
    "-t",
    "6",
    "-i",
    bg,
    "-f",
    "lavfi",
    "-i",
    "color=white:s=50x50:r=30:d=6",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=120x120:r=30:d=6",
    "-filter_complex",
    [
      "[0]drawbox=x=0:y=0:w=iw:h=ih:color=0x202020:t=fill:enable='lt(t,2)'[t]",
      "[t][1]overlay=x='20+(t-2)*60':y=60:enable='between(t,2,4)'[s]",
      "[2]scale=w='trunc(50+30*sin(t*7))':h='trunc(70-30*sin(t*5))':eval=frame[m]",
      "[s][m]overlay=x='40+(t-4)*40':y=40:enable='gte(t,4)'",
    ].join(";"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    file,
  ]);
}

test("spans and texture helpers", () => {
  assert.deepEqual(
    Q.spans(10, 10, (i) => i >= 2 && i < 7, 0.4),
    [[0.2, 0.7]],
  );
  assert.deepEqual(
    Q.spans(10, 10, (i) => i === 3, 0.4),
    [],
  );
  const flat = new Uint8Array(100).fill(80);
  assert.equal(Q.textureShare(flat, 10, 10), 0);
});

test("rigid sprite test: a sliding still is explained, a deforming shape is not", () => {
  const w = 64;
  const h = 36;
  // a non-periodic texture: a periodic one lets any period-sized shift match
  const noise = Array.from(
    { length: w * h },
    (_, i) => (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1,
  );
  const bg = (x, y) => 40 + Math.round(noise[y * w + x] * 120);
  // a textured sprite; `limb` moves its top and bottom halves apart, as a
  // rigged character's parts do
  const frame = (ox, limb = 0) => {
    const f = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = y >= 16 ? ox + limb : ox - limb;
        const inBox = x >= o && x < o + 10 && y >= 10 && y < 22;
        f[y * w + x] = inBox ? 200 + (((x - o) * 5 + y * 3) % 50) : bg(x, y);
      }
    return f;
  };
  assert.ok(Q.spriteExplained(frame(12), frame(10), w, h).explained > 0.95);
  assert.ok(Q.spriteExplained(frame(12, 3), frame(10), w, h).explained < Q.T.spriteExplained);
});

test(
  "analyze measures holds, slides, cuts and caps; sheets are written",
  { skip: !hasFfmpeg },
  () => {
    const film = path.join(tmp, "film.mp4");
    makeFilm(film);
    const scenes = path.join(tmp, "scenes.json");
    fs.writeFileSync(
      scenes,
      JSON.stringify([
        { id: "title", start: 0, end: 2 },
        { id: "slide", start: 2, end: 4 },
        { id: "morph", start: 4, end: 6 },
      ]),
    );
    const { review } = Q.analyze(film, { out: path.join(tmp, "qc"), scenes });
    const kinds = review.findings.map((f) => `${f.kind}:${f.scene}`);
    assert.ok(kinds.includes("hook:title"), kinds.join(","));
    assert.ok(kinds.includes("rigid-slide:slide"), kinds.join(","));
    assert.ok(!kinds.includes("rigid-slide:morph"), kinds.join(","));
    assert.equal(review.caps.hook.cap, 2);
    assert.equal(review.caps.animation.cap, 2);
    assert.ok(review.unverified.sync && review.unverified.factual);
    assert.ok(fs.existsSync(path.join(tmp, "qc", review.sheets.contact)));
    assert.ok(fs.existsSync(path.join(tmp, "qc", review.sheets.hook)));
  },
);

test(
  "gate rejects inflated, unevidenced and unverified-but-inspectable scores",
  { skip: !hasFfmpeg },
  () => {
    const file = path.join(tmp, "qc", "review.json");
    const ev = path.join(tmp, "eval.json");
    const all = (score) =>
      Object.fromEntries(
        [
          "hook",
          "story",
          "visual-engagement",
          "animation",
          "character",
          "cinematography",
          "humor",
          "pacing",
        ].map((d) => [
          d,
          {
            score,
            evidence: [
              { t: 1, note: "x" },
              { t: 2, note: "y" },
            ],
          },
        ]),
      );
    fs.writeFileSync(ev, JSON.stringify({ evaluator: "test", dimensions: all(5) }));
    const r = Q.gate(file, { evalFile: ev });
    assert.equal(r.pass, false);
    assert.ok(r.problems.some((p) => p.startsWith("hook: 5 is over the measured cap 2")));
    assert.ok(r.problems.some((p) => /finding m\d+ \(P0/.test(p)));
    fs.writeFileSync(
      ev,
      JSON.stringify({
        evaluator: "test",
        dimensions: { ...all(2), story: { score: "unverified", notes: "lazy" } },
      }),
    );
    const r2 = Q.gate(file, { evalFile: ev });
    assert.ok(r2.problems.includes("story can always be inspected from the frames: score it"));
    assert.ok(r2.repair.includes("title") && r2.repair.includes("slide"));
    assert.ok(!r2.repair.includes("morph"));
  },
);

test("splice replaces one scene and keeps the others", { skip: !hasFfmpeg }, () => {
  const film = path.join(tmp, "film.mp4");
  const seg = path.join(tmp, "seg.mp4");
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=30:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    seg,
  ]);
  const out = path.join(tmp, "spliced.mp4");
  const r = Q.splice(film, [{ file: seg, at: 2 }], out);
  assert.equal(r.frames, 180);
  const cmp = Q.compare(film, out, "0-2,2-4,4-6");
  assert.ok(cmp[0].minPsnr > 40 && cmp[2].minPsnr > 40, JSON.stringify(cmp));
  assert.ok(cmp[1].meanPsnr < 20);
  assert.throws(() => Q.splice(film, [{ file: seg, at: 5 }], out), /past the end/);
});

test("mergeEval matches findings by kind and scene", () => {
  const rv = {
    dimensions: [{ id: "hook", score: null }],
    findings: [{ id: "m1", kind: "static", scene: "a", status: "open" }],
  };
  const m = Q.mergeEval(rv, {
    evaluator: "e",
    dimensions: { hook: { score: 3 } },
    findings: [{ match: { kind: "static", scene: "a" }, status: "accepted", reason: "deliberate" }],
    add: [{ t: 1, severity: "P1", problem: "p" }],
  });
  assert.equal(m.dimensions[0].score, 3);
  assert.equal(m.findings[0].status, "accepted");
  assert.equal(m.findings[1].source, "evaluator");
  assert.equal(rv.findings[0].status, "open");
});
