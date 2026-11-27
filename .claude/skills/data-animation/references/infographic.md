# Data-driven infographic

Adapted from upstream `animated-infographic` (MIT).

## Design the still first

Lay out the final frame completely (every icon, number, label in its final
place) and get it past `hyperframes check`. Motion then only decides when
each element appears. One central insight, three to five supporting figures.

## Reveal order is hierarchy

| Tier | Element                  | Motion                                                         |
| ---- | ------------------------ | -------------------------------------------------------------- |
| 1    | Title or central insight | fade and a small rise, alone                                   |
| 2    | Icon anchoring each item | scale in with slight overshoot (`back.out(1.6)`)               |
| 3    | Key number               | count up right after its icon (`countValue`)                   |
| 4    | Label                    | fade, no drama                                                 |
| 5    | Connector                | draw on (`DrawSVGPlugin` or `linePath`) as each item completes |

```js
const D = HFDataFrame;
const STAGGER = HFGsapFrame.frames(8, FPS); // about 0.27 s at 30 fps
items.forEach((item, i) => {
  const at = 0.6 + i * 0.9; // one number counts at a time
  tl.from(item.icon, { scale: 0, duration: 0.4, ease: "back.out(1.6)" }, at);
  tl.from(item.label, { opacity: 0, y: 12, duration: 0.3 }, at + STAGGER);
  tl.to(
    item.counter,
    {
      p: 1,
      duration: 1.2,
      ease: "power3.out",
      onUpdate: () =>
        (item.num.textContent = D.formatNumber(
          D.countValue(0, item.value, item.counter.p, item.decimals),
          item.fmt,
        )),
    },
    at,
  );
});
```

`item.counter = { p: 0 }` is a plain proxy object on the root timeline, so a
seek renders the exact number. Icons come from `/media-use` or registry
components; a "by the numbers" grid of KPI cards counting at once is the tell
to avoid (see `/hyperframes` `references/types/data.md`).
