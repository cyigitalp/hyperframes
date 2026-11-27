# Bar chart race

Adapted from the upstream [chart-animation bar chart race](https://github.com/iart-ai/data-animation-skills/blob/6570c0c4fbc9daa8d7ac1f1163a890352344206b/skills/chart-animation/references/bar-chart-race.md) (MIT).
Start from the registry `bar-chart-race` block for the look; use this to
drive it from real data.

## Shape

```js
const data = HFDataFrame.toSeries(HFDataFrame.parseCSV(CSV), { period: "year" }); // wide CSV
// long CSV: { period: "year", name: "company", value: "revenue" }
const TIMING = { introHold: 1.2, perPeriod: 0.6, periods: data.periods.length };
// timeline length = introHold + perPeriod * (periods - 1) + final hold (2 s or more)
```

## Render track

```js
const D = HFDataFrame;
HFGsapFrame.addRenderTrack(tl, (t) => {
  const pos = D.periodAt(t, TIMING);
  const rows = D.raceState(data, pos); // sorted by current value
  const axisMax = D.niceMax(rows[0].value); // axis rescales as the leader climbs
  for (const r of rows) {
    const el = bars.get(r.id); // one element per id, created once
    el.style.transform = `translateY(${r.rank * ROW}px)`; // rank glides between rows
    el.bar.style.width = (r.value / axisMax) * MAX_W + "px";
    el.label.textContent = D.formatNumber(r.value, { decimals: 1 });
    el.classList.toggle("lead", r.order === 0); // accent hands over to the leader
  }
  periodLabel.textContent = data.periods[Math.round(pos)];
});
```

- Create bar elements once, keyed by id; never rebuild the DOM per frame.
- `rank` is the integer rank at each data row, eased between rows, so an overtake slides. `order` is the integer order this frame (use it for the leader accent).
- Show only the top N: hide rows whose `rank` is above N + 0.5 and fade the one crossing the cut.
- `niceMax` changes in steps, so the axis can jump. For a calmer axis, interpolate per-period maxima: `axisMax = valueAt(maxPerPeriod.map(niceMax), pos)`.

## Pitfalls

| Symptom                                      | Cause                           | Fix                                                                                                     |
| -------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Bars teleport                                | y from array index              | y from `rank`                                                                                           |
| Digits wiggle                                | proportional figures            | `tabular-nums`                                                                                          |
| Reads like a slideshow                       | one raw row per beat            | continuous `pos` with `periodAt`                                                                        |
| Last frame off by a decimal                  | unrounded interpolation         | `raceState` is exact at integer `pos`; hold the final row                                               |
| Leader impossible to track                   | too fast                        | 0.6 to 0.9 s per row; extra dwell on the crossover                                                      |
| `check` flags `content_overlap` mid-overtake | two rows cross for a few frames | expected for a race: put `data-layout-allow-overlap` on the bars container, keep it off everything else |
| Long names clip                              | fixed label width               | measure the longest name once before building the timeline                                              |
