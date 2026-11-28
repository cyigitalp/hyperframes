#!/usr/bin/env node
// photo-search.mjs: find authentic, commercially usable photos for a scene and
// bring them into the video project with their licence and credit. Sources:
// Openverse (CC0 / PDM / CC BY / CC BY-SA, commercial filter), Wikimedia
// Commons (licence read from each file's metadata) and NASA Image Library
// (public domain, not for endorsement). Node 18+, no dependencies.
//
//   search "<query>" [--source openverse|commons|nasa|all] [--limit 8] [--min-width 1280]
//   get <candidates.json> <index> --project DIR --key KEY
// `get` refuses anything not cleared for commercial use, writes the file to
// <project>/assets/photos/, appends <project>/CREDITS.md and registers the
// asset with video-production's production.mjs when the project has one.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { licenceOk } from "./plan-check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = "hyperframes-video-production/1.0 (+https://github.com/cyigitalp/hyperframes)";

const strip = (html) =>
  String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Normalise an Openverse /v1/images result. */
export function fromOpenverse(r) {
  const lic = `${r.license === "pdm" || r.license === "cc0" ? r.license.toUpperCase() : `CC ${String(r.license).toUpperCase()}`}${r.license_version && !["pdm", "cc0"].includes(r.license) ? ` ${r.license_version}` : ""}`;
  return {
    source: "openverse",
    id: r.id,
    title: r.title ?? "",
    url: r.url,
    landing: r.foreign_landing_url,
    width: r.width ?? null,
    height: r.height ?? null,
    creator: r.creator ?? "",
    licence: lic,
    licenceUrl: r.license_url ?? "",
    credit: r.attribution ?? `"${r.title}" by ${r.creator ?? "unknown"}, ${lic}`,
    commercialOk:
      licenceOk(lic.replace(/^CC /, "cc-").toLowerCase().replace(/ /g, "-")) ||
      ["cc0", "pdm"].includes(r.license),
  };
}

/** Normalise a Commons imageinfo page. */
export function fromCommons(p) {
  const ii = p.imageinfo?.[0] ?? {};
  const m = ii.extmetadata ?? {};
  const lic = strip(m.LicenseShortName?.value) || "unknown";
  const nonFree = String(m.NonFree?.value ?? "").toLowerCase() === "true";
  const artist = strip(m.Artist?.value);
  const norm = lic.toLowerCase().replace(/\s+/g, "-");
  return {
    source: "commons",
    id: p.pageid,
    title: (p.title ?? "").replace(/^File:/, ""),
    url: ii.thumburl ?? ii.url,
    original: ii.url,
    landing: ii.descriptionurl,
    width: ii.thumbwidth ?? ii.width ?? null,
    height: ii.thumbheight ?? ii.height ?? null,
    creator: artist,
    licence: lic,
    licenceUrl: strip(m.LicenseUrl?.value),
    credit: `${(p.title ?? "").replace(/^File:/, "")} by ${artist || "unknown"}, ${lic}, via Wikimedia Commons`,
    commercialOk: !nonFree && (licenceOk(norm) || /^public[- ]domain|^pd/i.test(lic)),
  };
}

/** Normalise a NASA images-api item. */
export function fromNasa(it) {
  const d = it.data?.[0] ?? {};
  return {
    source: "nasa",
    id: d.nasa_id,
    title: d.title ?? "",
    url: `https://images-assets.nasa.gov/image/${encodeURIComponent(d.nasa_id)}/${encodeURIComponent(d.nasa_id)}~large.jpg`,
    landing: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
    width: null,
    height: null,
    creator: d.photographer ?? d.center ?? "NASA",
    licence: "NASA (public domain)",
    licenceUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    credit: `${d.title ?? d.nasa_id}. Credit: NASA${d.photographer ? `/${d.photographer}` : ""}`,
    commercialOk: !/logo|insignia/i.test(`${d.title} ${(d.keywords ?? []).join(" ")}`),
    note: "Public domain; NASA must not appear to endorse the video; people shown keep publicity rights.",
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

export async function search(q, { source = "all", limit = 8, minWidth = 0 } = {}) {
  const out = [];
  const errors = [];
  const want = source === "all" ? ["openverse", "commons", "nasa"] : [source];
  for (const s of want) {
    try {
      if (s === "openverse") {
        const j = await getJson(
          `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=${limit}`,
        );
        out.push(...(j.results ?? []).map(fromOpenverse));
      } else if (s === "commons") {
        const j = await getJson(
          `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1920`,
        );
        out.push(...Object.values(j.query?.pages ?? {}).map(fromCommons));
      } else if (s === "nasa") {
        const j = await getJson(
          `https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(q)}`,
        );
        out.push(...(j.collection?.items ?? []).slice(0, limit).map(fromNasa));
      } else throw new Error(`unknown source ${s}`);
    } catch (e) {
      errors.push(`${s}: ${e.message}`);
    }
  }
  const ok = out.filter((c) => c.commercialOk && (!minWidth || !c.width || c.width >= minWidth));
  return { query: q, candidates: ok, rejected: out.length - ok.length, errors };
}

export async function get(cands, index, { project, key }) {
  const c = (cands.candidates ?? cands)[index];
  if (!c) throw new Error(`no candidate ${index}`);
  if (!c.commercialOk)
    throw new Error(`${c.title}: licence ${c.licence} is not cleared for commercial use`);
  const res = await fetch(c.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`download ${c.url}: HTTP ${res.status}`);
  const ext = (res.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg";
  const rel = path.join("assets", "photos", `${key}.${ext}`);
  const abs = path.join(project, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
  const credits = path.join(project, "CREDITS.md");
  const line =
    `- ${key}: ${c.credit} (${c.licence}${c.licenceUrl ? `, ${c.licenceUrl}` : ""}) ${c.landing ?? ""}`.trim();
  const prev = fs.existsSync(credits) ? fs.readFileSync(credits, "utf8") : "# Credits\n\n";
  if (!prev.includes(`- ${key}:`)) fs.writeFileSync(credits, `${prev.trimEnd()}\n${line}\n`);
  let registered = false;
  if (fs.existsSync(path.join(project, "production", "state.json"))) {
    const P = await import(
      pathToFileURL(path.join(HERE, "..", "video-production", "production.mjs")).href
    );
    P.asset(project, key, {
      path: rel,
      source: c.landing ?? c.url,
      licence: c.licence,
      credits: 0,
    });
    registered = true;
  }
  return {
    key,
    path: rel,
    licence: c.licence,
    credit: c.credit,
    registered,
    provenance: "authentic",
  };
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (k, d) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : d;
  };
  const pos = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
  if (cmd === "search" && pos[0]) {
    const r = await search(pos.join(" "), {
      source: flag("source", "all"),
      limit: Number(flag("limit", 8)),
      minWidth: Number(flag("min-width", 0)),
    });
    console.log(JSON.stringify(r, null, 2));
    return r.candidates.length ? 0 : 1;
  }
  if (cmd === "get" && pos[1] != null && flag("project") && flag("key")) {
    const cands = JSON.parse(fs.readFileSync(pos[0], "utf8"));
    console.log(
      JSON.stringify(
        await get(cands, Number(pos[1]), { project: flag("project"), key: flag("key") }),
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(
    'usage: photo-search.mjs search "<query>" [--source openverse|commons|nasa|all] [--limit N] [--min-width PX]\n       photo-search.mjs get <candidates.json> <index> --project DIR --key KEY',
  );
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(`photo-search: ${e.message}`);
      process.exitCode = 1;
    },
  );
