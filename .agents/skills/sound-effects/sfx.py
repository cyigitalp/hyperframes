"""sfx.py: sound effects for HyperFrames videos with earshot (MIT, CPU only, no API key, no model download).

Commands (run through sfx.sh, which provides the pinned venv):
  render CUES.json --out PROJECT [--offline]   make every cue and bed, place them on the timeline, duck music and
                                              beds under the narration, write audio/mix.wav, sfx/cues.js, a manifest
                                              and CREDITS.md
  check PROJECT [--render out.mp4] [--json]    loudness, true peak, silence, narration margin, cue sync in the
                                              rendered audio, audio/video length and (optionally) visual hits
  analyze FILE [--json]                        loudness (BS.1770), true peak, LRA, silences and onsets of a file
  earshot ARGS...                              the earshot CLI itself (make, sounds, sfx, kit, measure, doctor)
  cache                                        what the take cache holds
  doctor                                       versions, pins and paths

Nothing here touches how the narration is made: a narration file (for example ElevenLabs audio exported from
Higgsfield) is read, never rewritten; the mix only sets music, beds and effects relative to it.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

SR = 48000
CACHE = os.environ.get("HYPERFRAMES_CACHE") or os.path.join(os.path.expanduser("~"), ".cache", "hyperframes")
TAKES = os.path.join(CACHE, "earshot", "takes")
SPEC_KEYS = ("want", "sound", "bank", "seed", "dur", "apex", "pitch", "events", "voice", "material", "loop",
             "bright", "hard", "ring", "size", "space", "width", "energy", "motion")
AXES = ("bright", "hard", "ring", "size", "space", "width", "energy", "motion")
ALIGNS = ("onset", "peak", "end")
DEFAULT_MIX = {
    "target_lufs": -14.0,          # integrated loudness of the finished mix (web video)
    "ceiling_dbtp": -1.5,          # true-peak ceiling of the finished mix
    "music_under_voice_lu": 18.0,  # music bed this far under the narration's integrated loudness
    "bed_under_voice_lu": 20.0,    # ambience beds this far under the narration
    "sfx_under_voice_lu": 3.0,     # a one-shot's loudest moment this far under the narration while it speaks
    "duck_db": 8.0,                # extra dip of music and beds while the narration speaks
    "duck_attack_s": 0.08,
    "duck_release_s": 0.35,
    "min_voice_margin_lu": 6.0,    # while it speaks, the narration stays this far over everything else (400 ms)
    "music_lufs": -20.0,           # music level when there is no narration
}


class SfxError(Exception):
    pass


# ----------------------------------------------------------------------------- earshot access

def earshot_pin():
    """the commit earshot was installed from (part of every cache key)"""
    try:
        from importlib import metadata
        d = metadata.distribution("earshot")
        info = json.loads(d.read_text("direct_url.json") or "{}")
        return info.get("vcs_info", {}).get("commit_id") or d.version
    except Exception:  # noqa: BLE001 - any failure only weakens the key, never the result
        return "unknown"


def _features():
    from earshot import features
    return features


def stereo(x):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    return x[:, :2]


def load(path):
    from earshot import audio
    return stereo(audio.load(path, cache=False))


def write(path, x):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sf.write(path, np.asarray(x, dtype=np.float32), SR, subtype="FLOAT")


def db(v):
    return 20 * np.log10(np.maximum(v, 1e-12))


# ----------------------------------------------------------------------------- specs and cues

def snap(t, fps):
    return round(float(t) * fps) / fps


def resolve(doc):
    """validate a cues document and expand library presets: returns (cues, beds, fps, duration)"""
    fps = float(doc.get("fps", 30))
    if fps <= 0:
        raise SfxError("fps must be > 0")
    duration = doc.get("duration")
    if duration is None or float(duration) <= 0:
        raise SfxError("duration (seconds) is required and must be > 0")
    duration = float(duration)
    lib = doc.get("library", {})
    seen = set()
    cues = []
    for c in doc.get("cues", []):
        cid = c.get("id")
        if not cid or not isinstance(cid, str):
            raise SfxError(f"every cue needs a string id: {c}")
        if cid in seen:
            raise SfxError(f"duplicate cue id {cid!r}")
        seen.add(cid)
        base = {}
        if "use" in c:
            if c["use"] not in lib:
                raise SfxError(f"cue {cid!r} uses {c['use']!r}, which is not in library")
            base = dict(lib[c["use"]])
        spec = {**base, **{k: v for k, v in c.items() if k != "use"}}
        if "frame" in spec:
            spec["at"] = float(spec["frame"]) / fps
        if "at" not in spec:
            raise SfxError(f"cue {cid!r} needs at (seconds) or frame")
        spec["at"] = snap(spec["at"], fps)
        if not 0 <= spec["at"] <= duration:
            raise SfxError(f"cue {cid!r} at {spec['at']} s is outside 0..{duration} s")
        spec.setdefault("align", "peak")
        if spec["align"] not in ALIGNS:
            raise SfxError(f"cue {cid!r}: align must be one of {ALIGNS}")
        if not any(spec.get(k) for k in ("want", "sound", "bank")):
            raise SfxError(f"cue {cid!r} needs want (words), sound (an earshot design id) or bank (a bank id)")
        spec["frame"] = int(round(spec["at"] * fps))
        cues.append(spec)
    beds = []
    for b in doc.get("beds", []):
        bid = b.get("id")
        if not bid or bid in seen:
            raise SfxError(f"every bed needs a unique id: {b}")
        seen.add(bid)
        base = dict(lib[b["use"]]) if b.get("use") in lib else {}
        spec = {**base, **{k: v for k, v in b.items() if k != "use"}}
        spec["from"] = snap(spec.get("from", 0), fps)
        spec["to"] = snap(spec.get("to", duration), fps)
        if not 0 <= spec["from"] < spec["to"] <= duration:
            raise SfxError(f"bed {bid!r} must satisfy 0 <= from < to <= duration")
        spec.setdefault("dur", round(spec["to"] - spec["from"], 3))
        beds.append(spec)
    return cues, beds, fps, duration


def take_key(spec):
    body = {k: spec[k] for k in SPEC_KEYS if spec.get(k) is not None}
    body["seed"] = int(spec.get("seed", 0))
    body["_earshot"] = earshot_pin()
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:24]


def render_take(spec, offline=False, log=print):
    """one earshot take for a spec, cached by its parameters and the earshot commit: (audio, meta, hit)"""
    key = take_key(spec)
    wav, meta_p = os.path.join(TAKES, key + ".wav"), os.path.join(TAKES, key + ".json")
    if os.path.exists(wav) and os.path.exists(meta_p):
        with open(meta_p, encoding="utf-8") as f:
            return load(wav), json.load(f), True
    if offline:
        raise SfxError(f"--offline: {spec.get('id')} ({key}) is not in the take cache {TAKES}")
    os.makedirs(TAKES, exist_ok=True)
    seed = int(spec.get("seed", 0))
    if spec.get("bank"):
        from earshot.forge import bank
        y, m = bank.render(spec["bank"], seed=seed, dur=spec.get("dur"), apex=spec.get("apex"),
                           pitch=spec.get("pitch"))
        x = stereo(y)
        meta = {"design": spec["bank"], "engine": "earshot.forge.bank", "summary": spec["bank"]}
    else:
        from earshot.make import make
        kw = {k: spec[k] for k in ("pitch", "dur", "voice", "material", "loop", "events") if spec.get(k) is not None}
        kw.update({k: spec[k] for k in AXES if spec.get(k) is not None})
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "take.wav")
            r = make(spec.get("want"), out=out, sound=spec.get("sound"), seed=seed, **kw)
            x = load(r["files"][0])
        take = (r.get("takes") or [{}])[0]
        meta = {"design": r.get("sound"), "engine": "earshot.make", "summary": r.get("summary", "").split("\n")[0],
                "also": r.get("also", []), "member": take.get("member"), "unknown": r.get("unknown", []),
                "not_in_sound": r.get("not_in_sound", [])}
    meta.update(landmarks(x))
    meta["earshot"] = earshot_pin()
    write(wav, x)
    with open(meta_p, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    log(f"  made {spec.get('id')}: {meta['summary']}")
    return x, meta, False


def landmarks(x):
    """onset, peak and end of a take in seconds, from a 10 ms RMS envelope"""
    m = np.abs(stereo(x)).max(axis=1)
    hop = int(0.01 * SR)
    n = max(1, len(m) // hop)
    env = np.sqrt(np.mean(m[: n * hop].reshape(n, hop) ** 2, axis=1)) if len(m) >= hop else np.array([m.max()])
    top = env.max() + 1e-12
    on = int(np.argmax(env > top * 10 ** (-30 / 20)))
    above = np.nonzero(env > top * 10 ** (-40 / 20))[0]
    end = int(above[-1]) + 1 if len(above) else n
    return {"onset_s": round(on * hop / SR, 4), "peak_s": round(int(np.argmax(env)) * hop / SR + 0.005, 4),
            "end_s": round(min(len(m), end * hop) / SR, 4), "length_s": round(len(m) / SR, 4)}


# ----------------------------------------------------------------------------- loudness and the mix

def momentary(x, hop=0.05):
    """(t, LUFS) of 400 ms blocks, BS.1770 K-weighted (earshot.features)"""
    return _features().loudness_curve(stereo(x), 0.4, hop)


def integrated(x):
    return float(_features().integrated_lufs(stereo(x)))


def true_peak(x):
    return float(_features().true_peak_dbtp(stereo(x)))


def place(track, x, start):
    """add x into track at sample `start`, clipping to the track"""
    s = int(round(start * SR))
    a, b = max(0, s), min(len(track), s + len(x))
    if b > a:
        track[a:b] += x[a - s: b - s]


def fit_len(x, n, loop=True):
    if len(x) >= n:
        return x[:n]
    if not loop:
        return np.concatenate([x, np.zeros((n - len(x), 2))])
    reps = int(np.ceil(n / max(1, len(x))))
    return np.concatenate([x] * reps)[:n]


def fades(x, fin=0.02, fout=0.05):
    x = x.copy()
    a, b = min(len(x), int(fin * SR)), min(len(x), int(fout * SR))
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None]
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None]
    return x


def activity(voice, ref_lufs, hop=0.01):
    """per-sample 0/1 mask of where the narration speaks (momentary loudness within 15 LU of its integrated)"""
    t, L = momentary(voice, hop)
    act = (L > ref_lufs - 15).astype(np.float64)
    idx = np.clip((np.arange(len(voice)) / SR / hop).astype(int) - int(0.2 / hop), 0, len(act) - 1)
    return act[idx]


def smooth_gain(target_db, attack, release):
    """one-pole smoothing of a per-sample gain curve in dB: falls in `attack`, recovers in `release`"""
    a, r = np.exp(-1 / (attack * SR)), np.exp(-1 / (release * SR))
    out = np.empty_like(target_db)
    g = 0.0
    # sample-rate loop on a decimated curve, then interpolated back: fast and smooth enough for gain
    step = 48
    coarse = target_db[::step]
    ca, cr = a ** step, r ** step
    res = np.empty_like(coarse)
    for i, v in enumerate(coarse):
        c = ca if v < g else cr
        g = c * g + (1 - c) * v
        res[i] = g
    out[:] = np.interp(np.arange(len(target_db)), np.arange(len(coarse)) * step, res)
    return out


def guard(voice, rest, act, margin, ref_lufs, rounds=4):
    """lower `rest` wherever it comes within `margin` LU of the narration while the narration speaks; returns
    (rest, gain_db). Never touches the voice."""
    gain = np.zeros(len(rest))
    for _ in range(rounds):
        t, Lv = momentary(voice, 0.05)
        _, Lr = momentary(rest * 10 ** (gain[:, None] / 20), 0.05)
        speak = Lv > ref_lufs - 15
        over = np.where(speak, Lr - (Lv - margin), -99.0)
        if over.max() <= 0.05:
            break
        need = np.zeros(len(rest))
        for ti, o in zip(t, over):
            if o > 0:
                a, b = max(0, int((ti - 0.3) * SR)), max(0, int((ti + 0.3) * SR))
                np.minimum(need[a:b], -(o + 0.5), out=need[a:b])
        gain = gain + smooth_gain(need, 0.005, 0.15)
    return rest * 10 ** (gain[:, None] / 20), gain


def voice_margin(voice, rest, ref_lufs):
    """the smallest (narration - everything else) momentary gap while the narration speaks, in LU"""
    t, Lv = momentary(voice, 0.05)
    _, Lr = momentary(rest, 0.05)
    speak = Lv > ref_lufs - 15
    if not speak.any():
        return None, None
    gap = (Lv - Lr)[speak]
    i = int(np.argmin(gap))
    return round(float(gap[i]), 2), round(float(t[speak][i]), 2)


def mix(doc, base, cues_audio, beds_audio, duration, log=print):
    """build stems and the mix; returns (stems dict, report)"""
    cfg = {**DEFAULT_MIX, **doc.get("mix", {})}
    n = int(round(duration * SR))
    voice = np.zeros((n, 2))
    nar = doc.get("narration")
    ref = cfg["target_lufs"]
    rep = {"mix": cfg}
    if nar:
        src = os.path.join(base, nar["file"])
        if not os.path.exists(src):
            raise SfxError(f"narration file not found: {src}")
        v = load(src) * 10 ** (float(nar.get("gain_db", 0)) / 20)
        place(voice, v, float(nar.get("start", 0)))
        ref = integrated(voice)
        rep["narration"] = {"file": nar["file"], "start": float(nar.get("start", 0)), "lufs": round(ref, 2),
                            "untouched": float(nar.get("gain_db", 0)) == 0}
    act = activity(voice, ref) if nar else np.zeros(n)

    music = np.zeros((n, 2))
    mus = doc.get("music")
    if mus:
        if mus.get("file"):
            m = load(os.path.join(base, mus["file"]))
        else:
            m, _, _ = render_take({"id": "music", **{k: mus[k] for k in SPEC_KEYS if k in mus},
                                   "dur": mus.get("dur", duration)}, offline=doc.get("_offline", False), log=log)
        start = float(mus.get("start", 0))
        seg = fades(fit_len(m, max(1, n - int(start * SR)), loop=mus.get("loop", True)), 0.05, 1.0)
        place(music, seg, start)
        target = (ref - cfg["music_under_voice_lu"]) if nar else cfg["music_lufs"]
        target += float(mus.get("gain_db", 0))
        cur = integrated(music)
        if cur > -70:
            music *= 10 ** ((target - cur) / 20)

    beds = np.zeros((n, 2))
    for spec, x in beds_audio:
        seg = fades(fit_len(x, int((spec["to"] - spec["from"]) * SR)), 0.3, 0.5)
        target = (ref - cfg["bed_under_voice_lu"]) + float(spec.get("gain_db", 0))
        cur = integrated(seg)
        if cur > -70:
            seg = seg * 10 ** ((target - cur) / 20)
        place(beds, seg, spec["from"])

    sfx = np.zeros((n, 2))
    placed = []
    for spec, x, meta in cues_audio:
        lm = meta
        anchor = {"onset": lm["onset_s"], "peak": lm["peak_s"], "end": lm["end_s"]}[spec["align"]]
        start = spec["at"] - anchor
        if start < 0:
            log(f"  warning: {spec['id']} starts {-start:.2f} s before 0 and is cut at the head; move it later, "
                f"shorten it (dur) or align it differently")
        _, L = momentary(x, 0.05)
        top = float(L.max())
        s_i = int(round(start * SR))
        overlaps = bool(act[max(0, s_i): max(0, s_i + len(x))].any()) if nar else False
        target = ref + float(spec.get("gain_db", 0)) - (cfg["sfx_under_voice_lu"] if overlaps else 0)
        g = 10 ** ((min(target, top + 12) - top) / 20)  # never raise a quiet take by more than 12 dB
        y = x * g
        place(sfx, y, start)
        placed.append({**{k: v for k, v in spec.items() if not k.startswith("_")}, "start": round(start, 4),
                       "design": meta.get("design"), "summary": meta.get("summary"), "take": spec["_take"],
                       "gain_db": round(20 * np.log10(g), 2), "over_narration": overlaps,
                       "momentary_max_lufs": round(top + 20 * np.log10(g), 2)})

    if nar:
        duck_db = -cfg["duck_db"] * act
        duck = smooth_gain(duck_db, cfg["duck_attack_s"], cfg["duck_release_s"])
        music *= 10 ** (duck[:, None] / 20)
        beds *= 10 ** (duck[:, None] / 20)
    rest = music + beds + sfx
    guard_db = np.zeros(n)
    if nar:
        rest_g, guard_db = guard(voice, rest, act, cfg["min_voice_margin_lu"], ref)
        k = 10 ** (guard_db[:, None] / 20)
        music, beds, sfx, rest = music * k, beds * k, sfx * k, rest_g
    total = voice + rest
    # master: one gain for the whole mix (relative levels stay), capped by the true-peak ceiling
    cur, tp = integrated(total), true_peak(total)
    g_db = min(cfg["target_lufs"] - cur, cfg["ceiling_dbtp"] - tp) if cur > -70 else 0.0
    g = 10 ** (g_db / 20)
    stems = {"voice": voice * g, "music": music * g, "beds": beds * g, "sfx": sfx * g}
    stems["rest"] = stems["music"] + stems["beds"] + stems["sfx"]
    stems["mix"] = total * g
    rep.update({"cues": placed, "master_gain_db": round(g_db, 2), "lufs": round(integrated(stems["mix"]), 2),
                "true_peak_dbtp": round(true_peak(stems["mix"]), 2),
                "guard_max_cut_db": round(float(-guard_db.min()), 2) if nar else 0.0})
    if nar:
        mg, at = voice_margin(stems["voice"], stems["rest"], ref + g_db)
        rep["voice_margin_lu"], rep["voice_margin_at_s"] = mg, at
    return stems, rep


# ----------------------------------------------------------------------------- render

CREDITS = """# Sound credits

