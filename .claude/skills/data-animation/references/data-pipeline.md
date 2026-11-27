# Data pipeline: dataset to one data module to N renders

Adapted from the upstream [chart-animation data pipeline](https://github.com/iart-ai/data-animation-skills/blob/6570c0c4fbc9daa8d7ac1f1163a890352344206b/skills/chart-animation/references/data-pipeline.md) (MIT).

## One data module

Keep the dataset in the project (a CSV or JSON file) and the source
line next to it. Parse once, before the timeline is built, with
`toSeries(parseCSV(text), opts)`; it throws on ragged rows, duplicates, gaps
and non-numbers, so a bad file fails the render instead of drawing a wrong
bar. Use `loose: true` only when the source formats numbers as `$1,287` or
`42%`, and say so in the source line.

Do not fetch at render time. Either inline the CSV in a `<script>` string or
pass it as a HyperFrames variable (below).

## Cleaning rules

- One unit per series; convert before charting, not in the label.
- Periods sort as the source lists them; sort the CSV, not the chart.
- Missing values are an error, not zero. Fill only with an explicit, documented rule.
- Keep source precision in the data; round only in `formatNumber`.

## Theme object

Colours, fonts, sizes and decimals in one object at the top of the
composition, so every render of the template shares them and only data changes.

## One template, many datasets

Declare the dataset as a variable (`data-composition-variables`), read it with
`window.__hyperframes.getVariables()`, then render per dataset:

```bash
npx hyperframes render --variables-file q3.json --output q3.mp4
npx hyperframes render --batch rows.json --output "renders/{name}.mp4"   # one row per dataset
```

Check one representative dataset with stills (first frame, a crossover, last
frame) before batch rendering, then spot-check the last frame of each output.
