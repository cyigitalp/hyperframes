import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as PH from "./polyhaven.mjs";

// A fake Poly Haven: response shapes follow api.polyhaven.com/api-docs (swagger.yml).
const md5 = (s) => createHash("md5").update(s).digest("hex");
const blobs = new Map();
function file(name, size = 10) {
  const url = `https://dl.polyhaven.org/file/ph-assets/${name}`;
  const body = "data:" + name;
  blobs.set(url, body);
  return { url, md5: md5(body), size };
}
const MB = 1024 * 1024;
const ASSETS = {
  models: {
    rubber_duck_toy: {
      name: "Rubber Duck",
      type: 2,
      tags: ["duck", "toy"],
      categories: ["props"],
      download_count: 9,
      files_hash: "a1",
      authors: { "Jane Doe": "All" },
    },
    big_statue: {
      name: "Big Statue",
      type: 2,
      tags: ["statue"],
      categories: ["props"],
      download_count: 99,
      files_hash: "a2",
      authors: {},
    },
  },
  textures: {
    wood_floor: {
      name: "Wood Floor",
      type: 1,
      tags: ["wood", "planks"],
      categories: ["floor"],
      download_count: 5,
      files_hash: "t1",
      authors: { Rob: "All" },
    },
  },
  hdris: {
    studio_small: {
      name: "Studio Small",
      type: 0,
      tags: ["studio", "softbox"],
      categories: ["indoor"],
      download_count: 7,
      files_hash: "h1",
      authors: { Greg: "All" },
    },
  },
};
const FILES = {
  rubber_duck_toy: {
    gltf: {
      "1k": {
        gltf: {
          ...file("Models/gltf/1k/rubber_duck_toy/rubber_duck_toy_1k.gltf"),
          include: {
            "textures/duck_diff_1k.jpg": file("duck_diff_1k.jpg"),
            "rubber_duck_toy.bin": file("rubber_duck_toy.bin"),
          },
        },
      },
      "2k": {
        gltf: {
          ...file("Models/gltf/2k/rubber_duck_toy/rubber_duck_toy_2k.gltf", 50 * MB),
          include: {},
        },
      },
    },
    blend: { "1k": { blend: file("duck.blend") } },
  },
  big_statue: { gltf: { "1k": { gltf: { ...file("big_1k.gltf", 90 * MB), include: {} } } } },
  wood_floor: {
    Diffuse: {
      "1k": { jpg: file("wood_floor_diff_1k.jpg"), png: file("wood_floor_diff_1k.png") },
      "2k": { jpg: file("wood_floor_diff_2k.jpg") },
    },
    nor_gl: {
      "1k": { jpg: file("wood_floor_nor_gl_1k.jpg") },
      "2k": { jpg: file("wood_floor_nor_gl_2k.jpg") },
    },
    nor_dx: { "1k": { jpg: file("wood_floor_nor_dx_1k.jpg") } },
    arm: {
      "1k": { jpg: file("wood_floor_arm_1k.jpg") },
      "2k": { jpg: file("wood_floor_arm_2k.jpg") },
    },
    Rough: { "1k": { jpg: file("wood_floor_rough_1k.jpg") } },
    Displacement: { "1k": { png: file("wood_floor_disp_1k.png") } },
    gltf: { "1k": { gltf: file("wood_floor_1k.gltf") } },
  },
  studio_small: {
    hdri: {
      "1k": { hdr: file("HDRIs/hdr/1k/studio_small_1k.hdr"), exr: file("studio_small_1k.exr") },
      "2k": { hdr: file("HDRIs/hdr/2k/studio_small_2k.hdr") },
      "4k": { hdr: file("HDRIs/hdr/4k/studio_small_4k.hdr") },
    },
    tonemapped: file("studio_small.jpg"),
  },
};

