#!/usr/bin/env node
// plan-check.mjs: lint a scene plan (production/scenes.json) for the creative
// failures that a render cannot fix later: a title-card hook, real-world claims
// shown only with made-up graphics, unlabeled AI recreations of real things,
// unlicensed media, static slides, unmotivated camera moves, rigid "character
// animation", repetition and a missing art direction. No dependencies.
//
//   node plan-check.mjs <scenes.json> [--direction direction.md] [--json]
// Exit 0 = no errors (warnings allowed), 1 = errors, 2 = usage.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const EVIDENCE = ["authentic", "recreation", "illustrative", "data"];
export const PROVENANCE = ["authentic", "ai", "built"];
// Licences cleared for a commercial YouTube video (credit what asks for it).
const OK_LICENCES = [
  /^cc0/,
  /^pdm/,
  /^public[- ]domain/,
  /^pd\b/,
  /^cc[- ]by(?![- ]?nc)(?![- ]?nd)(-sa)?\b/,
  /^unsplash/,
  /^pexels/,
  /^nasa/,
  /^us[- ]gov/,
  /^poly ?haven/,
  /^own/,
  /^generated/,
  /^mit\b/,
  /^apache/,
  /^ofl/,
];
const BAD_LICENCE =
  /\b(nc|nd|non[- ]?commercial|no[- ]?deriv|editorial[- ]only|all rights reserved)\b/i;
const STILL_ACTIONS = new Set(["move", "slide", "translate", "pan", "fade", "scale"]);

export function licenceOk(l) {
  const s = String(l ?? "")
    .trim()
    .toLowerCase();
  if (!s || BAD_LICENCE.test(s)) return false;
  return OK_LICENCES.some((re) => re.test(s));
}

/** Layers of a scene, from `layers` or inferred from a legacy `assets` list. */
export function layersOf(scene) {
  if (Array.isArray(scene.layers)) return scene.layers;
  return (scene.assets ?? []).map((a) => ({
    kind: a.kind ?? "asset",
    source: a.source,
    provenance:
      a.provenance ??
      (a.source === "generate" ? "ai" : a.source === "find" ? "authentic" : "built"),
    licence: a.licence,
    subject: a.key,
    legacy: true,
  }));
}

const moveOf = (cam) => (typeof cam === "string" ? cam : (cam?.move ?? ""));

