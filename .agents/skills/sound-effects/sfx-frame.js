// sfx-frame.js: put animation on the same frames as the sound effects.
// sfx.py render writes sfx/cues.js (window.__sfxCues) with every cue's frame-snapped time;
// load it before this file and anchor tweens to cue ids, so picture and sound share one clock.
// ES module, no dependencies and no clock: deterministic under the seek-by-frame renderer.
export function cues(src) {
  const c = src || (typeof window !== "undefined" ? window.__sfxCues : undefined);
  if (!c || typeof c !== "object" || !c.cues) {
    throw new Error("sfx-frame: no cues; load sfx/cues.js (written by sfx.sh render) first");
  }
  return c;
}
export function cue(id, src) {
  const c = cues(src);
  const v = c.cues[id];
  if (!v) throw new Error(`sfx-frame: no cue "${id}" (have: ${Object.keys(c.cues).join(", ")})`);
  return v;
}
/** seconds of a cue, plus an offset in frames (negative = before the sound) */
export function time(id, offsetFrames, src) {
  const c = cues(src);
  const v = cue(id, c);
  return (v.frame + (offsetFrames || 0)) / c.fps;
}
export function frame(id, src) {
  return cue(id, src).frame;
}
/**
 * Add a tween to `tl` so that it ENDS on the cue's frame (lead-in motion, e.g. a slam that lands on an impact),
 * or STARTS on it with {start: true}. `make(duration)` returns the tween; durations are in frames.
 */
export function land(tl, id, frames, make, opts, src) {
  const c = cues(src);
  const o = opts || {};
  const d = frames / c.fps;
  const t = o.start ? time(id, 0, c) : time(id, 0, c) - d;
  if (t < 0)
    throw new Error(`sfx-frame: cue "${id}" needs ${frames} frames of lead-in, starts before 0`);
  tl.add(make(d), t);
  return t;
}
/** a one-frame visual hit on the cue (flash, cut, colour change): set props on the frame, back on the next */
export function hit(tl, id, target, on, off, src) {
  const c = cues(src);
  const t = time(id, 0, c);
  tl.set(target, on, t);
  if (off)
    tl.to(target, Object.assign({ duration: 6 / c.fps, ease: "power2.out" }, off), t + 1 / c.fps);
  return t;
}