function fakeFetch({ searchDown = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ua: init?.headers?.["User-Agent"] });
    const u = new URL(url);
    const json = (data, status = 200) => ({
      ok: status < 400,
      status,
      headers: new Map(),
      json: async () => data,
    });
    if (u.host === "dl.polyhaven.org") {
      const body = blobs.get(url);
      return {
        ok: !!body,
        status: body ? 200 : 404,
        headers: new Map(),
        arrayBuffer: async () => Buffer.from(body),
      };
    }
    if (u.pathname === "/assets") return json(ASSETS[u.searchParams.get("t")]);
    if (u.pathname.startsWith("/files/")) return json(FILES[u.pathname.slice(7)]);
    if (u.pathname === "/search") {
      if (searchDown) return json({}, 503);
      const t = u.searchParams.get("t");
      const q = u.searchParams.get("q");
      const ids = Object.keys(ASSETS[t]).sort((a) =>
        q.split(" ").some((w) => a.includes(w)) ? -1 : 1,
      );
      return json({ results: ids.map((slug) => ({ slug, score: 0.5 })) });
    }
    return json({}, 404);
  };
  fn.calls = calls;
  return fn;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ph-test-"));
const SCENE = {
  output: { width: 1280, height: 720 },
  assets: {
    model: { query: "rubber duck", coverage: 0.45 },
    material: { type: "textures", query: "wood floor", coverage: 0.6 },
    hdri: { query: "studio", background: true, blurred: true },
  },
};

test("chooseResolution picks the smallest size that holds the shot", () => {
  const av = ["4k", "1k", "2k", "8k"];
  assert.equal(PH.chooseResolution({ type: "textures", coverage: 0.5 }, av, { height: 720 }), "1k");
  assert.equal(PH.chooseResolution({ type: "textures", coverage: 1 }, av, { height: 1080 }), "2k");
  assert.equal(PH.chooseResolution({ type: "hdris" }, av, { height: 2160 }), "1k");
  assert.equal(
    PH.chooseResolution({ type: "hdris", background: true }, av, { height: 1080 }),
    "8k",
  );
  assert.equal(
    PH.chooseResolution({ type: "hdris", background: true, blurred: true }, av, { height: 720 }),
    "2k",
  );
  assert.equal(PH.chooseResolution({ type: "models", res: "4k" }, av), "4k");
  assert.equal(PH.chooseResolution({ type: "models", coverage: 9 }, ["1k", "2k"]), "2k");
});

test("planFiles: glTF with includes, PBR maps with arm, .hdr", () => {
  const m = PH.planFiles("models", "rubber_duck_toy", FILES.rubber_duck_toy, "1k");
  assert.equal(m.entry.gltf, "rubber_duck_toy/rubber_duck_toy_1k.gltf");
  assert.deepEqual(m.files.map((f) => f.path).sort(), [
    "rubber_duck_toy/rubber_duck_toy.bin",
    "rubber_duck_toy/rubber_duck_toy_1k.gltf",
    "rubber_duck_toy/textures/duck_diff_1k.jpg",
  ]);
  const t = PH.planFiles("textures", "wood_floor", FILES.wood_floor, "1k");
  assert.deepEqual(Object.keys(t.entry).sort(), ["arm", "diffuse", "normal"]);
  assert.match(t.entry.diffuse, /diff_1k\.jpg$/);
  assert.match(t.entry.normal, /nor_gl/);
  assert.ok(
    PH.planFiles("textures", "wood_floor", FILES.wood_floor, "1k", { displacement: true }).entry
      .displacement,
  );
  const h = PH.planFiles("hdris", "studio_small", FILES.studio_small, "2k");
  assert.deepEqual(h.entry, { hdr: "studio_small/studio_small_2k.hdr" });
  assert.equal(PH.planFiles("hdris", "studio_small", FILES.studio_small, "16k"), null);
});

