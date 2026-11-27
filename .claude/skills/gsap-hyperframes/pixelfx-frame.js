// pixelfx-frame.js: drive a pixelfx effect from a HyperFrames GSAP timeline.
// ES module. Load gsap-frame.js first (it provides HFGsapFrame.addRenderTrack).
//
// pixelfx effects are fixed-step simulations, so a seek replays the effect from
// its first frame in 1/fps steps whenever it moves backwards. Any seek order
// therefore lands on the same pixels as a straight playthrough.

/**
 * @param {object} tl paused GSAP timeline (the composition root)
 * @param {object} o
 * @param {object} o.pixelfx the pixelfx core module (`import * as pixelfx from "pixelfx"`)
 * @param {object} o.fx an effect module (`import * as nova from "pixelfx/fx/ice/frost-nova"`)
 * @param {CanvasRenderingContext2D} o.ctx 2D context of a canvas sized o.width x o.height
 * @param {number} o.fps composition frame rate
 * @param {number} [o.width] pixel width, default fx.meta.size[0]
 * @param {number} [o.height] pixel height, default fx.meta.size[1]
 * @param {number} [o.start] timeline position in seconds, default 0
 * @param {number} [o.duration] seconds, default fx.meta.duration
 * @param {object} [o.options] createFx options: x, y, flip, angle, seed, palette, light...
 * @param {number|null} [o.bg] composite background (0xAABBGGRR) or null for transparent
 */
export function addPixelfxTrack(tl, o) {
  const { pixelfx, fx: mod, ctx, fps } = o;
  const meta = mod.meta ?? {};
  const width = o.width ?? meta.size?.[0] ?? 160;
  const height = o.height ?? meta.size?.[1] ?? 120;
  const options = {
    x: meta.origin?.[0] ?? width / 2,
    y: meta.origin?.[1] ?? height / 2,
    ...o.options,
  };
  const frame = pixelfx.createFrame(width, height);
  const img = ctx.createImageData(width, height);
  const bg = o.bg === undefined ? null : o.bg;
  let inst = null;
  let stepped = 0;

  function renderAt(localTime) {
    const target = Math.max(0, Math.round(localTime * fps));
    if (!inst || target < stepped) {
      inst = pixelfx.createFx(mod, options);
      stepped = 0;
    }
    for (; stepped < target; stepped++) inst.update(1 / fps);
    pixelfx.clearFrame(frame);
    inst.draw(frame);
    pixelfx.composite(frame, img.data, bg);
    ctx.putImageData(img, 0, 0);
  }

  return globalThis.HFGsapFrame.addRenderTrack(tl, renderAt, {
    start: o.start ?? 0,
    duration: o.duration ?? meta.duration ?? 1,
  });
}