export function check(plan, { direction = "" } = {}) {
  const scenes = Array.isArray(plan) ? plan : (plan.scenes ?? []);
  const look = Array.isArray(plan) ? null : plan.look;
  const errors = [];
  const warnings = [];
  const E = (id, msg) => errors.push(`${id}: ${msg}`);
  const W = (id, msg) => warnings.push(`${id}: ${msg}`);
  if (!scenes.length) return { ok: false, errors: ["plan: no scenes"], warnings, stats: {} };

  // Hook
  const s0 = scenes[0];
  if ((s0.start ?? 0) > 0.05) E(s0.id, `the film starts at ${s0.start} s: the hook is frame 0`);
  if (
    s0.treatment === "title" ||
    (/title card|logo/i.test(s0.transitionIn ?? "") &&
      !/no title card/i.test(s0.transitionIn ?? ""))
  )
    E(s0.id, "opens on a title or logo card: open on the subject already in motion");
  if (!s0.hook && !/hook/i.test(s0.notes ?? ""))
    W(s0.id, "first scene has no `hook`: what grabs the viewer in the first 1-3 s?");

  const duration = Math.max(...scenes.map((s) => s.end ?? 0));
  const treatments = {};
  const prov = { authentic: 0, ai: 0, built: 0 };
  let builtOnly = 0;
  let gags = 0;

  scenes.forEach((sc, i) => {
    const id = sc.id ?? `scene${i + 1}`;
    const layers = layersOf(sc);
    if (!sc.evidence)
      W(
        id,
        "no `evidence` (authentic | recreation | illustrative | data): decide what the viewer is shown as true",
      );
    else if (!EVIDENCE.includes(sc.evidence))
      E(id, `evidence "${sc.evidence}" is not one of ${EVIDENCE.join(", ")}`);
    if (sc.treatment) treatments[sc.treatment] = (treatments[sc.treatment] ?? 0) + 1;

    const has = (p) => layers.some((l) => l.provenance === p);
    for (const l of layers) if (prov[l.provenance] != null) prov[l.provenance]++;
    if (layers.length && layers.every((l) => l.provenance === "built")) builtOnly++;

    if (sc.evidence === "authentic" && !has("authentic"))
      E(
        id,
        "shows a real event, place, person or product with no authentic layer (photo, footage, archive, document): find real evidence or mark the scene a recreation",
      );
    if (sc.evidence === "recreation" && !layers.some((l) => l.label) && !sc.label)
      E(id, 'a recreation must say so on screen (`label`, e.g. "AI recreation" or "Illustration")');

    for (const l of layers) {
      const what = l.subject ?? l.kind ?? "layer";
      if (l.provenance && !PROVENANCE.includes(l.provenance))
        E(id, `${what}: provenance "${l.provenance}" is not one of ${PROVENANCE.join(", ")}`);
      if (l.provenance === "ai" && l.real && l.person)
        E(id, `${what}: never generate the likeness of a real person`);
      if (l.provenance === "ai" && l.real && !l.label)
        E(id, `${what}: an AI image of a real ${l.kind ?? "thing"} needs an on-screen label`);
      if (l.source === "find" || l.provenance === "authentic") {
        if (!l.licence && !l.legacy) E(id, `${what}: found media needs a licence`);
        else if (l.licence && !licenceOk(l.licence))
          E(id, `${what}: licence "${l.licence}" is not cleared for commercial use`);
        else if (l.licence && /by/i.test(l.licence) && !l.credit)
          W(id, `${what}: ${l.licence} needs a credit line`);
      }
    }

    const move = moveOf(sc.camera);
    const camMoves = move && !/^(none|static|locked|lock)/i.test(move);
    const acts = sc.character?.actions ?? [];
    const layerMotion = layers.some((l) => l.motion) || Boolean(sc.motion);
    if (!camMoves && !acts.length && !layerMotion && !sc.hold)
      E(
        id,
        "nothing moves: give it a motivated camera move, a performance or animated layers (or `hold: true` with a reason)",
      );
    if (camMoves && typeof sc.camera === "object" && !sc.camera.motivation)
      W(
        id,
        `camera "${move}" has no motivation (a beat word, a reveal, a subject move): drop it or say why`,
      );
    if (sc.character) {
      const names = acts.map((a) => (typeof a === "string" ? a : a.preset));
      if (!names.length || names.every((n) => STILL_ACTIONS.has(n)))
        E(
          id,
          "the character only moves as a whole picture: perform with rig presets (walk, talk, gesture, look, expression, take, reach)",
        );
      else if (new Set(names).size < 2)
        W(id, "the character does one thing: layer a second action (blink, look, expression)");
    }
    if (sc.gag) gags++;
  });

  // Variety without quotas
  for (let i = 2; i < scenes.length; i++) {
    const k = (s) =>
      `${s.treatment ?? ""}|${typeof s.camera === "object" ? (s.camera.shot ?? "") : ""}`;
    if (
      scenes[i].treatment &&
      k(scenes[i]) === k(scenes[i - 1]) &&
      k(scenes[i]) === k(scenes[i - 2])
    )
      W(
        scenes[i].id,
        "third scene in a row with the same treatment and shot: vary scale, framing or medium",
      );
  }
  if (scenes.length >= 5)
    for (const [t, n] of Object.entries(treatments))
      if (n / scenes.length > 0.6)
        W(
          "film",
          `${Math.round((100 * n) / scenes.length)}% of scenes are "${t}": fine if the story needs it, otherwise mix media`,
        );
  if (scenes.length >= 4 && builtOnly / scenes.length > 0.7)
    W(
      "film",
      `${builtOnly} of ${scenes.length} scenes are code-built graphics only: add real photos, footage, 3D or characters where the story allows`,
    );
  const wantGags = Math.floor(duration / 30);
  if (wantGags > 0 && gags < wantGags)
    W(
      "film",
      `${gags} gag(s) in ${Math.round(duration)} s: aim for a joke or visual turn every 20-30 s (\`gag\`)`,
    );
  if (!look && !/^##\s*look/im.test(direction))
    W(
      "film",
      "no art direction: add `look` (palette, type, texture, light, lens) to the plan or a `## Look` section to direction.md",
    );

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { scenes: scenes.length, duration, treatments, provenance: prov, gags },
  };
}

export function main(argv) {
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    console.log("usage: plan-check.mjs <scenes.json> [--direction direction.md] [--json]");
    return 2;
  }
  const di = argv.indexOf("--direction");
  const direction =
    di >= 0 && fs.existsSync(argv[di + 1]) ? fs.readFileSync(argv[di + 1], "utf8") : "";
  const r = check(JSON.parse(fs.readFileSync(file, "utf8")), { direction });
  if (argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    for (const e of r.errors) console.log(`error   ${e}`);
    for (const w of r.warnings) console.log(`warning ${w}`);
    console.log(
      `${r.errors.length} error(s), ${r.warnings.length} warning(s); provenance ${JSON.stringify(r.stats.provenance ?? {})}`,
    );
  }
  return r.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exitCode = main(process.argv.slice(2));
