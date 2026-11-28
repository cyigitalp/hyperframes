#!/usr/bin/env node
// Production checkpoints for an autonomous HyperFrames video.
// No dependencies (Node 18+). Library exports below; CLI at the bottom.
//
// State lives in <project>/production/state.json. Every finished stage, scene
// and asset records the sha256 of its files, so a resumed session trusts what
// still matches, redoes only what changed or failed, and never pays twice for
// an asset. Paid calls go through `spend`, which refuses anything past the
// owner's credit budget.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STAGES = [
  "brief", // the approved idea, audience, length, credit budget
  "research", // facts with sources
  "script", // narration script, hook in the first 3 s
  "direction", // creative direction and scene plan (scenes.json)
  "narration", // ElevenLabs narration file + word timings
  "assets", // every image, clip, model, cutout, sound the plan needs
  "scenes", // every scene composition built and checked
  "edit", // master timeline, transitions, music, SFX mix
  "render", // full MP4 render
  "qc", // check, snapshot review, sound check, final evaluation
  "deliver", // MP4, thumbnail, title, SEO description
];
export const SCENE_STATES = ["planned", "built", "ok", "failed"];
export const EXIT = { ok: 0, missing: 1, usage: 2, budget: 3, incomplete: 4 };

const now = () => new Date().toISOString();

export function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function statePath(dir) {
  return path.join(dir, "production", "state.json");
}

