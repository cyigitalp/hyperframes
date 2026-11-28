import { test } from "node:test";
import assert from "node:assert/strict";
import { check, licenceOk, layersOf } from "./plan-check.mjs";
import { fromOpenverse, fromCommons, fromNasa } from "./photo-search.mjs";

const photo = {
  kind: "photo",
  provenance: "authentic",
  source: "find",
  licence: "CC0",
  subject: "espresso",
  motion: "steam",
};
const scene = (id, start, end, extra = {}) => ({
  id,
  start,
  end,
  evidence: "illustrative",
  camera: { move: "push-in", motivation: "beat" },
  layers: [photo],
  ...extra,
});

test("licences: commercial-safe pass, NC/ND/editorial fail", () => {
  for (const l of [
    "CC0",
    "cc-by-4.0",
    "CC BY-SA 4.0",
    "pdm",
    "Public domain",
    "NASA (public domain)",
    "Poly Haven CC0",
    "own",
  ])
    assert.ok(licenceOk(l), l);
  for (const l of [
    "CC BY-NC 4.0",
    "cc-by-nd",
    "CC BY-NC-SA",
    "editorial only",
    "All rights reserved",
    "",
    undefined,
  ])
    assert.ok(!licenceOk(l), String(l));
});

test("a strong plan passes without errors", () => {
  const plan = {
    look: { palette: "warm" },
    scenes: [
      scene("s1", 0, 4, { hook: "steam swerves at Pip", gag: "steam to the face" }),
      scene("s2", 4, 8, { evidence: "authentic", treatment: "photo" }),
      scene("s3", 8, 12, {
        evidence: "recreation",
        label: "AI recreation",
        layers: [
          {
            kind: "image",
            provenance: "ai",
            subject: "factory",
            real: true,
            label: "AI recreation",
          },
        ],
      }),
      scene("s4", 12, 16, { character: { actions: ["walk", "talk", "blink"] } }),
    ],
  };
  const r = check(plan);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.provenance.authentic, 3);
});

test("the bottled-air failures are errors or warnings", () => {
  const built = { kind: "graphic", provenance: "built" };
  const plan = [
    { id: "a", start: 0.5, end: 3, treatment: "title", layers: [built] },
    { id: "b", start: 3, end: 6, evidence: "authentic", layers: [built], camera: "push-in" },
    {
      id: "c",
      start: 6,
      end: 9,
      evidence: "recreation",
      layers: [{ provenance: "ai", real: true, person: true, subject: "CEO" }],
      motion: true,
    },
    {
      id: "d",
      start: 9,
      end: 12,
      layers: [{ provenance: "authentic", licence: "CC BY-NC 4.0", subject: "bottle" }],
      motion: true,
    },
    { id: "e", start: 12, end: 40, layers: [built], character: { actions: ["slide"] } },
  ];
  const { errors, warnings, ok } = check(plan);
  const has = (list, re) => list.some((e) => re.test(e));
  assert.equal(ok, false);
  assert.ok(has(errors, /^a: the film starts at 0.5/));
  assert.ok(has(errors, /^a: opens on a title/));
  assert.ok(has(errors, /^a: nothing moves/));
  assert.ok(has(errors, /^b: shows a real event.*no authentic layer/));
  assert.ok(has(errors, /^c: a recreation must say so/));
  assert.ok(has(errors, /^c: CEO: never generate the likeness/));
  assert.ok(has(errors, /^d: bottle: licence "CC BY-NC 4.0"/));
  assert.ok(has(errors, /^e: the character only moves as a whole picture/));
  assert.ok(has(warnings, /^film: 0 gag/));
  assert.ok(has(warnings, /^film: no art direction/));
  const slides = Array.from({ length: 4 }, (_, i) => ({
    id: `g${i}`,
    start: i * 3,
    end: i * 3 + 3,
    layers: [built],
    motion: true,
  }));
  assert.ok(check(slides).warnings.some((w) => /4 of 4 scenes are code-built/.test(w)));
});

test("legacy asset lists are read as layers", () => {
  const l = layersOf({
    assets: [
      { key: "x", source: "generate" },
      { key: "y", source: "find", licence: "CC0" },
      { key: "z" },
    ],
  });
  assert.deepEqual(
    l.map((a) => a.provenance),
    ["ai", "authentic", "built"],
  );
  assert.ok(
    check({
      scenes: [{ id: "s", start: 0, end: 3, hold: true, assets: [{ key: "y", source: "find" }] }],
    }).ok,
  );
});

test("search results are normalised with licence and credit", () => {
  const ov = fromOpenverse({
    id: "1",
    title: "Cup",
    url: "u",
    foreign_landing_url: "l",
    creator: "Ann",
    license: "by",
    license_version: "4.0",
    attribution: "Cup by Ann, CC BY 4.0",
    width: 2000,
  });
  assert.equal(ov.licence, "CC BY 4.0");
  assert.ok(ov.commercialOk);
  assert.equal(
    fromOpenverse({ id: "2", license: "by-nc", license_version: "2.0" }).commercialOk,
    false,
  );
  assert.ok(fromOpenverse({ id: "3", license: "cc0" }).commercialOk);

  const page = (lic, nonFree = "false") => ({
    pageid: 7,
    title: "File:Bottle.jpg",
    imageinfo: [
      {
        url: "o",
        thumburl: "t",
        descriptionurl: "d",
        thumbwidth: 1920,
        extmetadata: {
          LicenseShortName: { value: lic },
          Artist: { value: "<a href='x'>Bo</a>" },
          NonFree: { value: nonFree },
        },
      },
    ],
  });
  const c = fromCommons(page("CC BY-SA 4.0"));
  assert.equal(c.creator, "Bo");
  assert.equal(c.url, "t");
  assert.ok(c.commercialOk);
  assert.match(c.credit, /Bottle\.jpg by Bo, CC BY-SA 4\.0, via Wikimedia Commons/);
  assert.equal(fromCommons(page("Public domain")).commercialOk, true);
  assert.equal(fromCommons(page("CC BY-NC-SA 3.0")).commercialOk, false);
  assert.equal(fromCommons(page("Fair use", "true")).commercialOk, false);

  const n = fromNasa({
    data: [
      { nasa_id: "as11-40-5903", title: "Aldrin on the Moon", photographer: "Neil Armstrong" },
    ],
  });
  assert.ok(n.commercialOk);
  assert.match(n.credit, /Credit: NASA\/Neil Armstrong/);
  assert.equal(fromNasa({ data: [{ nasa_id: "x", title: "NASA logo" }] }).commercialOk, false);
});
