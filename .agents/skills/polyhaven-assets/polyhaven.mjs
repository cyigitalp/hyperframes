#!/usr/bin/env node
// Poly Haven asset discovery, selection, cache and download for HyperFrames.
// No dependencies (Node 18+). Library exports below; CLI at the bottom.
//
// API terms (https://github.com/Poly-Haven/Public-API/blob/master/ToS.md):
// every request carries a unique User-Agent, and a video made with assets
// found through the live API shows a light "Powered by Poly Haven" credit
// (written to CREDITS.md and manifest.credit). The assets are CC0.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const API = "https://api.polyhaven.com";
export const USER_AGENT = "HyperFrames-PolyHaven/1.0";
export const TYPES = ["hdris", "textures", "models"];
export const CREDIT = "Powered by Poly Haven (polyhaven.com). Assets CC0.";
const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

export function defaultCacheDir(env = process.env) {
  if (env.POLYHAVEN_CACHE) return path.resolve(env.POLYHAVEN_CACHE);
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "hyperframes", "polyhaven");
}

const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, "_");

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** HTTP + disk cache. API JSON is cached for `ttlMs`; files are keyed by md5 and kept forever. */
export function createClient(opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const cacheDir = opts.cacheDir || defaultCacheDir();
  const offline = Boolean(opts.offline);
  const ttlMs = opts.ttlMs ?? DAY;
  const log = opts.log || (() => {});
  const stats = { requests: 0, downloads: 0, hits: 0, bytes: 0 };

  async function request(url) {
    if (offline) throw new Error("offline: no cached copy of " + url);
    for (let attempt = 0; ; attempt++) {
      stats.requests++;
      const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 3) throw new Error(`HTTP ${res.status} for ${url}`);
      const after = Number(res.headers?.get?.("retry-after")) || 2 ** attempt;
      log(`retry ${url} in ${after}s (HTTP ${res.status})`);
      await sleep(after * 1000);
    }
  }

  async function getJson(route, key, ttl = ttlMs) {
    const file = path.join(cacheDir, "api", safe(key) + ".json");
    const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < ttl;
    if (fresh || (offline && fs.existsSync(file))) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    const data = await (await request(API + route)).json();
    writeAtomic(file, JSON.stringify(data));
    return data;
  }

  return {
    cacheDir,
    offline,
    stats,
    assets: (type) => getJson(`/assets?t=${type}`, `assets-${type}`),
    files: (id, hash) =>
      getJson(
        `/files/${encodeURIComponent(id)}`,
        `files-${id}-${hash || "x"}`,
        hash ? Infinity : ttlMs,
      ),
    async search(query, type, limit = 20) {
      const q = String(query).trim().toLowerCase().slice(0, 100);
      const route = `/search?q=${encodeURIComponent(q)}&t=${type}&limit=${limit}`;
      try {
        return (await getJson(route, `search-${type}-${q}-${limit}`)).results.map((r) => r.slug);
      } catch (err) {
        log(`search unavailable (${err.message}); using keyword ranking`);
        return null;
      }
    },
    /** Returns a local path for `file` ({url, md5, size}), downloading at most once. */
    async download(file) {
      const name = safe(path.basename(new URL(file.url).pathname));
      const local = path.join(cacheDir, "files", safe(file.md5 || md5(file.url)), name);
      if (fs.existsSync(local) && (!file.md5 || md5(fs.readFileSync(local)) === file.md5)) {
        stats.hits++;
        return local;
      }
      const buf = Buffer.from(await (await request(file.url)).arrayBuffer());
      if (file.md5 && md5(buf) !== file.md5) throw new Error("md5 mismatch for " + file.url);
      writeAtomic(local, buf);
      stats.downloads++;
      stats.bytes += buf.length;
      log(`downloaded ${file.url} (${(buf.length / 1048576).toFixed(1)} MB)`);
      return local;
    },
  };
}

// ---------- selection ----------

const resPx = (r) => parseInt(r, 10) * 1024;
export const sortRes = (list) =>
  [...list].filter((r) => /^\d+k$/.test(r)).sort((a, b) => resPx(a) - resPx(b));

