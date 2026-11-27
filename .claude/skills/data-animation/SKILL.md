---
name: data-animation
description: Data-driven motion for HyperFrames with exact numbers on every frame. Load when a video needs a bar chart race, ranking over time, line or area reveal, count-up or number ticker, financial comparison (growth, CAGR, year over year, shares of a total), or a "by the numbers" infographic, or when turning a CSV or JSON dataset into a chart. Ships data-frame.js (parsing, validation, rounding, formatting, race ranks, line paths). Adapted from iart-ai/data-animation-skills (MIT).
license: MIT
metadata:
  internal: true
---

# Data animation in HyperFrames

Adapted from [iart-ai/data-animation-skills](https://github.com/iart-ai/data-animation-skills)
(MIT, see `UPSTREAM.md`). Upstream targets Remotion; here the clock is the
seeked GSAP root timeline. Read `/hyperframes` `references/types/data.md` for
the story rules (one number at a time, highlight one series, source line).
This skill is the numeric craft. Load only the reference you need.

## The rule

Every displayed value is a pure function of the seeked time. Put one
`HFGsapFrame.addRenderTrack(tl, render)` on the root timeline
(`gsap-hyperframes`) and compute everything inside `render(t)` with
`data-frame.js`. No CSS transitions, no D3 `.transition()`, no chart library
animation loop, no `Date.now()`, no fetch at render time: inline the data or
load it from a project file before building the timeline.

## Start from the registry, then add exactness

Install the nearest block first (`npx hyperframes catalog --query chart --json`):
`bar-chart-race`, `data-chart`, `animated-bar-chart`, `mk-line-graph`,
`decline-chart`, `chart-story` (blocks); `count-up`, `number-wheel`,
`number-pop-in`, `mk-progress-stat`, `ai-answer-rank` (components). When its
numbers must match a dataset exactly, or the data comes from a CSV, drive it
with `data-frame.js` as below instead of hand-typed keyframes.

## data-frame.js (globalThis.HFDataFrame)

Copy next to `index.html` and load after GSAP and `gsap-frame.js`:
`<script src="data-frame.js"></script>`. Tested in `data-frame.test.mjs`.

| Need                                                      | Call                                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV to series, fail loud on gaps, duplicates, non-numbers | `toSeries(parseCSV(text), { period: "year", name?, value?, loose? })`                                                                           |
| Eased 0..1 window                                         | `progress(t, start, duration, "cubicOut")`                                                                                                      |
| Count-up that lands exactly                               | `countValue(from, to, p, decimals)`                                                                                                             |
| Label                                                     | `formatNumber(n, { decimals, style: "currency"\|"percent", currency, notation: "compact", signDisplay })` (locale pinned to en-US unless given) |
| Axis                                                      | `scaleLinear(domain, range)`, `niceMax(v)`, `ticks(max, n)`                                                                                     |
| Bar chart race                                            | `raceState(data, periodAt(t, { introHold, perPeriod, periods }))` gives `value`, gliding `rank`, `order`                                        |
| Line reveal with a riding label                           | `linePath(points, p)` gives `d`, `head`, `index`; `valueAt(values, index)`                                                                      |
| Financial comparison                                      | `change(a, b)`, `cagr(start, end, years)`, `shares(values, decimals)` (sums to exactly 100)                                                     |
| Rounding                                                  | `roundTo(n, decimals)` (half away from zero, no 1.005 drift)                                                                                    |

## Accuracy and type checklist

- At every data row and at the last frame the screen shows the source value exactly, rounded once with the same decimals everywhere.
- Digits use `font-variant-numeric: tabular-nums; line-height: 1`, so counters do not jitter or clip.
- Reading text is at least 19 px at 720 p (2.6 % of the short side); `hyperframes check` enforces the floor and WCAG contrast.
- Pace: hold 1 to 1.5 s before motion, 0.3 to 0.9 s per data row, slow down on the crossover that matters, hold the final state 2 s or more.
- Count one number at a time; annotate one moment; a source line on screen.
- Render stills at the first frame, a crossover and the last frame (`npx hyperframes snapshot` or the render plus `ffmpeg -vf select`) and read every digit before the full render.

## References

- `references/bar-chart-race.md`: race layout, rank glide, axis rescale, leader colour, pitfalls.
- `references/lines-counters-finance.md`: line and area reveals, counters, year over year, CAGR, share bars, comparison cards.
- `references/infographic.md`: designed "by the numbers" scenes, tiered reveal order, stagger, connectors.
- `references/data-pipeline.md`: CSV or JSON to one data module, validation, and one template rendered per dataset with HyperFrames variables.

Three.js or PixelFX can carry a chart (bars as 3D columns, a pixel burst on a record) through the same render track; see `gsap-hyperframes`. Do not add a chart library for motion.