Sound effects in this project were rendered with **earshot** by Leon Lin
(https://github.com/Leonxlnx/earshot, MIT, commit `{pin}`), on CPU, with no
model and no network. earshot's licence: everything it renders belongs to whoever
rendered it, free for any use, commercial too, without credit. Its learned
designs come from recordings in the public domain (CC0 or an explicit
public-domain dedication: BigSoundBank, Kenney, VCSL, VSCO-2 CE, Karoryfer, CC0
uploads on Freesound), credited per recording in earshot's
`earshot/data/*/CREDITS.md`. CC0 asks for no credit; this file keeps it anyway.

| cue | at (s) | earshot design | take |
| --- | --- | --- | --- |
{rows}

Narration: {narration}
Music: {music}
"""


def render(cues_path, out, offline=False, log=print):
    with open(cues_path, encoding="utf-8") as f:
        doc = json.load(f)
    base = os.path.dirname(os.path.abspath(cues_path))
    doc["_offline"] = offline
    cues, beds, fps, duration = resolve(doc)
    made = hits = 0
    cues_audio, beds_audio = [], []
    takes_dir = os.path.join(out, "sfx", "takes")
    os.makedirs(takes_dir, exist_ok=True)
    for spec in cues + beds:
        x, meta, hit = render_take(spec, offline=offline, log=log)
        hits += hit
        made += not hit
        name = f"{spec['id']}.wav"
        write(os.path.join(takes_dir, name), x)
        spec["_take"] = f"sfx/takes/{name}"
        if spec in beds:
            beds_audio.append((spec, x))
        else:
            cues_audio.append((spec, x, meta))
    stems, rep = mix(doc, base, cues_audio, beds_audio, duration, log=log)
    for k in ("voice", "music", "beds", "sfx", "rest"):
        write(os.path.join(out, "audio", "stems", f"{k}.wav"), stems[k])
    sf.write(os.path.join(out, "audio", "mix.wav"), np.clip(stems["mix"], -1, 1).astype(np.float32), SR,
             subtype="PCM_24")
    rep.update({"fps": fps, "duration": duration, "made": made, "cache_hits": hits, "earshot": earshot_pin(),
                "beds": [{k: v for k, v in b.items() if not k.startswith("_")} for b in beds]})
    os.makedirs(os.path.join(out, "sfx"), exist_ok=True)
    with open(os.path.join(out, "sfx", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    js = {"fps": fps, "duration": duration,
          "cues": {c["id"]: {"at": c["at"], "frame": c["frame"], "start": c["start"], "align": c["align"],
                             "design": c["design"]} for c in rep["cues"]}}
    with open(os.path.join(out, "sfx", "cues.js"), "w", encoding="utf-8") as f:
        f.write("// written by sfx.py render: the cue times the sound was placed at. Do not edit; edit cues.json.\n")
        f.write(f"window.__sfxCues = {json.dumps(js, indent=1)};\n")
    rows = "\n".join(f"| {c['id']} | {c['at']:.3f} | `{c['design']}` | {c['take']} |" for c in rep["cues"])
    rows += "".join(f"\n| {b['id']} (bed) | {b['from']:.3f}-{b['to']:.3f} | `{b.get('sound') or b.get('want')}` | "
                    f"{b['_take']} |" for b in beds)
    nar = doc.get("narration")
    mus = doc.get("music")
    with open(os.path.join(out, "sfx", "CREDITS.md"), "w", encoding="utf-8") as f:
        f.write(CREDITS.format(pin=earshot_pin(), rows=rows,
                               narration=f"`{nar['file']}` (supplied; credit its voice and service)" if nar else "none",
                               music=(f"`{mus.get('file') or mus.get('sound') or mus.get('want')}`" if mus else "none")))
    log(f"sfx: {len(cues)} cue(s), {len(beds)} bed(s): {made} made, {hits} cache hit(s); mix {rep['lufs']} LUFS, "
        f"{rep['true_peak_dbtp']} dBTP" + (f"; narration margin {rep['voice_margin_lu']} LU (min "
                                            f"{rep['mix']['min_voice_margin_lu']})" if nar else ""))
    return rep


# ----------------------------------------------------------------------------- analysis and checks

def silences(x, thresh_db=-55.0, min_s=0.3):
    m = stereo(x).mean(axis=1)
    hop = int(0.05 * SR)
    n = len(m) // hop
    if n == 0:
        return []
    r = db(np.sqrt(np.mean(m[: n * hop].reshape(n, hop) ** 2, axis=1)))
    quiet = r < thresh_db
    out, i = [], 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if (j - i) * hop / SR >= min_s:
                out.append([round(i * hop / SR, 2), round(j * hop / SR, 2)])
            i = j
        else:
            i += 1
    return out


def analyze(path):
    x = load(path)
    r = {"file": path, "duration": round(len(x) / SR, 3), "lufs": round(integrated(x), 2),
         "true_peak_dbtp": round(true_peak(x), 2), "silences": silences(x)}
    lr = _features().lra(x)
    r["lra_lu"] = None if lr is None else round(lr, 2)
    t, L = momentary(x, 0.1)
    r["momentary_max_lufs"] = round(float(L.max()), 2)
    try:
        r["onsets"] = [round(float(v), 3) for v in _features().onsets(x.mean(axis=1))]
    except Exception as e:  # noqa: BLE001 - librosa missing or a too-short file: onsets are optional
        r["onsets_error"] = str(e)
    return r


def ffprobe(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration,start_time",
                        "-of", "json", path], capture_output=True, text=True, check=True)
    return json.loads(p.stdout).get("streams", [])


def locate(hay, tmpl, expect, search=0.15):
    """where `tmpl` sits in `hay` near sample `expect`, by normalized cross-correlation: (offset s, score)"""
    from scipy import signal
    a = max(0, expect - int(search * SR))
    b = min(len(hay), expect + len(tmpl) + int(search * SR))
    seg = hay[a:b]
    if len(seg) < len(tmpl) or not len(tmpl):
        return None, 0.0
    c = signal.correlate(seg, tmpl, mode="valid", method="fft")
    e = np.sqrt(np.convolve(seg ** 2, np.ones(len(tmpl)), mode="valid")) * np.sqrt(np.sum(tmpl ** 2)) + 1e-12
    nc = c / e
    i = int(np.argmax(nc))
    return round((a + i - expect) / SR, 4), round(float(nc[i]), 3)


def visual_changes(video, fps):
    """mean absolute frame-to-frame change of a 64x36 grey copy, one value per frame"""
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", "scale=64:36,format=gray", "-f", "rawvideo",
                        "-"], capture_output=True, check=True)
    fr = np.frombuffer(p.stdout, dtype=np.uint8).reshape(-1, 36 * 64).astype(np.float64)
    d = np.concatenate([[0.0], np.abs(np.diff(fr, axis=0)).mean(axis=1)])
    return d


def check(project, render_path=None, tol_frames=1.0):
    with open(os.path.join(project, "sfx", "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)
    fps, cfg = man["fps"], man["mix"]
    tol = tol_frames / fps
    fails, warns = [], []
    res = {"project": project, "tolerance_s": round(tol, 4)}
    src = render_path or os.path.join(project, "audio", "mix.wav")
    if render_path:
        streams = ffprobe(render_path)
        kinds = {s["codec_type"]: s for s in streams}
        if "audio" not in kinds:
            fails.append("the render has no audio stream")
            res.update(ok=False, fails=fails, warnings=warns)
            return res
        if "video" in kinds:
            dv, da = float(kinds["video"].get("duration", 0)), float(kinds["audio"].get("duration", 0))
            res["av"] = {"video_s": dv, "audio_s": da, "audio_start_s": float(kinds["audio"].get("start_time", 0)),
                         "video_start_s": float(kinds["video"].get("start_time", 0))}
            if abs(dv - da) > max(tol, 0.05):
                warns.append(f"audio ({da:.3f} s) and video ({dv:.3f} s) lengths differ by more than a frame")
            if abs(res["av"]["audio_start_s"] - res["av"]["video_start_s"]) > tol:
                fails.append("audio and video streams start at different times")
    x = load(src)
    a = analyze(src)
    res["loudness"] = {k: a[k] for k in ("lufs", "true_peak_dbtp", "lra_lu", "momentary_max_lufs")}
    if abs(a["lufs"] - cfg["target_lufs"]) > 1.5:
        warns.append(f"integrated loudness {a['lufs']} LUFS is off the {cfg['target_lufs']} target by > 1.5 LU")
    if a["true_peak_dbtp"] > -1.0:
        fails.append(f"true peak {a['true_peak_dbtp']} dBTP is over -1 dBTP")
    res["silences"] = a["silences"]
    dur = man["duration"]
    if len(a["silences"]) == 1 and a["silences"][0][1] - a["silences"][0][0] >= dur - 0.1:
        fails.append("the audio is silent")
    for s, e in a["silences"]:
        if s > 0.1 and e < dur - 0.1 and e - s > 1.5:
            warns.append(f"silence inside the film from {s} s to {e} s")
    # narration margin, from the stems the mix was built from
    if "narration" in man:
        voice = load(os.path.join(project, "audio", "stems", "voice.wav"))
        rest = load(os.path.join(project, "audio", "stems", "rest.wav"))
        mg, at = voice_margin(voice, rest, integrated(voice))
        res["voice_margin_lu"], res["voice_margin_at_s"] = mg, at
        if mg is not None and mg < cfg["min_voice_margin_lu"] - 0.5:
            fails.append(f"music and effects come within {mg} LU of the narration at {at} s "
                         f"(min {cfg['min_voice_margin_lu']})")
    # cue sync: each cue's stretch of the built mix must sit at the same place in the delivered audio; and the cue
    # must be audible over everything that is not an effect (narration, music, beds)
    hay = x.mean(axis=1)
    built = load(os.path.join(project, "audio", "mix.wav"))
    sfx_stem = load(os.path.join(project, "audio", "stems", "sfx.wav"))
    others = built - sfx_stem
    vis = visual_changes(render_path, fps) if render_path and any(c.get("visual") for c in man["cues"]) else None
    res["cues"] = []
    for c in man["cues"]:
        s = max(0, int(round(c["start"] * SR)))
        take = load(os.path.join(project, c["take"]))
        e = min(len(built), s + len(take))
        tmpl = built[s: min(e, s + int(0.5 * SR))].mean(axis=1)
        off, score = locate(hay, tmpl, s) if render_path else (0.0, 1.0)
        cue_l = float(momentary(take * 10 ** (c["gain_db"] / 20), 0.05)[1].max())
        oth = float(momentary(others[s:e], 0.05)[1].max()) if e - s > int(0.05 * SR) else -70.0
        row = {"id": c["id"], "at": c["at"], "offset_s": off, "score": score, "over_bed_lu": round(cue_l - oth, 1)}
        if off is None or score < 0.5:
            fails.append(f"cue {c['id']}: its stretch of the mix is not found in the render (score {score})")
        elif abs(off) > tol:
            fails.append(f"cue {c['id']}: lands {off * 1000:+.0f} ms from its frame (tolerance {tol * 1000:.0f} ms)")
        if cue_l - oth < -12:
            warns.append(f"cue {c['id']}: {oth - cue_l:.0f} LU under the narration and music: likely inaudible")
        if vis is not None and c.get("visual"):
            f0 = c["frame"]
            lo, hi = max(0, f0 - 3), min(len(vis), f0 + 4)
            k = lo + int(np.argmax(vis[lo:hi]))
            row["visual_frame"], row["visual_offset_frames"] = k, k - f0
            if abs(k - f0) > tol_frames or vis[k] < 2.0:
                fails.append(f"cue {c['id']}: the picture changes most at frame {k}, not at {f0}")
        res["cues"].append(row)
    res.update(ok=not fails, fails=fails, warnings=warns)
    return res


# ----------------------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(prog="sfx.sh", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("render")
    p.add_argument("cues")
    p.add_argument("--out", default=None, help="the video project (default: the folder of cues.json)")
    p.add_argument("--offline", action="store_true", help="every take must come from the cache")
    p = sub.add_parser("check")
    p.add_argument("project")
    p.add_argument("--render", default=None, help="the rendered video (or audio) to check")
    p.add_argument("--tolerance-frames", type=float, default=1.0)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("analyze")
    p.add_argument("file")
    p.add_argument("--json", action="store_true")
    sub.add_parser("cache")
    sub.add_parser("doctor")
    p = sub.add_parser("earshot")
    p.add_argument("args", nargs=argparse.REMAINDER)
    a = ap.parse_args(argv)
    try:
        if a.cmd == "render":
            out = a.out or os.path.dirname(os.path.abspath(a.cues))
            render(a.cues, out, offline=a.offline)
        elif a.cmd == "check":
            r = check(a.project, a.render, a.tolerance_frames)
            if a.json:
                print(json.dumps(r, indent=1))
            else:
                for c in r.get("cues", []):
                    print(f"  {c['id']}: at {c['at']:.3f} s, offset {c['offset_s']} s (match {c['score']}), "
                          f"{c['over_bed_lu']:+} LU over voice+music"
                          + (f", picture {c['visual_offset_frames']:+d} frame(s)" if "visual_frame" in c else ""))
                if "loudness" in r:
                    print(f"  loudness {r['loudness']['lufs']} LUFS, true peak {r['loudness']['true_peak_dbtp']} dBTP")
                if "voice_margin_lu" in r:
                    print(f"  narration margin {r['voice_margin_lu']} LU (at {r['voice_margin_at_s']} s)")
                for w in r["warnings"]:
                    print("  warning:", w)
                for e in r["fails"]:
                    print("  FAIL:", e)
                print("sfx check:", "ok" if r["ok"] else "failed")
            return 0 if r["ok"] else 1
        elif a.cmd == "analyze":
            r = analyze(a.file)
            if a.json:
                print(json.dumps(r, indent=1))
            else:
                print(f"{a.file}: {r['duration']} s, {r['lufs']} LUFS integrated, {r['true_peak_dbtp']} dBTP, LRA "
                      f"{r['lra_lu']} LU, momentary max {r['momentary_max_lufs']} LUFS; silences {r['silences']}; "
                      f"{len(r.get('onsets', []))} onsets")
        elif a.cmd == "cache":
            files = [os.path.join(TAKES, f) for f in os.listdir(TAKES)] if os.path.isdir(TAKES) else []
            size = sum(os.path.getsize(f) for f in files)
            print(f"{TAKES}: {sum(f.endswith('.wav') for f in files)} take(s), {size / 1e6:.1f} MB")
        elif a.cmd == "doctor":
            import earshot
            print(f"earshot {earshot.__version__} @ {earshot_pin()}; python {sys.version.split()[0]}; "
                  f"ffmpeg {'yes' if shutil.which('ffmpeg') else 'MISSING'}; cache {CACHE}; listening models: off "
                  f"(EARSHOT_OFFLINE={os.environ.get('EARSHOT_OFFLINE')})")
        elif a.cmd == "earshot":
            from earshot.cli import main as es_main
            sys.argv = ["earshot", *a.args]
            return es_main() or 0
    except SfxError as e:
        print(f"sfx: error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