/**
 * Smallest resolution that holds the asset's on-screen size.
 * coverage = fraction of the output height the asset fills (texture: one tile).
 * HDRIs: 1k is enough for lighting; a visible background needs ~4x the output height.
 */
export function chooseResolution(req, available, output = { height: 1080 }) {
  const list = sortRes(available);
  if (!list.length) return null;
  if (req.res && list.includes(req.res)) return req.res;
  const h = output.height || 1080;
  const need =
    req.type === "hdris"
      ? req.background
        ? h * (req.blurred ? 2 : 4)
        : 1024
      : h * (req.coverage ?? 0.5);
  return list.find((r) => resPx(r) >= need) || list[list.length - 1];
}

const MAP_KEYS = {
  diffuse: ["diffuse", "diff", "color", "albedo", "basecolor"],
  normal: ["nor_gl", "normal_gl", "normal"],
  arm: ["arm"],
  rough: ["rough", "roughness"],
  ao: ["ao"],
  metal: ["metal", "metallic", "metalness"],
  displacement: ["displacement", "disp", "height"],
};

function pickMap(files, aliases, res) {
  const keys = Object.keys(files);
  for (const a of aliases) {
    const k = keys.find((x) => x.toLowerCase() === a);
    const byRes = k && files[k][res];
    const f = byRes && (byRes.jpg || byRes.png);
    if (f) return f;
  }
  return null;
}

/** Files to fetch for one asset at `res`, with local paths and the entry points three.js needs. */
export function planFiles(type, id, files, res, opts = {}) {
  const out = [];
  const entry = {};
  const add = (rel, f) => {
    out.push({ path: `${id}/${rel}`, url: f.url, md5: f.md5, size: f.size || 0 });
    return `${id}/${rel}`;
  };
  if (type === "hdris") {
    const f = files.hdri?.[res]?.hdr;
    if (!f) return null;
    entry.hdr = add(path.basename(new URL(f.url).pathname), f);
  } else if (type === "models") {
    const f = files.gltf?.[res]?.gltf;
    if (!f) return null;
    entry.gltf = add(path.basename(new URL(f.url).pathname), f);
    for (const [rel, inc] of Object.entries(f.include || {})) add(rel, inc);
  } else if (type === "textures") {
    const want = ["diffuse", "normal", "arm"];
    if (opts.displacement) want.push("displacement");
    for (const role of want) {
      const f = pickMap(files, MAP_KEYS[role], res);
      if (f) entry[role] = add(path.basename(new URL(f.url).pathname), f);
    }
    if (!entry.arm) {
      for (const role of ["rough", "ao", "metal"]) {
        const f = pickMap(files, MAP_KEYS[role], res);
        if (f) entry[role] = add(path.basename(new URL(f.url).pathname), f);
      }
    }
    if (!entry.diffuse) return null;
  } else {
    throw new Error("unknown type " + type);
  }
  return { files: out, entry, bytes: out.reduce((s, f) => s + f.size, 0) };
}

function availableRes(type, files) {
  if (type === "hdris") return Object.keys(files.hdri || {});
  if (type === "models") return Object.keys(files.gltf || {});
  const diffuse = Object.keys(files).find((k) => MAP_KEYS.diffuse.includes(k.toLowerCase()));
  return Object.keys((diffuse && files[diffuse]) || {});
}

