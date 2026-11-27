# Lines, counters and financial comparisons

Adapted from the upstream [chart-animation data pipeline](https://github.com/iart-ai/data-animation-skills/blob/6570c0c4fbc9daa8d7ac1f1163a890352344206b/skills/chart-animation/references/data-pipeline.md) (MIT).

## Counter

```js
const p = D.progress(t, start, 1.4, "cubicOut"); // 1.2 to 1.6 s, then hold
el.textContent = D.formatNumber(D.countValue(0, 1287, p, 0)); // "1,287" on the last frame
```

Currency: `{ style: "currency", currency: "USD", decimals: 1, notation: "compact" }`
gives `$3.2B`. Keep decimals fixed for the whole count so width only changes
when a digit is added; reserve that width with `min-width` in `ch`.

## Line or area reveal

```js
const x = D.scaleLinear([0, values.length - 1], [left, right]);
const y = D.scaleLinear([0, D.niceMax(Math.max(...values))], [bottom, top]);
const pts = values.map((v, i) => [x(i), y(v)]);
HFGsapFrame.addRenderTrack(tl, (t) => {
  const lp = D.linePath(pts, D.progress(t, 0.5, 3, "linear")); // steady time axis: linear
  path.setAttribute("d", lp.d);
  dot.setAttribute("cx", lp.head[0]);
  dot.setAttribute("cy", lp.head[1]);
  label.textContent = D.formatNumber(D.valueAt(values, lp.index), { decimals: 1 });
});
```

Area: close the same `d` with `L${lp.head[0]},${bottom}L${pts[0][0]},${bottom}Z`.
Several series: reveal the highlighted one, keep the rest grey and drawn.
`stroke-dasharray` reveals also work (`DrawSVGPlugin` or a dashoffset tween),
but the head label cannot then read the exact value; prefer `linePath`.

## Financial comparisons

| Statement           | Compute                 | Format                                                                   |
| ------------------- | ----------------------- | ------------------------------------------------------------------------ |
| Year over year      | `D.change(prev, cur)`   | `{ style: "percent", decimals: 1, signDisplay: "always" }` gives `+6.7%` |
| Growth over n years | `D.cagr(start, end, n)` | percent, 1 decimal, say "a year"                                         |
| Share of a total    | `D.shares(values, 1)`   | sums to exactly 100.0                                                    |
| Gap between two     | `b - a` in source units | same decimals as the source                                              |

- Compute from source values, never from already rounded labels.
- Comparison card: two values side by side with the same scale and decimals, the delta between them counts after both land, green or red only with a sign as well (colour is not the only cue).
- Negative numbers: `signDisplay: "always"` or `"exceptZero"`; never let `-0.0` show (`formatNumber` folds it to 0).
- Put the period and unit next to every figure ("USD billions, FY2023").
