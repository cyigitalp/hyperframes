#!/usr/bin/env node
// cqc.mjs: creative quality control on a RENDERED video. Node 18+ and ffmpeg,
// no other dependency. Measures what can be measured from the pixels and the
// sound, writes sheets for an evaluator to look at, caps scores the
// measurements contradict, gates delivery, and splices re-rendered scenes into
// the final cut without re-rendering the rest.
//
//   analyze VIDEO --out DIR [--scenes scenes.json] [--words words.json]
//           [--thumbnail png --thumb-text "Two Words"] [--research research.md]
//           [--project DIR] [--fps 10]
//   gate REVIEW.json [--eval EVAL.json] [--project DIR] [--min 3] [--hook-min 4]
//   splice BASE.mp4 SEG.mp4@SECONDS [SEG2.mp4@SECONDS ...] --out OUT.mp4
//   compare A.mp4 B.mp4 [--ranges 0-3,6-9]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXIT = { ok: 0, fail: 1, usage: 2 };

// ---- thresholds (one place, documented in SKILL.md) -------------------------
export const T = {
  stillDiff: 0.0025, // mean |Δ| per sample below this = nothing moves
  stillScene: 0.5, // a scene still for more than this share of its length is "mostly static"
  texture: 0.55, // share of textured pixels that reads as photographic / painted media
  holdMin: 1.2, // s of stillness that counts as a static hold
  hookMotion: 0.004, // first visible change
  kenBurnsShare: 0.92, // share of motion explained by one camera transform
  kenBurnsMin: 2.5, // s of camera-only motion on a still that gets flagged
  spriteExplained: 0.915, // running median share of changed pixels one shift explains = rigid slide
  spriteMin: 0.8, // s
  similar: 0.93, // signature correlation that counts as the same composition
  beatWindow: 0.25, // s around a narration beat to find a visual event
  longShot: 12, // s
};

// ---- small utils ------------------------------------------------------------

function run(cmd, args, { input, maxBuffer = 1 << 30 } = {}) {
  const r = spawnSync(cmd, args, { input, maxBuffer, encoding: "buffer" });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr.toString() };
}

export function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  if (r.code !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout.toString());
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const [n, d] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: d ? n / d : 0,
    duration: Number(j.format?.duration ?? v?.duration ?? 0),
    frames: Number(v?.nb_frames ?? 0),
    codec: v?.codec_name,
    audio: Boolean(a),
  };
}

/** Decode a video into raw frames: { w, h, n, data } (gray or rgb24). */
export function decode(file, { fps = 10, w = 96, h = 54, fmt = "gray" } = {}) {
  const r = run("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `${fps ? `fps=${fps},` : ""}scale=${w}:${h}:flags=area,format=${fmt}`,
    "-f",
    "rawvideo",
    "-",
  ]);
  if (r.code !== 0) throw new Error(`ffmpeg decode: ${r.stderr}`);
  const bpp = fmt === "rgb24" ? 3 : 1;
  const size = w * h * bpp;
  return { w, h, n: Math.floor(r.stdout.length / size), data: r.stdout, size, fps };
}

const frameAt = (v, i) => v.data.subarray(i * v.size, (i + 1) * v.size);

function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
}

/**
 * Best single camera transform (shift + uniform scale about the centre)
 * mapping frame b onto a: returns the residual mean |Δ| (0-1). Motion that a
 * transform explains is camera motion on a still; the rest is subject motion.
 */
export function globalResidual(a, b, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const m = 5;
  let best = Infinity;
  for (const s of [0.96, 0.98, 1, 1.02, 1.04])
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        let sum = 0;
        let n = 0;
        for (let y = m; y < h - m; y += 1) {
          const sy = Math.round(cy + (y - cy) / s - dy);
          if (sy < 0 || sy >= h) continue;
          for (let x = m; x < w - m; x += 1) {
            const sx = Math.round(cx + (x - cx) / s - dx);
            if (sx < 0 || sx >= w) continue;
            sum += Math.abs(a[y * w + x] - b[sy * w + sx]);
            n++;
          }
        }
        const r = sum / Math.max(1, n) / 255;
        if (r < best) best = r;
      }
  return best;
}

/**
 * Rigid-sprite test: of the pixels that changed, the share one translation
 * (half-pixel steps, bilinear) explains, as arrival or departure of the picture. ~1 = a still picture sliding; a
 * performing character, whose parts move differently, is lower.
 */
export function spriteExplained(a, b, w, h, { tol = 16, thr = 18, range = 12 } = {}) {
  const changed = [];
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) changed.push(i);
  const frac = changed.length / a.length;
  if (frac < 0.003 || frac > 0.5) return { frac, explained: 0, shift: [0, 0] };
  // a sprite slides over a background that stays put: the change is local.
  // Change spread over most of the frame is a camera move, not a sprite.
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (const i of changed) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (w * h);
  if (area > 0.45) return { frac, explained: 0, shift: [0, 0], area };
  const sample = (f, x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return null;
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * w + x0;
    return (
      (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fy) + (f[i + w] * (1 - fx) + f[i + w + 1] * fx) * fy
    );
  };
  let best = 0;
  let bestS = [0, 0];
  for (let dy = -range / 2; dy <= range / 2; dy += 0.5)
    for (let dx = -range; dx <= range; dx += 0.5) {
      if (!dx && !dy) continue;
      let ok = 0;
      // a changed pixel is explained if it is where the picture arrived
      // (a(p) = b(p - s)) or where it left (b(p) = a(p + s))
      for (const i of changed) {
        const x = i % w;
        const y = (i / w) | 0;
        const now = sample(b, x - dx, y - dy);
        if (now != null && Math.abs(a[i] - now) <= tol) {
          ok++;
          continue;
        }
        const was = sample(a, x + dx, y + dy);
        if (was != null && Math.abs(b[i] - was) <= tol) ok++;
      }
      const e = ok / changed.length;
      if (e > best) {
        best = e;
        bestS = [dx, dy];
      }
    }
  return { frac, explained: best, shift: bestS };
}

