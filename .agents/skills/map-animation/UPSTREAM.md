# Upstream

Adapted from https://github.com/iart-ai/map-animation-skills at commit
`c8ef846` (`c8ef8463f5a4a8aa35ff0c6c17f42e52bbf588a5`), MIT License,
Copyright (c) 2026 iart.ai. The licence text is in `LICENSE`.

| Upstream                                                                                                                                                              | Here                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [map-animation SKILL](https://github.com/iart-ai/map-animation-skills/blob/c8ef8463f5a4a8aa35ff0c6c17f42e52bbf588a5/skills/map-animation/SKILL.md)                    | `SKILL.md` (paths, overlays, checklist)                  |
| [vector-maps reference](https://github.com/iart-ai/map-animation-skills/blob/c8ef8463f5a4a8aa35ff0c6c17f42e52bbf588a5/skills/map-animation/references/vector-maps.md) | `references/vector-maps.md`                              |
| d3-geo projection, `geoInterpolate`, `interpolateZoom` and draw-on snippets                                                                                           | `map-frame.js` (rewritten as frame-pure helpers, tested) |

All of it is rewritten for HyperFrames: the Remotion `useCurrentFrame()`
clock becomes the seeked GSAP root timeline (`gsap-hyperframes`), React
components become plain SVG, and d3-geo becomes `map-frame.js` (Mercator,
Equal Earth and equirectangular projections, great circles, the van Wijk and
Nuij smooth zoom) with no dependency.

Not adapted: `earth-studio-to-ae.md` and the Google Earth Studio path
(Google imagery terms and After Effects are outside an offline, open-data
pipeline), `scripts/` (`hyperframes snapshot` and `check` replace the
ffmpeg contact sheet and probe), the showcase GIF and page, and the Remotion,
d3-geo and zod dependencies.

Map data is Natural Earth (public domain), vendored in `vendor/natural-earth/`.

To update: read upstream's `LICENSE` again, diff the files above against the
new commit, port relevant changes, update the commit here, mirror to
`.agents/skills/map-animation/`, and run `bun run check:skill-mirror`,
`node --test .claude/skills/map-animation/map-frame.test.mjs` and the
`Media deps` workflow (it renders `.github/workflows/fixtures/map-animation`).
