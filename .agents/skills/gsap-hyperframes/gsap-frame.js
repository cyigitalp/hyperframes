// gsap-frame.js: frame-accurate GSAP helpers for HyperFrames compositions.
// Load as a classic script after GSAP: <script src="gsap-frame.js"></script>
// Exposes globalThis.HFGsapFrame. No DOM, clock or network access, so it is
// deterministic under the HyperFrames seek-by-frame renderer.
(function (root) {
  "use strict";
  const EPS = 1e-6;

  function assertFps(fps) {
    if (!(typeof fps === "number" && fps > 0 && Number.isFinite(fps))) {
      throw new TypeError("fps must be a positive finite number, got " + fps);
    }
  }

  /** Seconds at the start of frame `frame`. */
  function frameToTime(frame, fps) {
    assertFps(fps);
    return frame / fps;
  }

  /** Index of the frame shown at `time` (float drift tolerant). */
  function timeToFrame(time, fps) {
    assertFps(fps);
    return Math.floor(time * fps + EPS);
  }

  /** Round a time in seconds to the nearest frame boundary. */
  function snapTime(time, fps) {
    assertFps(fps);
    return Math.round(time * fps) / fps;
  }

  /** Duration in seconds of `count` frames, for tween `duration` / `stagger` / positions. */
  function frames(count, fps) {
    return frameToTime(count, fps);
  }

  /**
   * Create a paused root timeline. With `durationFrames`, it is padded to
   * exactly that length. Register it yourself with a literal
   * `window.__timelines["<id>"] = tl;` so `hyperframes lint` can see it.
   */
  function createRootTimeline(gsap, opts) {
    const o = opts || {};
    const tl = gsap.timeline({ paused: true, defaults: o.defaults });
    if (o.durationFrames != null) {
      assertFps(o.fps);
      tl.set({}, {}, frames(o.durationFrames, o.fps));
    }
    return tl;
  }

  /** Seek a timeline to the start of `frame`. Returns the time it seeked to. */
  function seekFrame(tl, frame, fps) {
    const t = Math.min(frameToTime(frame, fps), tl.totalDuration());
    tl.totalTime(t, false);
    return t;
  }

  /**
   * Add a linear proxy tween whose onUpdate calls render(localTime, progress).
   * Use it to drive Three.js, canvas or WebGL redraws from the GSAP timeline,
   * so every seeked frame redraws exactly once with the seeked time.
   */
  function addRenderTrack(tl, render, opts) {
    const o = opts || {};
    const start = o.start || 0;
    const duration = o.duration != null ? o.duration : Math.max(tl.duration() - start, EPS);
    const proxy = { p: 0 };
    return tl.fromTo(
      proxy,
      { p: 0 },
      {
        p: 1,
        duration: duration,
        ease: "none",
        immediateRender: true,
        onUpdate: function () {
          render(proxy.p * duration, proxy.p);
        },
      },
      start,
    );
  }

  /** Stepped ease that holds each value for `holdFrames` frames across `durationFrames`. */
  function frameSteps(gsap, durationFrames, holdFrames) {
    const steps = Math.max(1, Math.round(durationFrames / (holdFrames || 1)));
    return gsap.parseEase("steps(" + steps + ")");
  }

  /** Seeded PRNG (mulberry32) returning floats in [0, 1). Replaces Math.random. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  root.HFGsapFrame = {
    frameToTime: frameToTime,
    timeToFrame: timeToFrame,
    snapTime: snapTime,
    frames: frames,
    createRootTimeline: createRootTimeline,
    seekFrame: seekFrame,
    addRenderTrack: addRenderTrack,
    frameSteps: frameSteps,
    seededRandom: seededRandom,
  };
})(globalThis);