/** Keyword score over name, tags and categories; used when /search is unavailable. */
export function keywordRank(assets, query) {
  const words = String(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  const scored = Object.entries(assets).map(([id, a]) => {
    const name = (a.name || id).toLowerCase();
    const tags = (a.tags || []).map((t) => t.toLowerCase());
    const cats = [...(a.categories || []), a.category || ""].join(" ").toLowerCase();
    let s = 0;
    for (const w of words) {
      if (name.includes(w)) s += 3;
      if (tags.some((t) => t.includes(w))) s += 2;
      if (cats.includes(w)) s += 1;
    }
    return { id, s, d: a.download_count || 0 };
  });
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.d - a.d || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

export function roleType(role, req) {
  if (req.type) return req.type;
  if (/hdri|env|sky|light/i.test(role)) return "hdris";
  if (/model|prop|object|mesh/i.test(role)) return "models";
  return "textures";
}

/**
 * Pick one asset per scene role. Candidates come from Poly Haven's /search
 * ranking (or keyword ranking), `prefer` ids go first, and the first candidate
 * whose files fit the resolution and byte budget wins.
 */
export async function selectAsset(client, role, req, output, maxBytes = DEFAULT_MAX_BYTES) {
  const type = roleType(role, req);
  const all = await client.assets(type);
  if (req.id && !all[req.id]) throw new Error(`no Poly Haven ${type} asset "${req.id}"`);
  const q = req.query || role;
  const ranked = req.id ? [req.id] : (await client.search(q, type)) || keywordRank(all, q);
  const ids = [...(req.id ? [] : req.prefer || []), ...ranked].filter(
    (id, i, a) => all[id] && a.indexOf(id) === i && !(req.exclude || []).includes(id),
  );
  for (const id of ids.slice(0, req.candidates || 8)) {
    const files = await client.files(id, all[id].files_hash);
    const avail = sortRes(availableRes(type, files));
    const first = chooseResolution({ ...req, type }, avail, output);
    // Try the chosen resolution, then smaller ones, until it fits the budget.
    for (const res of avail.slice(0, avail.indexOf(first) + 1).reverse()) {
      const plan = planFiles(type, id, files, res, req);
      if (plan && plan.bytes <= (req.maxBytes || maxBytes))
        return describe(role, type, id, all[id], res, plan);
    }
  }
  throw new Error(`no Poly Haven ${type} fits "${req.query || role}" within the budget`);
}

function describe(role, type, id, a, res, plan) {
  return {
    role,
    id,
    type,
    name: a.name || id,
    url: `https://polyhaven.com/a/${id}`,
    authors: Object.keys(a.authors || {}),
    license: "CC0-1.0",
    files_hash: a.files_hash || null,
    res,
    entry: plan.entry,
    files: plan.files,
    bytes: plan.bytes,
  };
}

/** Resolve every role of `scene`; roles already in `previous` (a manifest) are reused unless refresh. */
export async function resolveScene(client, scene, previous = null, refresh = false) {
  const output = scene.output || { width: 1920, height: 1080 };
  const assets = {};
  for (const [role, req] of Object.entries(scene.assets || {})) {
    const old = previous?.assets?.[role];
    const same = old && (!req.id || req.id === old.id) && (!req.res || req.res === old.res);
    assets[role] =
      same && !refresh ? old : await selectAsset(client, role, req, output, scene.maxBytes);
  }
  return manifest(assets);
}

export function manifest(assets) {
  return { source: "https://polyhaven.com", license: "CC0-1.0", credit: CREDIT, assets };
}

/** Download every file in `man` (cached) into `<outDir>/polyhaven/` and write manifest.json + CREDITS.md. */
export async function materialize(client, man, outDir) {
  const root = path.join(outDir, "polyhaven");
  for (const a of Object.values(man.assets)) {
    for (const f of a.files) {
      const dest = path.join(root, f.path);
      if (fs.existsSync(dest) && (!f.md5 || md5(fs.readFileSync(dest)) === f.md5)) continue;
      const cached = await client.download(f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(cached, dest);
    }
  }
  writeAtomic(path.join(root, "manifest.json"), JSON.stringify(man, null, 2) + "\n");
  writeAtomic(path.join(root, "CREDITS.md"), credits(man));
  return root;
}

export function credits(man) {
  const lines = [
    "# Poly Haven assets",
    "",
    man.credit,
    "",
    "| Role | Asset | Authors | Resolution | License |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const a of Object.values(man.assets)) {
    lines.push(
      `| ${a.role} | [${a.name}](${a.url}) | ${a.authors.join(", ") || "Poly Haven"} | ${a.res} | CC0 |`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Offline check: every manifest file is present with its md5. Returns a list of problems. */
export function verify(outDir) {
  const root = path.join(outDir, "polyhaven");
  const file = path.join(root, "manifest.json");
  if (!fs.existsSync(file)) return ["missing " + file];
  const man = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = [];
  for (const a of Object.values(man.assets)) {
    for (const f of a.files) {
      const p = path.join(root, f.path);
      if (!fs.existsSync(p)) problems.push("missing " + f.path);
      else if (f.md5 && md5(fs.readFileSync(p)) !== f.md5) problems.push("md5 mismatch " + f.path);
    }
  }
  return problems;
}

// ---------- CLI ----------

const USAGE = `polyhaven.mjs — Poly Haven assets for HyperFrames (${CREDIT})

  search <hdris|textures|models> <query...> [--limit 10]
  scene <scene.json> --out <dir> [--refresh]     pick + download every role
  get <hdris|textures|models> <id> --out <dir> [--res 1k] [--role name]
  verify <dir>                                   offline md5 check of <dir>/polyhaven
  cache                                          print cache dir and size

  --offline (or POLYHAVEN_OFFLINE=1)  never touch the network; cache only
  POLYHAVEN_CACHE=<dir>               cache location (default ~/.cache/hyperframes/polyhaven)`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) pos.push(a);
    else if (["--offline", "--refresh", "--displacement"].includes(a)) flags[a.slice(2)] = true;
    else flags[a.slice(2)] = argv[++i];
  }
  return { pos, flags };
}

function readManifest(outDir) {
  const f = path.join(outDir, "polyhaven", "manifest.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => {
    const p = path.join(dir, e.name);
    return s + (e.isDirectory() ? dirSize(p) : fs.statSync(p).size);
  }, 0);
}

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const [cmd, ...rest] = pos;
  const client = createClient({
    offline: flags.offline || process.env.POLYHAVEN_OFFLINE === "1",
    log: (m) => console.error(m),
  });
  const summary = () =>
    console.error(
      `cache ${client.cacheDir}: ${client.stats.downloads} downloaded (${(client.stats.bytes / 1048576).toFixed(1)} MB), ${client.stats.hits} cache hits, ${client.stats.requests} requests`,
    );
  if (cmd === "search") {
    const [type, ...words] = rest;
    if (!TYPES.includes(type)) throw new Error("type must be one of " + TYPES.join(", "));
    const all = await client.assets(type);
    const q = words.join(" ");
    const ids = ((await client.search(q, type)) || keywordRank(all, q)).filter((id) => all[id]);
    for (const id of ids.slice(0, Number(flags.limit) || 10)) {
      const a = all[id];
      console.log(
        `${id}\t${a.name}\t${(a.tags || []).slice(0, 6).join(",")}\t${a.max_resolution?.join("x") || ""}`,
      );
    }
  } else if (cmd === "scene") {
    if (!rest[0] || !flags.out) throw new Error("usage: scene <scene.json> --out <dir>");
    const scene = JSON.parse(fs.readFileSync(rest[0], "utf8"));
    const man = await resolveScene(client, scene, readManifest(flags.out), flags.refresh);
    await materialize(client, man, flags.out);
    for (const a of Object.values(man.assets))
      console.log(`${a.role}\t${a.id}\t${a.res}\t${(a.bytes / 1048576).toFixed(1)} MB`);
    summary();
  } else if (cmd === "get") {
    const [type, id] = rest;
    if (!TYPES.includes(type) || !id || !flags.out)
      throw new Error("usage: get <type> <id> --out <dir>");
    const role = flags.role || id;
    const scene = {
      assets: {
        [role]: { type, id, res: flags.res, displacement: flags.displacement, candidates: 1 },
      },
    };
    const prev = readManifest(flags.out);
    const man = await resolveScene(client, scene, prev);
    man.assets = { ...(prev?.assets || {}), ...man.assets };
    await materialize(client, man, flags.out);
    console.log(`${role}\t${id}\t${man.assets[role].res}`);
    summary();
  } else if (cmd === "verify") {
    const problems = verify(rest[0] || ".");
    if (problems.length) throw new Error(problems.join("\n"));
    console.log("polyhaven assets ok (offline)");
  } else if (cmd === "cache") {
    console.log(`${client.cacheDir}\t${(dirSize(client.cacheDir) / 1048576).toFixed(1)} MB`);
  } else {
    console.log(USAGE);
    if (cmd && cmd !== "help") process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    console.error("polyhaven: " + err.message);
    process.exit(1);
  });
}