/** Spans [t0, t1] where pred(i) holds for at least `min` seconds. */
export function spans(n, fps, pred, min) {
  const out = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && pred(i);
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      const t0 = s / fps;
      const t1 = i / fps;
      if (t1 - t0 >= min - 1e-9) out.push([+t0.toFixed(2), +t1.toFixed(2)]);
      s = -1;
    }
  }
  return out;
}

/** Share of pixels whose 3x3 neighbourhood varies: flat vector art is low, photos high. */
export function textureShare(f, w, h, thr = 5) {
  let n = 0;
  let on = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let s = 0;
      let s2 = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const v = f[(y + dy) * w + x + dx];
          s += v;
          s2 += v * v;
        }
      const sd = Math.sqrt(Math.max(0, s2 / 9 - (s / 9) ** 2));
      n++;
      if (sd > thr) on++;
    }
  return on / n;
}

function corr(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : da === db ? 1 : 0;
}

function std(arr) {
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

export function readWords(file) {
  if (!file) return null;
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const arr = Array.isArray(j) ? j : (j.words ?? []);
  return arr.map((w) =>
    Array.isArray(w)
      ? { word: w[0], start: w[1], end: w[2] }
      : { word: w.word ?? w.text, start: w.start, end: w.end },
  );
}

export function readScenes(file) {
  if (!file) return null;
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const arr = Array.isArray(j) ? j : (j.scenes ?? []);
  return arr.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end));
}

function sceneAt(scenes, t) {
  return scenes?.find((s) => t >= s.start - 1e-6 && t < s.end)?.id ?? null;
}

// ---- audio ------------------------------------------------------------------

export function audioStats(file) {
  const r = run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    "ebur128=peak=true,silencedetect=noise=-45dB:d=0.5",
    "-f",
    "null",
    "-",
  ]);
  const e = r.stderr;
  const sum = e.slice(e.lastIndexOf("Summary:"));
  const num = (re) => {
    const m = sum.match(re);
    return m ? Number(m[1]) : null;
  };
  const silences = [];
  const re = /silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g;
  let m;
  while ((m = re.exec(e))) silences.push([Number(m[1]), Number(m[2])]);
  const trailing = /silence_start: ([\d.]+)(?![\s\S]*silence_end)/.exec(e);
  if (trailing) silences.push([Number(trailing[1]), null]);
  return {
    integratedLufs: num(/I:\s+(-?[\d.]+) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/),
    silences,
  };
}

// ---- sheets -----------------------------------------------------------------