test("selectAsset follows search, falls back to keywords, respects the byte budget", async () => {
  const client = PH.createClient({ fetch: fakeFetch(), cacheDir: tmp() });
  const duck = await PH.selectAsset(
    client,
    "model",
    { query: "duck", coverage: 2 },
    { height: 720 },
    40 * MB,
  );
  assert.equal(duck.id, "rubber_duck_toy");
  assert.equal(duck.res, "1k", "2k is 50 MB, over budget");
  const statue = await PH.selectAsset(
    client,
    "model",
    { query: "statue" },
    { height: 720 },
    40 * MB,
  );
  assert.equal(statue.id, "rubber_duck_toy", "big_statue does not fit, next candidate wins");
  const off = PH.createClient({ fetch: fakeFetch({ searchDown: true }), cacheDir: tmp() });
  const wood = await PH.selectAsset(
    off,
    "floor",
    { type: "textures", query: "planks" },
    { height: 720 },
  );
  assert.equal(wood.id, "wood_floor");
  assert.equal(wood.license, "CC0-1.0");
  assert.deepEqual(wood.authors, ["Rob"]);
  await assert.rejects(
    PH.selectAsset(client, "model", { id: "nope" }, {}),
    /no Poly Haven models asset "nope"/,
  );
});

test("scene: download once, cache hit offline, verify, credits, User-Agent", async () => {
  const cacheDir = tmp();
  const out = tmp();
  const f1 = fakeFetch();
  const c1 = PH.createClient({ fetch: f1, cacheDir });
  const man = await PH.resolveScene(c1, SCENE);
  await PH.materialize(c1, man, out);
  assert.deepEqual(Object.keys(man.assets), ["model", "material", "hdri"]);
  assert.equal(man.assets.hdri.res, "2k");
  assert.ok(c1.stats.downloads >= 7);
  assert.ok(f1.calls.every((c) => c.ua === PH.USER_AGENT));
  assert.deepEqual(PH.verify(out), []);
  const credits = fs.readFileSync(path.join(out, "polyhaven", "CREDITS.md"), "utf8");
  assert.match(credits, /Powered by Poly Haven/);
  assert.match(credits, /\[Rubber Duck\]\(https:\/\/polyhaven.com\/a\/rubber_duck_toy\)/);

  // A fresh project, offline: everything comes from the cache, no request at all.
  const out2 = tmp();
  const f2 = fakeFetch();
  const c2 = PH.createClient({ fetch: f2, cacheDir, offline: true });
  const man2 = await PH.resolveScene(c2, SCENE);
  await PH.materialize(c2, man2, out2);
  assert.equal(f2.calls.length, 0);
  assert.equal(c2.stats.hits, c1.stats.downloads);
  assert.deepEqual(man2, man);

  // Re-running against an existing manifest reuses its picks.
  const again = await PH.resolveScene(
    c2,
    { ...SCENE, assets: { ...SCENE.assets, model: { query: "statue" } } },
    man,
  );
  assert.equal(again.assets.model.id, "rubber_duck_toy");

  fs.writeFileSync(path.join(out, "polyhaven", man.assets.hdri.entry.hdr), "corrupt");
  assert.match(PH.verify(out)[0], /md5 mismatch/);
  await assert.rejects(
    PH.resolveScene(PH.createClient({ fetch: fakeFetch(), cacheDir: tmp(), offline: true }), SCENE),
    /offline/,
  );
});

test("download rejects a corrupted transfer", async () => {
  const client = PH.createClient({ fetch: fakeFetch(), cacheDir: tmp() });
  const f = FILES.studio_small.hdri["1k"].hdr;
  await assert.rejects(client.download({ ...f, md5: "0".repeat(32) }), /md5 mismatch/);
  assert.ok(fs.existsSync(await client.download(f)));
});

test("roleType and keywordRank", () => {
  assert.equal(PH.roleType("hdri", {}), "hdris");
  assert.equal(PH.roleType("hero_model", {}), "models");
  assert.equal(PH.roleType("floor", {}), "textures");
  assert.equal(PH.roleType("x", { type: "models" }), "models");
  assert.deepEqual(PH.keywordRank(ASSETS.models, "toy duck"), ["rubber_duck_toy"]);
  assert.deepEqual(PH.keywordRank(ASSETS.models, "props"), ["big_statue", "rubber_duck_toy"]);
});