export function load(dir) {
  const p = statePath(dir);
  if (!fs.existsSync(p)) throw new Error(`no production at ${dir}; run init first`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function save(dir, s) {
  const p = statePath(dir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`);
  fs.renameSync(tmp, p); // atomic: an interrupted write never corrupts state
}

export function init(dir, { title = "", credits = 0 } = {}) {
  if (fs.existsSync(statePath(dir))) return load(dir); // resume, never reset
  const s = {
    version: 1,
    title,
    created: now(),
    budget: { credits: Number(credits) || 0, spent: 0, ledger: [] },
    stages: Object.fromEntries(STAGES.map((k) => [k, { status: "pending" }])),
    scenes: {},
    assets: {},
  };
  save(dir, s);
  return s;
}

function record(dir, files) {
  const out = {};
  for (const f of files) {
    const abs = path.resolve(dir, f);
    if (!fs.existsSync(abs)) throw new Error(`missing output: ${f}`);
    out[path.relative(dir, abs)] = sha256(abs);
  }
  return out;
}

function changed(dir, outputs = {}) {
  return Object.entries(outputs)
    .filter(([f, h]) => !fs.existsSync(path.join(dir, f)) || sha256(path.join(dir, f)) !== h)
    .map(([f]) => f);
}

export function done(dir, stage, files = [], note = "") {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  if (stage === "deliver") {
    const gate = deliverCheck(dir);
    if (!gate.ok) throw new Error(`deliver gate: ${gate.problems.join("; ")}`);
  }
  const s = load(dir);
  s.stages[stage] = { status: "done", at: now(), outputs: record(dir, files), note };
  save(dir, s);
  return s;
}

// Targeted correction: reopen one stage; later stages stay done but are
// listed as "recheck" by status until they are confirmed or redone.
export function reopen(dir, stage, note = "") {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  const s = load(dir);
  s.stages[stage] = { ...s.stages[stage], status: "pending", reopened: now(), note };
  save(dir, s);
  return s;
}

export function scene(dir, id, state, files = [], note = "") {
  if (!SCENE_STATES.includes(state)) throw new Error(`scene state: ${SCENE_STATES.join("|")}`);
  const s = load(dir);
  const prev = s.scenes[id] ?? { attempts: 0 };
  s.scenes[id] = {
    status: state,
    attempts: prev.attempts + (state === "failed" ? 1 : 0),
    at: now(),
    outputs: files.length ? record(dir, files) : (prev.outputs ?? {}),
    note: note || prev.note || "",
  };
  save(dir, s);
  return s.scenes[id];
}

// Register an asset (with path) or ask whether it is already usable (without).
// A registered asset whose file still matches is never regenerated.
export function asset(dir, key, meta) {
  const s = load(dir);
  if (!meta?.path) {
    const a = s.assets[key];
    if (!a) return { ok: false, why: "not registered" };
    const abs = path.join(dir, a.path);
    if (!fs.existsSync(abs)) return { ok: false, why: "file missing", ...a };
    if (sha256(abs) !== a.sha256) return { ok: false, why: "file changed", ...a };
    return { ok: true, ...a };
  }
  const abs = path.resolve(dir, meta.path);
  if (!fs.existsSync(abs)) throw new Error(`missing asset file: ${meta.path}`);
  s.assets[key] = {
    path: path.relative(dir, abs),
    sha256: sha256(abs),
    source: meta.source ?? "",
    licence: meta.licence ?? "",
    credits: Number(meta.credits) || 0,
    job: meta.job ?? "",
    at: now(),
  };
  save(dir, s);
  return { ok: true, ...s.assets[key] };
}

// Check (and with record=true, book) a paid call. Refuses past the budget
// unless the owner approved this exact spend.
export function spend(dir, credits, { what = "", approved = false, record: book = true } = {}) {
  const s = load(dir);
  const c = Number(credits);
  if (!(c >= 0)) throw new Error("credits must be a number >= 0");
  const left = s.budget.credits - s.budget.spent;
  if (c > left && !approved) return { ok: false, left, need: c };
  if (book) {
    s.budget.spent += c;
    s.budget.ledger.push({ at: now(), credits: c, what, approved: Boolean(approved) });
    save(dir, s);
  }
  return { ok: true, left: s.budget.credits - s.budget.spent, need: c };
}

export function setBudget(dir, credits, note = "") {
  const s = load(dir);
  s.budget.credits = Number(credits);
  s.budget.ledger.push({ at: now(), credits: 0, what: `budget set to ${credits}. ${note}`.trim() });
  save(dir, s);
  return s.budget;
}

// Where to resume: the first stage that is not done or whose files changed.
export function status(dir) {
  const s = load(dir);
  const stages = STAGES.map((k) => {
    const st = s.stages[k];
    const diff = st.status === "done" ? changed(dir, st.outputs) : [];
    return { stage: k, status: diff.length ? "stale" : st.status, changed: diff };
  });
  const firstOpen = stages.findIndex((x) => x.status !== "done");
  for (const x of stages.slice(firstOpen + 1))
    if (firstOpen >= 0 && x.status === "done") x.status = "recheck";
  const scenes = Object.entries(s.scenes).map(([id, sc]) => {
    const diff = sc.status === "ok" ? changed(dir, sc.outputs) : [];
    return { id, status: diff.length ? "stale" : sc.status, attempts: sc.attempts, note: sc.note };
  });
  return {
    title: s.title,
    next: firstOpen >= 0 ? stages[firstOpen].stage : null,
    stages,
    scenes,
    repair: scenes.filter((x) => x.status !== "ok").map((x) => x.id),
    assets: Object.keys(s.assets).length,
    budget: {
      credits: s.budget.credits,
      spent: s.budget.spent,
      left: s.budget.credits - s.budget.spent,
    },
  };
}

export function words(text = "") {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Final gate on production/delivery.json before telling the owner it is done.
export function deliverCheck(dir) {
  const problems = [];
  const p = path.join(dir, "production", "delivery.json");
  if (!fs.existsSync(p)) return { ok: false, problems: ["production/delivery.json missing"] };
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const k of ["video", "thumbnail"]) {
    const f = d[k] && path.join(dir, d[k]);
    if (!f || !fs.existsSync(f) || fs.statSync(f).size === 0)
      problems.push(`${k} file missing or empty`);
  }
  if (d.video && !/\.mp4$/i.test(d.video)) problems.push("video is not an .mp4");
  if (!d.title || d.title.length > 100) problems.push("title missing or over 100 characters");
  if (!d.description || d.description.length > 5000)
    problems.push("description missing or over 5000 characters");
  if (!d.thumbnailText || words(d.thumbnailText) > 3)
    problems.push("thumbnailText missing or over three words");
  const st = status(dir);
  if (st.repair.length) problems.push(`scenes not ok: ${st.repair.join(", ")}`);
  for (const x of st.stages)
    if (x.stage !== "deliver" && x.status !== "done")
      problems.push(`stage ${x.stage} is ${x.status}`);
  return { ok: problems.length === 0, problems };
}

// ---- CLI -------------------------------------------------------------------

function parse(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { flags, pos };
}

const USAGE = `production.mjs <command> <project> ...
  init <dir> [--title T] [--credits N]   create or resume state
  status <dir> [--json]                   resume point, stale files, scenes to repair, budget
  done <dir> <stage> [files...] [--note]  mark a stage done, hashing its outputs
  reopen <dir> <stage> [--note]           reopen one stage for a targeted correction
  scene <dir> <id> <planned|built|ok|failed> [files...] [--note]
  asset <dir> <key>                       exit 0 if registered and unchanged, else 1
  asset <dir> <key> --path P [--source S --licence L --credits N --job J]
  spend <dir> <credits> --what W [--approved] [--check]   exit 3 if over budget
  budget <dir> <credits> [--note]         set the owner's approved budget
  deliver <dir>                           final gate on production/delivery.json
stages: ${STAGES.join(" ")}`;

export function main(argv) {
  const [cmd, dir, ...rest] = argv;
  const { flags, pos } = parse(rest);
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  if (!cmd || !dir || cmd === "help") {
    console.log(USAGE);
    return cmd ? EXIT.ok : EXIT.usage;
  }
  switch (cmd) {
    case "init":
      init(dir, { title: flags.title, credits: flags.credits });
      out(status(dir));
      return EXIT.ok;
    case "status": {
      const st = status(dir);
      if (flags.json) out(st);
      else {
        console.log(`next: ${st.next ?? "nothing (delivered)"}`);
        for (const x of st.stages)
          console.log(
            `  ${x.stage.padEnd(10)} ${x.status}${x.changed.length ? ` (${x.changed.join(", ")})` : ""}`,
          );
        if (st.repair.length) console.log(`repair scenes: ${st.repair.join(", ")}`);
        console.log(`assets: ${st.assets}  credits: ${st.budget.spent}/${st.budget.credits}`);
      }
      return EXIT.ok;
    }
    case "done":
      done(dir, pos[0], pos.slice(1), flags.note === true ? "" : (flags.note ?? ""));
      return EXIT.ok;
    case "reopen":
      reopen(dir, pos[0], flags.note === true ? "" : (flags.note ?? ""));
      return EXIT.ok;
    case "scene":
      out(scene(dir, pos[0], pos[1], pos.slice(2), flags.note === true ? "" : (flags.note ?? "")));
      return EXIT.ok;
    case "asset": {
      const r = asset(dir, pos[0], typeof flags.path === "string" ? flags : null);
      out(r);
      return r.ok ? EXIT.ok : EXIT.missing;
    }
    case "spend": {
      const r = spend(dir, pos[0], {
        what: flags.what ?? "",
        approved: Boolean(flags.approved),
        record: !flags.check,
      });
      out(r);
      return r.ok ? EXIT.ok : EXIT.budget;
    }
    case "budget":
      out(setBudget(dir, pos[0], flags.note === true ? "" : (flags.note ?? "")));
      return EXIT.ok;
    case "deliver": {
      const r = deliverCheck(dir);
      out(r);
      return r.ok ? EXIT.ok : EXIT.incomplete;
    }
    default:
      console.log(USAGE);
      return EXIT.usage;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`production: ${e.message}`);
    process.exitCode = EXIT.usage;
  }
}
