import { test } from "node:test";
import assert from "node:assert/strict";
import "./data-frame.js";

const D = globalThis.HFDataFrame;

test("rounding and counters land on exact values", () => {
  assert.equal(D.roundTo(1.005, 2), 1.01);
  assert.equal(D.roundTo(-2.5, 0), -3);
  assert.equal(D.roundTo(-0.0001, 2), 0);
  assert.equal(D.countValue(0, 1287, 1, 0), 1287);
  assert.equal(D.countValue(0, 1287, 0.5, 0), 644);
  assert.equal(D.countValue(10, 20, -1, 0), 10);
  assert.equal(D.progress(1.5, 1, 1, "linear"), 0.5);
  assert.equal(D.progress(9, 1, 1, "cubicOut"), 1);
});

test("formatting is fixed-width friendly and locale pinned", () => {
  assert.equal(D.formatNumber(1287), "1,287");
  assert.equal(
    D.formatNumber(3.2e9, { style: "currency", currency: "USD", notation: "compact", decimals: 1 }),
    "$3.2B",
  );
  assert.equal(
    D.formatNumber(0.4235, { style: "percent", decimals: 1, signDisplay: "always" }),
    "+42.4%",
  );
  assert.equal(D.formatNumber(-0.0004, { decimals: 2 }), "0.00");
});

test("scales and axis maxima", () => {
  const s = D.scaleLinear([0, 200], [0, 800]);
  assert.equal(s(50), 200);
  assert.equal(s.invert(400), 100);
  assert.equal(D.niceMax(173), 200);
  assert.equal(D.niceMax(2100), 2500);
  assert.equal(D.niceMax(0.031), 0.05);
  assert.deepEqual(D.ticks(250, 5), [0, 50, 100, 150, 200, 250]);
});

test("CSV parsing and series validation fail loud", () => {
  const rows = D.parseCSV(
    'year,name,value\r\n2020,"A, Inc",10\n2020,B,5\n2021,"A, Inc",12\n2021,B,15\n',
  );
  const data = D.toSeries(rows, { period: "year", name: "name", value: "value" });
  assert.deepEqual(data.periods, ["2020", "2021"]);
  assert.deepEqual(data.series, [
    { id: "A, Inc", values: [10, 12] },
    { id: "B", values: [5, 15] },
  ]);
  const wide = D.toSeries(D.parseCSV("year,A,B\n2020,1,2\n2021,3,4"), { period: "year" });
  assert.deepEqual(wide.series[1].values, [2, 4]);
  assert.throws(() => D.toSeries(D.parseCSV("year,A\n2020,1,2")), /3 cells, expected 2/);
  assert.throws(
    () => D.toSeries(D.parseCSV("year,A\n2020,n/a"), { period: "year" }),
    /not a number/,
  );
  assert.throws(() => D.toSeries(D.parseCSV("year,A\n2020,1,000")), /cells/);
  assert.equal(D.toNumber("$1,287", "x", true), 1287);
  assert.throws(
    () =>
      D.toSeries(
        [
          { p: "1", n: "A", v: "1" },
          { p: "2", n: "B", v: "1" },
        ],
        { period: "p", name: "n", value: "v" },
      ),
    /missing value/,
  );
});

test("race state is exact on data rows and glides between them", () => {
  const data = {
    periods: ["a", "b"],
    series: [
      { id: "x", values: [10, 30] },
      { id: "y", values: [20, 25] },
    ],
  };
  const s0 = D.raceState(data, 0);
  assert.deepEqual(
    s0.map((r) => [r.id, r.value, r.rank, r.order]),
    [
      ["y", 20, 0, 0],
      ["x", 10, 1, 1],
    ],
  );
  const s1 = D.raceState(data, 1);
  assert.deepEqual(
    s1.map((r) => [r.id, r.value, r.rank]),
    [
      ["x", 30, 0],
      ["y", 25, 1],
    ],
  );
  const mid = D.raceState(data, 0.5);
  assert.ok(mid.every((r) => r.rank > 0 && r.rank < 1));
  assert.equal(D.periodAt(0.5, { introHold: 1, perPeriod: 1, periods: 4 }), 0);
  assert.equal(D.periodAt(99, { introHold: 1, perPeriod: 1, periods: 4 }), 3);
});

test("line path, growth and shares", () => {
  const pts = [
    [0, 100],
    [10, 50],
    [20, 0],
  ];
  assert.equal(D.linePath(pts, 1).d, "M0,100L10,50L20,0");
  const half = D.linePath(pts, 0.75);
  assert.deepEqual(half.head, [15, 25]);
  assert.equal(D.valueAt([0, 10, 20], 1.5), 15);
  assert.equal(D.change(80, 100), 0.25);
  assert.equal(D.roundTo(D.cagr(100, 121, 2), 6), 0.1);
  assert.deepEqual(D.shares([1, 1, 1]), [34, 33, 33]);
  assert.equal(
    D.shares([2, 3, 5, 7], 1)
      .reduce((a, b) => a + b, 0)
      .toFixed(1),
    "100.0",
  );
  assert.throws(() => D.change(0, 1));
});