function grabFrames(video, times, dir, prefix, width = 480) {
  const files = [];
  times.forEach((t, i) => {
    const f = path.join(dir, `${prefix}-${String(i).padStart(3, "0")}.png`);
    const r = run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-ss",
      String(Math.max(0, t)),
      "-i",
      video,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:-2`,
      f,
    ]);
    if (r.code === 0 && fs.existsSync(f)) files.push(f);
  });
  return files;
}

function tile(files, out, cols) {
  if (!files.length) return null;
  const rows = Math.ceil(files.length / cols);
  const list = path.join(path.dirname(out), `.${path.basename(out)}.txt`);
  // pad with the last frame so the grid is full
  const padded = [...files];
  while (padded.length < rows * cols) padded.push(files[files.length - 1]);
  fs.writeFileSync(list, padded.map((f) => `file '${path.resolve(f)}'`).join("\n"));
  const r = run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `tile=${cols}x${rows}:padding=6:color=white`,
    "-frames:v",
    "1",
    out,
  ]);
  fs.rmSync(list, { force: true });
  for (const f of files) fs.rmSync(f, { force: true });
  return r.code === 0 ? out : null;
}

// ---- analyze ----------------------------------------------------------------

export const DIMENSIONS = [
  ["hook", "Opening hook (first 1-3 s)"],
  ["story", "Storytelling and narrative progression"],
  ["visual-engagement", "Visual engagement and variety"],
  ["animation", "Animation quality and natural movement"],
  ["character", "Character expressiveness"],
  ["cinematography", "Cinematography"],
  ["humor", "Visual humor"],
  ["pacing", "Pacing and transitions"],
  ["sync", "Narration and visual synchronization"],
  ["audio-mix", "Music and sound-effect balance"],
  ["factual", "Factual accuracy"],
  ["thumbnail", "Thumbnail effectiveness"],
];
// Always inspectable from frames and sheets: never "unverified".
export const MUST_VERIFY = [
  "hook",
  "story",
  "visual-engagement",
  "animation",
  "cinematography",
  "pacing",
];

export function analyze(video, opts = {}) {
  const out = opts.out ?? path.join(path.dirname(video), "qc");
  fs.mkdirSync(out, { recursive: true });
  const info = probe(video);
  const fps = Number(opts.fps ?? 10);
  const scenes = readScenes(opts.scenes);
  const words = readWords(opts.words);

  // motion
  const g = decode(video, { fps, w: 96, h: 54 });
  const s = decode(video, { fps, w: 160, h: 90 });
  const c = decode(video, { fps, w: 16, h: 9, fmt: "rgb24" });
  const n = Math.min(g.n, s.n, c.n);
  const diff = new Array(n).fill(0);
  const rigid = new Array(n).fill(0);
  const sprite = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const a = frameAt(g, i);
    const b = frameAt(g, i - 1);
    diff[i] = meanAbsDiff(a, b);
    if (diff[i] > T.stillDiff) {
      const res = globalResidual(a, b, g.w, g.h);
      rigid[i] = Math.max(0, Math.min(1, 1 - res / diff[i]));
      if (rigid[i] < T.kenBurnsShare)
        sprite[i] = spriteExplained(frameAt(s, i), frameAt(s, i - 1), s.w, s.h).explained;
    }
  }
  diff[0] = diff[1] ?? 0;
  // running median over 5 samples: one lucky frame neither makes nor breaks a slide
  const spriteMed = sprite.map((_, i) => {
    const w = sprite.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    return w[w.length >> 1];
  });

  // cuts
  const cr = run("ffmpeg", [
    "-hide_banner",
    "-i",
    video,
    "-vf",
    "scale=320:-2,select='gt(scene,0.3)',showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const cuts = [...cr.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => +Number(m[1]).toFixed(3));

  const step = 1 / fps;
  const holds = spans(n, fps, (i) => diff[i] < T.stillDiff, T.holdMin).filter(
    ([t0, t1]) =>
      !(scenes ?? []).some((sc) => sc.hold && t0 >= sc.start - step && t1 <= sc.end + step),
  );
  const kenBurns = spans(
    n,
    fps,
    (i) => diff[i] >= T.stillDiff && rigid[i] >= T.kenBurnsShare,
    T.kenBurnsMin,
  );
  const slides = spans(n, fps, (i) => spriteMed[i] >= T.spriteExplained, T.spriteMin);

  // units: scenes if given, else shots between cuts
  const bounds = scenes
    ? scenes.map((sc) => ({ id: sc.id, start: sc.start, end: Math.min(sc.end, info.duration) }))
    : [0, ...cuts, info.duration]
        .reduce(
          (acc, t, i, arr) => (i ? [...acc, { id: `shot${i}`, start: arr[i - 1], end: t }] : acc),
          [],
        )
        .filter((u) => u.end - u.start > 0.05);
  const units = bounds.map((u) => {
    const i0 = Math.max(1, Math.floor(u.start * fps) + 1);
    const i1 = Math.min(n - 1, Math.ceil(u.end * fps) - 1);
    const idx = [];
    for (let i = i0; i <= i1; i++) idx.push(i);
    const mid = Math.min(n - 1, Math.floor(((u.start + u.end) / 2) * fps));
    const sig = Array.from(frameAt(c, mid)).map((v) => v / 255);
    const lum = [];
    for (let k = 0; k < sig.length; k += 3)
      lum.push(0.299 * sig[k] + 0.587 * sig[k + 1] + 0.114 * sig[k + 2]);
    const share = (p) => (idx.length ? idx.filter(p).length / idx.length : 0);
    const texture = textureShare(frameAt(s, mid), s.w, s.h);
    return {
      id: u.id,
      start: +u.start.toFixed(2),
      end: +u.end.toFixed(2),
      motion: +(idx.reduce((a, i) => a + diff[i], 0) / Math.max(1, idx.length)).toFixed(4),
      stillShare: +share((i) => diff[i] < T.stillDiff).toFixed(2),
      cameraOnlyShare: +share((i) => diff[i] >= T.stillDiff && rigid[i] >= T.kenBurnsShare).toFixed(
        2,
      ),
      rigidSlideShare: +share((i) => spriteMed[i] >= T.spriteExplained).toFixed(2),
      texture: +texture.toFixed(2),
      signature: lum,
      color: [0, 1, 2].map(
        (ch) =>
          +(
            sig.filter((_, k) => k % 3 === ch).reduce((a, v) => a + v, 0) /
            (sig.length / 3)
          ).toFixed(3),
      ),
    };
  });
  const repeats = [];
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++) {
      const r = corr(units[i].signature, units[j].signature);
      const dc = Math.hypot(...units[i].color.map((v, k) => v - units[j].color[k]));
      if (r >= T.similar && dc < 0.08)
        repeats.push({ a: units[i].id, b: units[j].id, corr: +r.toFixed(3) });
    }
  const lumMeans = units.map((u) => u.color.reduce((a, v) => a + v, 0) / 3);
  const lumStd = units.length > 1 ? std(lumMeans) : 0;

  // hook
  const first = frameAt(g, 0);
  const firstStd = std(Array.from(first).map((v) => v / 255));
  const firstMotion = (() => {
    for (let i = 1; i < n; i++) if (diff[i] > T.hookMotion) return +(i / fps).toFixed(2);
    return null;
  })();
  const hookIdx = diff.slice(1, Math.min(n, 3 * fps + 1));
  const audio = info.audio ? audioStats(video) : null;
  const speechOnset = audio
    ? audio.silences.length && audio.silences[0][0] <= 0.05
      ? audio.silences[0][1]
      : 0
    : null;
  const hook = {
    firstFrameFlat: firstStd < 0.04,
    firstFrameStd: +firstStd.toFixed(3),
    firstMotion,
    motionShare0to3: +(
      hookIdx.filter((d) => d >= T.stillDiff).length / Math.max(1, hookIdx.length)
    ).toFixed(2),
    cutsIn0to3: cuts.filter((t) => t < 3).length,
    soundOnset: speechOnset,
  };

  // sync
  let sync = null;
  if (words?.length) {
    const bounds2 = words.flatMap((w) => [w.start, w.end]);
    const nearestB = (t) => Math.min(...bounds2.map((b) => Math.abs(b - t)));
    const events = (t) => {
      const i0 = Math.max(1, Math.floor((t - T.beatWindow) * fps));
      const i1 = Math.min(n - 1, Math.ceil((t + T.beatWindow) * fps));
      const base = diff.slice(Math.max(1, i0 - 10), i0);
      const med = base.length ? [...base].sort((a, b) => a - b)[base.length >> 1] : 0;
      let ev = cuts.some((ct) => Math.abs(ct - t) <= T.beatWindow);
      for (let i = i0; i <= i1 && !ev; i++)
        if (diff[i] > Math.max(T.hookMotion, med * 2)) ev = true;
      return ev;
    };
    const beats = [];
    for (const sc of scenes ?? [])
      for (const b of sc.beats ?? []) {
        let t = b.t;
        if (t == null && b.word) {
          const norm = (x) =>
            String(x)
              .toLowerCase()
              .replace(/[^\p{L}\p{N}$%]+/gu, "");
          const hits = words.filter((w) => norm(w.word) === norm(b.word));
          t = hits[(b.n ?? 1) - 1]?.start;
        }
        if (t == null)
          beats.push({
            scene: sc.id,
            beat: b.word ?? b.what,
            t: null,
            event: false,
            note: "word not in timings",
          });
        else
          beats.push({ scene: sc.id, beat: b.word ?? b.what, t: +t.toFixed(2), event: events(t) });
      }
    sync = {
      cutsMidWord: cuts
        .filter((t) => words.some((w) => t > w.start + 0.08 && t < w.end - 0.08))
        .map((t) => +t.toFixed(2)),
      cutToWordBoundary: cuts.map((t) => +nearestB(t).toFixed(2)),
      beats,
      narrationStart: words[0].start,
      narrationEnd: words[words.length - 1].end,
      videoEnd: info.duration,
    };
  }

  // sound mix (stems and narration margin come from sound-effects when present)
  let mix = null;
  if (opts.project && fs.existsSync(path.join(opts.project, "sfx", "manifest.json"))) {
    const sfx = path.join(HERE, "..", "sound-effects", "sfx.sh");
    const r = run("bash", [sfx, "check", opts.project, "--render", video, "--json"]);
    try {
      mix = JSON.parse(r.stdout.toString());
    } catch {
      mix = { error: r.stderr.slice(-400) };
    }
  }

  // thumbnail
  let thumb = null;
  if (opts.thumbnail) {
    const ti = probe(opts.thumbnail);
    const words3 = String(opts.thumbText ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const tg = decode(opts.thumbnail, { fps: 0, w: 64, h: 36 });
    const px = Array.from(frameAt(tg, 0)).sort((a, b) => a - b);
    const contrast = (px[Math.floor(px.length * 0.95)] - px[Math.floor(px.length * 0.05)]) / 255;
    run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      opts.thumbnail,
      "-vf",
      "scale=360:-2",
      path.join(out, "thumb-phone.png"),
    ]);
    thumb = {
      width: ti.width,
      height: ti.height,
      text: opts.thumbText ?? null,
      words: words3,
      contrast: +contrast.toFixed(2),
    };
  }

  // sheets
  const contactTimes = units.flatMap((u) => [
    u.start + Math.min(0.25, (u.end - u.start) / 4),
    (u.start + u.end) / 2,
  ]);
  const sheets = {
    contact: tile(grabFrames(video, contactTimes, out, "c"), path.join(out, "contact.png"), 4),
    hook: tile(
      grabFrames(
        video,
        [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3].filter((t) => t < info.duration),
        out,
        "h",
      ),
      path.join(out, "hook.png"),
      3,
    ),
    motion: [],
  };
  const flagged = [
    ...holds.map((x) => ["hold", x]),
    ...kenBurns.map((x) => ["camera-only", x]),
    ...slides.map((x) => ["rigid-slide", x]),
  ];
  flagged.forEach(([kind, [t0, t1]], k) => {
    const ts = [0, 1, 2, 3, 4, 5].map((j) => t0 + ((t1 - t0) * j) / 5 - (j === 5 ? 0.05 : 0));
    const f = tile(
      grabFrames(video, ts, out, `m${k}`, 320),
      path.join(out, `motion-${k}-${kind}.png`),
      6,
    );
    if (f) sheets.motion.push({ kind, span: [t0, t1], file: path.basename(f) });
  });
  for (const k of Object.keys(sheets))
    if (typeof sheets[k] === "string") sheets[k] = path.basename(sheets[k]);

  // findings the measurements already support (the evaluator confirms or rejects each)
  const findings = [];
  const add = (t, sev, problem, fix, kind, at = t) =>
    findings.push({
      id: `m${findings.length + 1}`,
      t,
      scene: at == null ? null : sceneAt(scenes, at),
      severity: sev,
      source: "measured",
      kind,
      problem,
      fix,
      status: "open",
    });
  if (hook.firstFrameFlat)
    add(
      0,
      "P0",
      "first frame is flat or empty",
      "open on the subject already in motion; no blank or title-only first frame",
      "hook",
    );
  if (hook.firstMotion == null || hook.firstMotion > 1)
    add(
      0,
      "P0",
      `nothing moves until ${hook.firstMotion ?? "the end"} s`,
      "start mid-action: the hook moves within the first second",
      "hook",
    );
  if (hook.soundOnset != null && hook.soundOnset > 1.5)
    add(
      0,
      "P1",
      `sound starts at ${hook.soundOnset} s`,
      "the first word or a sound lands before 1.5 s",
      "hook",
    );
  for (const [t0, t1] of holds)
    add(
      t0,
      t1 - t0 >= 2 ? "P1" : "P2",
      `static hold ${t0}-${t1} s (${(t1 - t0).toFixed(1)} s with nothing moving)`,
      "give the beat a motivated move, a reveal or a cut; mark a deliberate hold with hold:true in scenes.json",
      "static",
      (t0 + t1) / 2,
    );
  for (const [t0, t1] of kenBurns)
    add(
      t0,
      "P2",
      `${t0}-${t1} s: only a camera move over a still picture`,
      "animate something inside the frame (a subject, an annotation, the environment) or cut sooner",
      "camera-only",
      (t0 + t1) / 2,
    );
  for (const [t0, t1] of slides)
    add(
      t0,
      "P1",
      `${t0}-${t1} s: an element slides as one rigid picture`,
      "replace the slide with a rig performance (character-animation) or a layered cut-out with independent parts",
      "rigid-slide",
      (t0 + t1) / 2,
    );
  for (const r of repeats)
    add(
      units.find((u) => u.id === r.b)?.start ?? null,
      "P2",
      `${r.b} repeats the composition of ${r.a} (corr ${r.corr})`,
      "change framing, scale or treatment of one of them",
      "repeat",
    );
  for (const u of units)
    if (u.stillShare > T.stillScene && !(scenes ?? []).find((sc) => sc.id === u.id)?.hold)
      add(
        u.start,
        "P1",
        `${u.id}: nothing moves for ${Math.round(u.stillShare * 100)}% of its ${(u.end - u.start).toFixed(1)} s`,
        "keep something performing through the scene (a subject, the camera, the environment); cut sooner",
        "static",
      );
  const textured = units.filter((u) => u.texture >= T.texture);
  if (info.duration > 20 && units.length >= 3 && textured.length === 0)
    add(
      null,
      "P2",
      "no scene shows photographic or textured media (texture proxy): every frame looks like flat graphics",
      "use authentic photos or footage where the story is about real things (visual-director)",
      "media",
    );
  const longest = units.reduce((m, u) => Math.max(m, u.end - u.start), 0);
  if (!scenes && longest > T.longShot)
    add(null, "P2", `longest shot ${longest.toFixed(1)} s`, "cut or move inside it", "pacing");
  for (const b of sync?.beats ?? [])
    if (!b.event && b.t != null)
      add(
        b.t,
        "P2",
        `beat "${b.beat}" at ${b.t} s has no visual event within ${T.beatWindow} s`,
        "land a cut, a move or a reveal on the word",
        "sync",
      );
  if (audio && audio.truePeak != null && audio.truePeak > -1)
    add(null, "P1", `true peak ${audio.truePeak} dBTP`, "limit to -1 dBTP", "audio");
  if (mix?.voice_margin_lu != null && mix.voice_margin_lu < 6)
    add(
      mix.voice_margin_at_s ?? null,
      "P1",
      `narration only ${mix.voice_margin_lu} LU over the bed`,
      "duck the music and effects under the voice",
      "audio",
    );
  if (thumb && thumb.words > 3)
    add(null, "P0", `thumbnail text has ${thumb.words} words`, "three words at most", "thumbnail");
  if (thumb && (thumb.width !== 1280 || thumb.height !== 720))
    add(null, "P1", `thumbnail is ${thumb.width}x${thumb.height}`, "1280x720", "thumbnail");

  // caps: the highest score the measurements allow. Rendering succeeding is not evidence.
  const total = info.duration || 1;
  const holdTime = holds.reduce((a, [t0, t1]) => a + t1 - t0, 0);
  const kbTime = kenBurns.reduce((a, [t0, t1]) => a + t1 - t0, 0);
  const slideTime = slides.reduce((a, [t0, t1]) => a + t1 - t0, 0);
  const caps = {};
  const cap = (dim, v, why) => {
    if (caps[dim] == null || v < caps[dim].cap) caps[dim] = { cap: v, why };
  };
  if (hook.firstFrameFlat || hook.firstMotion == null || hook.firstMotion > 1)
    cap("hook", 2, "nothing on screen moves in the first second");
  else if (hook.motionShare0to3 <= 0.6) cap("hook", 3, "40% or more of the first 3 s is still");
  if (hook.soundOnset != null && hook.soundOnset > 1.5)
    cap("hook", 3, "no sound in the first 1.5 s");
  if (holdTime / total > 0.15)
    cap(
      "visual-engagement",
      2,
      `${Math.round((100 * holdTime) / total)}% of the runtime is static`,
    );
  else if (holdTime / total > 0.05)
    cap(
      "visual-engagement",
      3,
      `${Math.round((100 * holdTime) / total)}% of the runtime is static`,
    );
  if (repeats.length > 2) cap("visual-engagement", 3, `${repeats.length} repeated compositions`);
  const stillAll = diff.slice(1).filter((d) => d < T.stillDiff).length / Math.max(1, n - 1);
  if (stillAll > 0.45)
    cap(
      "visual-engagement",
      2,
      `nothing moves in ${Math.round(stillAll * 100)}% of sampled frames`,
    );
  else if (stillAll > 0.3)
    cap(
      "visual-engagement",
      3,
      `nothing moves in ${Math.round(stillAll * 100)}% of sampled frames`,
    );
  if (slideTime > 0) cap("animation", 2, `rigid slides for ${slideTime.toFixed(1)} s`);
  if (slideTime > 0) cap("character", 2, "a character or object moves as one rigid picture");
  if (kbTime / total > 0.4)
    cap("cinematography", 3, `${Math.round((100 * kbTime) / total)}% is camera moves over stills`);
  if (kbTime / total > 0.4) cap("animation", 3, "most motion is camera-only over stills");
  if (holdTime / total > 0.25) cap("pacing", 2, "long static stretches");
  if (thumb && thumb.words > 3) cap("thumbnail", 0, "more than three words");
  if (mix?.voice_margin_lu != null && mix.voice_margin_lu < 6)
    cap("audio-mix", 2, "bed too close to the narration");
  if (audio && audio.truePeak > -1) cap("audio-mix", 3, "true peak over -1 dBTP");

  const unverified = {};
  if (!words) unverified.sync = "no word timings given (--words)";
  if (!info.audio) unverified["audio-mix"] = "the render has no audio";
  else if (!mix)
    unverified["audio-mix"] =
      "no stems: loudness and peak measured, music/SFX balance not (needs sound-effects sfx/ in --project); the mix was not heard";
  if (!opts.research)
    unverified.factual =
      "no research.md given (--research): claims cannot be checked against sources";
  if (!opts.thumbnail) unverified.thumbnail = "no thumbnail given";

  const technical = {
    resolution: `${info.width}x${info.height}`,
    fps: +info.fps.toFixed(3),
    duration: +info.duration.toFixed(2),
    frames: info.frames,
    audio: info.audio,
    integratedLufs: audio?.integratedLufs ?? null,
    truePeakDbtp: audio?.truePeak ?? null,
    silences: audio?.silences ?? [],
    note: "Technical quality is reported separately and never raises a creative score.",
  };

  const review = {
    version: 1,
    video: path.resolve(video),
    videoSha256: sha256(video),
    generated: new Date().toISOString(),
    rubric: path.join(HERE, "rubric.md"),
    sheets,
    technical,
    measured: {
      fps,
      hook,
      stillShare: +stillAll.toFixed(2),
      holds,
      cameraOnly: kenBurns,
      rigidSlides: slides,
      cuts,
      units: units.map(({ signature: _signature, ...u }) => u),
      repeats,
      lumStd: +lumStd.toFixed(3),
      sync,
      mix,
      thumbnail: thumb,
      research: opts.research ? path.resolve(opts.research) : null,
    },
    caps,
    unverified,
    dimensions: DIMENSIONS.map(([id, name]) => ({
      id,
      name,
      score: unverified[id] ? "unverified" : null,
      cap: caps[id]?.cap ?? 5,
      evidence: [],
      notes: unverified[id] ?? "",
    })),
    findings,
    evaluator: null,
  };
  fs.writeFileSync(path.join(out, "review.json"), `${JSON.stringify(review, null, 2)}\n`);
  return { out, review };
}

// ---- evaluation -----------------------------------------------------------------

/**
 * Merge an evaluator's file into the review template. The evaluator (Fable,
 * or this session when no Fable subagent exists) writes only judgements:
 * { evaluator, dimensions: { id: { score, evidence: [{ t | file, note }],
 * notes, scenes } }, findings: [{ id | match: { kind, scene }, status,
 * reason }], add: [{ t, scene, severity, problem, fix }] }.
 */
export function mergeEval(rv, ev) {
  const out = structuredClone(rv);
  out.evaluator = ev.evaluator ?? out.evaluator;
  for (const d of out.dimensions) {
    const e = ev.dimensions?.[d.id];
    if (!e) continue;
    for (const k of ["score", "evidence", "notes", "scenes"]) if (e[k] !== undefined) d[k] = e[k];
  }
  for (const f of ev.findings ?? []) {
    const hits = out.findings.filter((x) =>
      f.id ? x.id === f.id : Object.entries(f.match ?? {}).every(([k, v]) => x[k] === v),
    );
    for (const h of hits) Object.assign(h, { status: f.status, reason: f.reason ?? h.reason });
  }
  for (const a of ev.add ?? [])
    out.findings.push({
      id: `e${out.findings.length + 1}`,
      source: "evaluator",
      status: "open",
      ...a,
    });
  return out;
}

// ---- gate -------------------------------------------------------------------

export function gate(reviewFile, { min = 3, hookMin = 4, meanMin = 3.5, evalFile } = {}) {
  let rv = JSON.parse(fs.readFileSync(reviewFile, "utf8"));
  if (evalFile) {
    rv = mergeEval(rv, JSON.parse(fs.readFileSync(evalFile, "utf8")));
    fs.writeFileSync(reviewFile, `${JSON.stringify(rv, null, 2)}\n`);
  }
  const problems = [];
  if (!fs.existsSync(rv.video)) problems.push(`video missing: ${rv.video}`);
  else if (sha256(rv.video) !== rv.videoSha256)
    problems.push("the video changed since it was analyzed: run analyze again");
  if (!rv.evaluator) problems.push("no evaluator recorded (who looked at the frames)");
  const scores = {};
  for (const d of rv.dimensions) {
    const capV = rv.caps?.[d.id]?.cap ?? 5;
    if (d.score === "unverified" || d.score === "n/a") {
      if (MUST_VERIFY.includes(d.id))
        problems.push(`${d.id} can always be inspected from the frames: score it`);
      if (!d.notes) problems.push(`${d.id} is ${d.score} without a reason`);
      scores[d.id] = d.score;
      continue;
    }
    if (!Number.isInteger(d.score) || d.score < 0 || d.score > 5) {
      problems.push(`${d.id}: score must be 0-5, "unverified" or "n/a"`);
      continue;
    }
    scores[d.id] = d.score;
    if (d.score > capV)
      problems.push(`${d.id}: ${d.score} is over the measured cap ${capV} (${rv.caps[d.id].why})`);
    const ev = (d.evidence ?? []).filter((e) => (Number.isFinite(e.t) || e.file) && e.note);
    if (ev.length < 1) problems.push(`${d.id}: a score needs evidence ({t or file, note})`);
    if (d.score >= 4 && ev.length < 2)
      problems.push(`${d.id}: ${d.score} needs two pieces of evidence with timestamps`);
    if (d.score < min) problems.push(`${d.id}: ${d.score} is under ${min}`);
  }
  if (Number.isInteger(scores.hook) && scores.hook < hookMin)
    problems.push(`hook ${scores.hook} is under ${hookMin}`);
  const nums = Object.values(scores).filter(Number.isInteger);
  const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  if (mean < meanMin) problems.push(`mean ${mean.toFixed(2)} is under ${meanMin}`);
  for (const f of rv.findings ?? []) {
    const done =
      f.status === "fixed" ||
      ((f.status === "accepted" || f.status === "false-positive") && f.reason);
    if (f.severity === "P2" && f.status === "open") continue;
    if (!done)
      problems.push(
        `finding ${f.id} (${f.severity}${f.t != null ? ` at ${f.t}s` : ""}) is ${f.status}: ${f.problem}`,
      );
    if (f.severity === "P0" && f.status === "accepted")
      problems.push(`finding ${f.id} is P0 and cannot be accepted`);
  }
  const repair = [
    ...new Set(
      (rv.findings ?? [])
        .filter((f) => f.status === "open" && f.severity !== "P2" && f.scene)
        .map((f) => f.scene)
        .concat(
          rv.dimensions.flatMap((d) =>
            Number.isInteger(d.score) && d.score < min ? (d.scenes ?? []) : [],
          ),
        ),
    ),
  ];
  return {
    pass: problems.length === 0,
    problems,
    repair,
    scores,
    mean: +mean.toFixed(2),
    video: rv.video,
    videoSha256: rv.videoSha256,
    at: new Date().toISOString(),
  };
}

// ---- splice and compare -------------------------------------------------------

/**
 * Replace scenes of BASE with re-rendered segments (each rendered with
 * `hyperframes render --start S --end E`): segments = [{ file, at }]. The rest
 * of BASE is not re-rendered; its frames are re-encoded once at high quality.
 * Audio is copied from BASE, so the mix is untouched.
 */
export function splice(base, segments, out) {
  const b = probe(base);
  const fps = b.fps;
  const total = b.frames || Math.round(b.duration * fps);
  const segs = segments
    .map((sg) => {
      const s = probe(sg.file);
      if (b.width !== s.width || b.height !== s.height)
        throw new Error(`${sg.file}: size ${s.width}x${s.height}, base ${b.width}x${b.height}`);
      if (Math.abs(b.fps - s.fps) > 0.01)
        throw new Error(`${sg.file}: ${s.fps} fps, base ${b.fps}`);
      const f0 = Math.round(sg.at * fps);
      const n = s.frames || Math.round(s.duration * fps);
      return { file: sg.file, f0, f1: f0 + n, n };
    })
    .sort((x, y) => x.f0 - y.f0);
  segs.forEach((sg, k) => {
    if (sg.f1 > total) throw new Error(`${sg.file} runs past the end (${sg.f1} > ${total} frames)`);
    if (k && sg.f0 < segs[k - 1].f1) throw new Error(`${sg.file} overlaps ${segs[k - 1].file}`);
  });
  const parts = [];
  const fc = [];
  let cur = 0;
  segs.forEach((sg, k) => {
    if (sg.f0 > cur) {
      fc.push(`[0:v]trim=start_frame=${cur}:end_frame=${sg.f0},setpts=PTS-STARTPTS[k${k}]`);
      parts.push(`[k${k}]`);
    }
    fc.push(`[${k + 1}:v]trim=start_frame=0:end_frame=${sg.n},setpts=PTS-STARTPTS[s${k}]`);
    parts.push(`[s${k}]`);
    cur = sg.f1;
  });
  if (cur < total) {
    fc.push(`[0:v]trim=start_frame=${cur},setpts=PTS-STARTPTS[tail]`);
    parts.push("[tail]");
  }
  const filter = `${fc.join(";")};${parts.join("")}concat=n=${parts.length}:v=1:a=0[v]`;
  const args = [
    "-v",
    "error",
    "-y",
    "-i",
    base,
    ...segs.flatMap((sg) => ["-i", sg.file]),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
  ];
  if (b.audio) args.push("-map", "0:a", "-c:a", "copy");
  args.push(
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    out,
  );
  const r = run("ffmpeg", args);
  if (r.code !== 0) throw new Error(`splice: ${r.stderr}`);
  const o = probe(out);
  if (o.frames && o.frames !== total)
    throw new Error(`splice wrote ${o.frames} frames, expected ${total}`);
  return {
    out,
    frames: o.frames,
    expected: total,
    replaced: segs.map((sg) => ({
      file: sg.file,
      seconds: [+(sg.f0 / fps).toFixed(3), +(sg.f1 / fps).toFixed(3)],
    })),
  };
}

/** Per-frame PSNR of B against A, summarised over ranges ("0-3,6-9" in s). */
export function compare(a, b, ranges) {
  const fps = probe(a).fps;
  const r = run("ffmpeg", [
    "-v",
    "error",
    "-i",
    a,
    "-i",
    b,
    "-lavfi",
    "[0:v][1:v]psnr=stats_file=-",
    "-f",
    "null",
    "-",
  ]);
  const lines = r.stdout.toString().trim().split("\n").filter(Boolean);
  const psnr = lines.map((l) => {
    const m = l.match(/psnr_avg:(inf|[\d.]+)/);
    return m ? (m[1] === "inf" ? 99 : Number(m[1])) : 0;
  });
  const rs = (ranges ?? `0-${psnr.length / fps}`).split(",").map((x) => x.split("-").map(Number));
  return rs.map(([t0, t1]) => {
    const seg = psnr.slice(Math.round(t0 * fps), Math.round(t1 * fps));
    return {
      range: [t0, t1],
      frames: seg.length,
      minPsnr: seg.length ? +Math.min(...seg).toFixed(2) : null,
      meanPsnr: seg.length ? +(seg.reduce((x, y) => x + y, 0) / seg.length).toFixed(2) : null,
    };
  });
}

// ---- CLI ----------------------------------------------------------------------

function parse(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { flags, pos };
}

const USAGE = `cqc.mjs <command>
  analyze VIDEO --out DIR [--scenes F] [--words F] [--thumbnail PNG --thumb-text T] [--research F] [--project DIR] [--fps 10]
  gate REVIEW.json [--eval EVAL.json] [--project DIR] [--min 3] [--hook-min 4]   exit 1 unless the review passes
  splice BASE SEG@SECONDS [SEG@SECONDS ...] --out OUT              replace re-rendered scenes, keep the rest
  compare A B [--ranges 0-3,6-9]                                  per-range PSNR (unchanged frames stay high)`;

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, pos } = parse(rest);
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  switch (cmd) {
    case "analyze": {
      if (!pos[0]) break;
      const { out: dir, review } = analyze(pos[0], {
        out: flags.out,
        scenes: flags.scenes,
        words: flags.words,
        thumbnail: flags.thumbnail,
        thumbText: flags["thumb-text"],
        research: flags.research,
        project: flags.project,
        fps: flags.fps,
      });
      console.log(`review template: ${path.join(dir, "review.json")}`);
      console.log(
        `sheets: ${[review.sheets.contact, review.sheets.hook, ...review.sheets.motion.map((m) => m.file)].filter(Boolean).join(", ")}`,
      );
      console.log(`measured findings: ${review.findings.length}`);
      for (const f of review.findings)
        console.log(`  ${f.severity} ${f.t ?? "-"}s ${f.scene ?? ""} ${f.problem}`);
      console.log(
        `caps: ${
          Object.entries(review.caps)
            .map(([k, v]) => `${k}<=${v.cap}`)
            .join(", ") || "none"
        }`,
      );
      console.log(`unverified: ${Object.keys(review.unverified).join(", ") || "none"}`);
      return EXIT.ok;
    }
    case "gate": {
      if (!pos[0]) break;
      const r = gate(pos[0], {
        min: Number(flags.min ?? 3),
        hookMin: Number(flags["hook-min"] ?? 4),
        evalFile: flags.eval,
      });
      if (flags.project) {
        const dir = path.join(flags.project, "production", "qc");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "gate.json"), `${JSON.stringify(r, null, 2)}\n`);
        if (r.repair.length) {
          const P = await import(
            pathToFileURL(path.join(HERE, "..", "video-production", "production.mjs")).href
          );
          for (const id of r.repair) {
            try {
              P.scene(flags.project, id, "failed", [], "creative QC: see production/qc/gate.json");
            } catch (e) {
              console.error(`could not mark ${id}: ${e.message}`);
            }
          }
        }
      }
      out(r);
      return r.pass ? EXIT.ok : EXIT.fail;
    }
    case "splice": {
      if (!pos[1] || !flags.out) break;
      const segs = pos.slice(1).map((x) => {
        const m = x.match(/^(.*)@([\d.]+)$/);
        if (!m) throw new Error(`segment "${x}" must be FILE@SECONDS`);
        return { file: m[1], at: Number(m[2]) };
      });
      out(splice(pos[0], segs, flags.out));
      return EXIT.ok;
    }
    case "compare": {
      if (!pos[1]) break;
      out(compare(pos[0], pos[1], flags.ranges));
      return EXIT.ok;
    }
  }
  console.log(USAGE);
  return EXIT.usage;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2))
    .then((c) => (process.exitCode = c))
    .catch((e) => {
      console.error(`cqc: ${e.message}`);
      process.exitCode = EXIT.usage;
    });
}
