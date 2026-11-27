# Natural Earth

`countries-110m.js` is built from Natural Earth 1:110m Admin 0 Countries
(v5.1.2 data), from https://github.com/nvkelso/natural-earth-vector at commit
`ca96624a56bd078437bca8184e78163e5039ad19`, file
`geojson/ne_110m_admin_0_countries.geojson`.

Licence: public domain (see `LICENSE.md`, copied from that commit, and
https://www.naturalearthdata.com/about/terms-of-use/). No attribution is
required; the map skill still shows "Map data: Natural Earth" on screen.

Boundaries are Natural Earth's de facto view. Disputed areas follow its
default point of view; say so in the video when a border matters.

`build.mjs` keeps `name`, `iso_a3` (falling back to `ADM0_A3` where Natural
Earth has `-99`, e.g. France, Norway, Kosovo), `continent`, `subregion` and the
label point, rounds coordinates to 2 decimals (about 1 km) and drops repeated
points. Rebuild or make a finer file for a video project:

```bash
C=ca96624a56bd078437bca8184e78163e5039ad19
curl -fsSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/$C/geojson/ne_50m_admin_0_countries.geojson
node vendor/natural-earth/build.mjs ne_50m_admin_0_countries.geojson countries-50m.js 2
```

The same script works for `ne_*_admin_1_states_provinces.geojson` (regions)
after adjusting the kept properties. Only the 110m file is committed here; keep
finer files in the video project.
