// data-frame.js: exact, frame-pure data helpers for HyperFrames charts.
// Load as a classic script: <script src="data-frame.js"></script>
// Exposes globalThis.HFDataFrame. No DOM, clock, randomness or network, so
// every value is a pure function of its inputs (and therefore of the seeked
// frame). Pair it with gsap-frame.js: a GSAP render track gives the time, this
// file turns time into the numbers, ranks and paths a chart draws.
// Patterns adapted from iart-ai/data-animation-skills (MIT, see UPSTREAM.md).
(function (root) {
  "use strict";

  const EASES = {
    linear: (t) => t,
    cubicOut: (t) => 1 - Math.pow(1 - t, 3),
    cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    quintOut: (t) => 1 - Math.pow(1 - t, 5),
  };

  function clamp01(t) {
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  function easeFn(ease) {
    if (typeof ease === "function") return ease;
    const fn = EASES[ease || "cubicInOut"];
    if (!fn) throw new TypeError("unknown ease " + ease);
    return fn;
  }

  /** Progress 0..1 of `time` inside [start, start + duration], eased and clamped. */
  function progress(time, start, duration, ease) {
    if (!(duration > 0)) return time >= start ? 1 : 0;
    return easeFn(ease || "linear")(clamp01((time - start) / duration));
  }

  /** Round half away from zero to `decimals` places, without 1.005 -> 1.00 drift. */
  function roundTo(n, decimals) {
    const d = decimals || 0;
    const p = Math.pow(10, d);
    const r = (Math.sign(n) * Math.round(Math.abs(n) * p * (1 + Number.EPSILON))) / p;
    return r === 0 ? 0 : r;
  }

  /** A number for display: the start and end values are exact, rounding is fixed. */
  function countValue(from, to, p, decimals) {
    if (p >= 1) return roundTo(to, decimals);
    if (p <= 0) return roundTo(from, decimals);
    return roundTo(from + (to - from) * p, decimals);
  }

  const fmtCache = new Map();
  /**
   * Intl.NumberFormat with a fixed locale (default en-US) and fixed fraction
   * digits, so the label never changes width rules mid-count.
   * opts: { locale, decimals, style: "decimal"|"currency"|"percent", currency,
   *         notation: "standard"|"compact", signDisplay }
   * Percent takes a ratio (0.423 -> "42.3%").
   */
  function formatNumber(n, opts) {
    const o = opts || {};
    const decimals = o.decimals || 0;
    const key = JSON.stringify([
      o.locale,
      decimals,
      o.style,
      o.currency,
      o.notation,
      o.signDisplay,
    ]);
    let f = fmtCache.get(key);
    if (!f) {
      f = new Intl.NumberFormat(o.locale || "en-US", {
        style: o.style || "decimal",
        currency: o.currency,
        notation: o.notation || "standard",
        signDisplay: o.signDisplay || "auto",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      fmtCache.set(key, f);
    }
    const value = o.style === "percent" ? roundTo(n * 100, decimals) / 100 : roundTo(n, decimals);
    return f.format(value === 0 ? 0 : value);
  }

  /** Linear scale with an `invert`. */
  function scaleLinear(domain, range) {
    const d0 = domain[0];
    const d1 = domain[1];
    const r0 = range[0];
    const r1 = range[1];
    const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
    const s = (v) => r0 + (v - d0) * k;
    s.invert = (px) => (k === 0 ? d0 : d0 + (px - r0) / k);
    return s;
  }

  /** Smallest 1/2/2.5/5 x 10^n at or above `v`, for an axis maximum. */
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const steps = [1, 2, 2.5, 5, 10];
    for (let i = 0; i < steps.length; i++) {
      const m = Number((steps[i] * mag).toPrecision(12));
      if (m >= v - 1e-9 * mag) return m;
    }
    return 10 * mag;
  }

  /** `count` + 1 evenly spaced ticks from 0 to `max`. */
  function ticks(max, count) {
    const n = count || 4;
    const out = [];
    for (let i = 0; i <= n; i++) out.push(roundTo((max * i) / n, 10));
    return out;
  }

  /** Minimal RFC 4180 CSV parser: quotes, escaped quotes, CRLF. Returns array of row objects. */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const src = String(text).replace(/^﻿/, "");
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    const body = rows.filter((r) => r.some((v) => v.trim() !== ""));
    const head = (body.shift() || []).map((h) => h.trim());
    return body.map((r, line) => {
      if (r.length !== head.length) {
        throw new Error(
          "CSV row " + (line + 2) + " has " + r.length + " cells, expected " + head.length,
        );
      }
      const o = {};
      head.forEach((h, j) => (o[h] = r[j].trim()));
      return o;
    });
  }

  /** Strict number: "1,287.5", "$3.2", "42%" are rejected unless `loose` strips , $ % and spaces. */
  function toNumber(v, where, loose) {
    const s = loose ? String(v).replace(/[,$%\s]/g, "") : String(v).trim();
    const n = s === "" ? NaN : Number(s);
    if (!Number.isFinite(n)) throw new Error("not a number at " + where + ": " + JSON.stringify(v));
    return n;
  }

  /**
   * Long rows ({period, name, value}) or wide rows ({period, A, B, ...}) to
   * { periods: [...], series: [{ id, values: [...] }] }. Every series must have
   * a value for every period; missing or duplicate cells throw.
   * opts: { period: "year", name?: "country", value?: "gdp", loose?: true }
   */
  function toSeries(rows, opts) {
    const o = opts || {};
    const pk = o.period || "period";
    const periods = [];
    const pIndex = new Map();
    const cells = new Map();
    const ids = [];
    function put(id, p, raw, where) {
      if (!pIndex.has(p)) {
        pIndex.set(p, periods.length);
        periods.push(p);
      }
      if (!cells.has(id)) {
        cells.set(id, new Map());
        ids.push(id);
      }
      const m = cells.get(id);
      if (m.has(p)) throw new Error("duplicate value for " + id + " at " + p);
      m.set(p, toNumber(raw, where, o.loose));
    }
    rows.forEach((r, i) => {
      const p = String(r[pk]);
      if (o.name) put(String(r[o.name]), p, r[o.value || "value"], "row " + (i + 1));
      else
        Object.keys(r).forEach((k) => {
          if (k !== pk) put(k, p, r[k], "row " + (i + 1) + " col " + k);
        });
    });
    const series = ids.map((id) => {
      const m = cells.get(id);
      return {
        id: id,
        values: periods.map((p) => {
          if (!m.has(p)) throw new Error("missing value for " + id + " at " + p);
          return m.get(p);
        }),
      };
    });
    return { periods: periods, series: series };
  }

  function ranksAt(series, i) {
    const order = series
      .map((s, j) => ({ j: j, v: s.values[i] }))
      .sort((a, b) => b.v - a.v || a.j - b.j);
    const r = new Array(series.length);
    order.forEach((e, k) => (r[e.j] = k));
    return r;
  }

  /**
   * Bar chart race state at continuous period position `pos` (0 .. periods-1).
   * Values ease between data rows; ranks are integers at each data row and
   * glide between them, so overtakes slide instead of jumping. At an integer
   * `pos` every value and rank is exactly the source row.
   * Returns [{ id, value, rank (float), order (int) }] sorted by order.
   */
  function raceState(data, pos, opts) {
    const o = opts || {};
    const n = data.periods.length;
    const p = Math.min(Math.max(pos, 0), n - 1);
    const i = Math.min(Math.floor(p), Math.max(n - 2, 0));
    const f = n < 2 ? 0 : easeFn(o.ease || "cubicInOut")(clamp01(p - i));
    const r0 = ranksAt(data.series, i);
    const r1 = n < 2 ? r0 : ranksAt(data.series, i + 1);
    const rows = data.series.map((s, j) => {
      const a = s.values[i];
      const b = n < 2 ? a : s.values[i + 1];
      return {
        id: s.id,
        value: f >= 1 ? b : f <= 0 ? a : a + (b - a) * f,
        rank: r0[j] + (r1[j] - r0[j]) * f,
      };
    });
    rows.sort((a, b) => b.value - a.value || a.rank - b.rank);
    rows.forEach((r, k) => (r.order = k));
    return rows;
  }

  /** Period position for time `t` with an intro hold, `perPeriod` seconds per row, then a final hold. */
  function periodAt(t, opts) {
    const o = opts || {};
    const hold = o.introHold || 0;
    const per = o.perPeriod || 1;
    const last = o.periods - 1;
    return Math.min(Math.max((t - hold) / per, 0), last);
  }

  /**
   * Partially drawn polyline through `points` ([x, y] pixels) at progress p.
   * The head lands exactly on the interpolated segment, so a value label can
   * ride it. Returns { d, head: [x, y], index (float along points) }.
   */
  function linePath(points, p) {
    if (!points.length) return { d: "", head: null, index: 0 };
    const pos = clamp01(p) * (points.length - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    let d = "M" + points[0][0] + "," + points[0][1];
    for (let k = 1; k <= i; k++) d += "L" + points[k][0] + "," + points[k][1];
    let head = points[i];
    if (f > 0 && i + 1 < points.length) {
      const a = points[i];
      const b = points[i + 1];
      head = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      d += "L" + roundTo(head[0], 2) + "," + roundTo(head[1], 2);
    }
    return { d: d, head: head, index: pos };
  }

  /** Value at a fractional index of a value array (linear between samples). */
  function valueAt(values, index) {
    const i = Math.min(Math.max(Math.floor(index), 0), values.length - 1);
    const f = index - i;
    return i + 1 < values.length ? values[i] + (values[i + 1] - values[i]) * f : values[i];
  }

  /** Relative change (b - a) / a as a ratio; throws when a is 0. */
  function change(a, b) {
    if (a === 0) throw new RangeError("change from 0 is undefined");
    return (b - a) / Math.abs(a);
  }

  /** Compound annual growth rate as a ratio. */
  function cagr(start, end, years) {
    if (!(start > 0) || !(end >= 0) || !(years > 0))
      throw new RangeError("cagr needs start > 0, end >= 0, years > 0");
    return Math.pow(end / start, 1 / years) - 1;
  }

  /**
   * Shares of a total that round to exactly 100 (largest remainder), so a
   * stacked bar or a "by the numbers" panel never reads 99% or 101%.
   */
  function shares(values, decimals) {
    const d = decimals || 0;
    const unit = Math.pow(10, d);
    const total = values.reduce((s, v) => s + v, 0);
    if (!(total > 0)) throw new RangeError("shares need a positive total");
    const raw = values.map((v) => (v / total) * 100 * unit);
    const base = raw.map(Math.floor);
    let left = 100 * unit - base.reduce((s, v) => s + v, 0);
    raw
      .map((v, i) => ({ i: i, r: v - base[i] }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .forEach((e) => {
        if (left > 0) {
          base[e.i] += 1;
          left -= 1;
        }
      });
    return base.map((v) => v / unit);
  }

  root.HFDataFrame = {
    EASES: EASES,
    progress: progress,
    roundTo: roundTo,
    countValue: countValue,
    formatNumber: formatNumber,
    scaleLinear: scaleLinear,
    niceMax: niceMax,
    ticks: ticks,
    parseCSV: parseCSV,
    toNumber: toNumber,
    toSeries: toSeries,
    raceState: raceState,
    periodAt: periodAt,
    linePath: linePath,
    valueAt: valueAt,
    change: change,
    cagr: cagr,
    shares: shares,
  };
})(globalThis);
