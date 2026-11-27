# Upstream

Adapted from https://github.com/iart-ai/data-animation-skills at commit
`6570c0c` (`6570c0c4fbc9daa8d7ac1f1163a890352344206b`), MIT License,
Copyright (c) 2026 iart.ai. The licence text is in `LICENSE`.

| Upstream                                                | Here                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `skills/chart-animation/SKILL.md`                       | `SKILL.md` (rules, checklist)                                         |
| `skills/chart-animation/references/bar-chart-race.md`   | `references/bar-chart-race.md`                                        |
| `skills/chart-animation/references/data-pipeline.md`    | `references/data-pipeline.md`, `references/lines-counters-finance.md` |
| `skills/animated-infographic/`                          | `references/infographic.md`                                           |
| interpolation, ranking, counter and formatting snippets | `data-frame.js` (rewritten as frame-pure helpers, tested)             |

All of it is rewritten for HyperFrames: the Remotion `useCurrentFrame()`
clock becomes the seeked GSAP root timeline (`gsap-hyperframes`), React
components become plain DOM and SVG, and D3 scales become `scaleLinear`.

Not adapted: `presentation-video` (the repo's `/slideshow` skill and
`/hyperframes` already cover decks and narrated sequences), `scripts/`
(`hyperframes snapshot` and `check` replace the ffmpeg contact sheet and
probe), `showcase.gif` / `showcase.html` (demo media), and the Remotion,
d3-scale and zod dependencies.

To update: read upstream's `LICENSE` again, diff the files above against the
new commit, port relevant changes, update the commit here, mirror to
`.agents/skills/data-animation/`, and run `bun run check:skill-mirror`,
`node --test .claude/skills/data-animation/data-frame.test.mjs` and the
`Media deps` workflow (it renders `.github/workflows/fixtures/data-animation`).
