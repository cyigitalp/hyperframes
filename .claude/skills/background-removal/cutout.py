#!/usr/bin/env python3
"""cutout.py: CPU background removal for HyperFrames, built on rembg (MIT).

Commands (run through cutout.sh, which creates the pinned venv on first use):

  models                      list the models and their licence status
  fetch [--model M]           download and md5-check the model weights once
  run <images|dirs...> --out <project> [--model M] [--plate] [--matting]
                              [--post-process] [--pad N] [--offline] [--name-prefix P]
                              batch-cut images into <project>/cutouts/
  verify <project>            check every file listed in cutouts/manifest.json
  cache                       show the cache folders and their sizes

Weights live in $HYPERFRAMES_CACHE/rembg/models (default ~/.cache/hyperframes),
processed results in $HYPERFRAMES_CACHE/cutouts/<key>/, keyed by the sha256 of
the source bytes plus the model and options, so a repeat run does no inference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PIPELINE_VERSION = 2  # bump when output files change, invalidates processed cache
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
UA = "HyperFrames-Cutout/1.0"
RELEASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/"

# Only models whose weights are published under a licence that allows
# commercial use, by authors whose training-data terms do not forbid it, are
# "commercial": True. The rest stay listed so nobody adds them by accident.
MODELS = {
    "u2net": {
        "file": "u2net.onnx",
        "md5": "60024c5c889badc19c04ad937298a77b",
        "bytes": 175997641,
        "commercial": True,
        "license": "Apache-2.0",
        "source": "https://github.com/xuebinqin/U-2-Net",
        "note": "Default. U^2-Net general salient-object model (Qin et al., 2020).",
    },
    "silueta": {
        "file": "silueta.onnx",
        "md5": "55e59e0d8062d2f5d013f4725ee84782",
        "bytes": 44173029,
        "commercial": True,
        "license": "Apache-2.0 (U^2-Net weights, size-reduced by the rembg author)",
        "source": "https://github.com/danielgatis/rembg/issues/193",
        "note": "Fast draft model, same architecture as u2net, softer edges.",
    },
    "isnet-general-use": {
        "commercial": False,
        "license": "Apache-2.0 code; weights trained on DIS5K, whose terms forbid commercial use",
        "source": "https://github.com/xuebinqin/DIS",
    },
    "birefnet-general": {
        "commercial": False,
        "license": "MIT code; general weights include DIS5K in training data (same restriction)",
        "source": "https://github.com/ZhengPeng7/BiRefNet",
    },
    "bria-rmbg": {
        "commercial": False,
        "license": "BRIA RMBG licence, non-commercial without a paid agreement",
        "source": "https://huggingface.co/briaai/RMBG-1.4",
    },
    "u2net_human_seg": {
        "commercial": False,
        "license": "Apache-2.0 weights; training-data terms (Supervisely Person) not verified",
        "source": "https://github.com/xuebinqin/U-2-Net",
    },
}
DEFAULT_MODEL = "u2net"


def cache_root() -> Path:
    base = os.environ.get("HYPERFRAMES_CACHE") or os.path.join(
        os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "hyperframes"
    )
    return Path(base)


def models_dir() -> Path:
    return cache_root() / "rembg" / "models"


def results_dir() -> Path:
    return cache_root() / "cutouts"


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def die(msg: str, code: int = 1) -> None:
    print(f"cutout: {msg}", file=sys.stderr)
    sys.exit(code)


def model_info(name: str) -> dict:
    info = MODELS.get(name)
    if info is None:
        die(f"unknown model {name!r}; run `cutout.sh models`")
    if not info["commercial"]:
        die(f"model {name!r} is not cleared for commercial use: {info['license']}")
    return info


def model_urls(info: dict) -> list[str]:
    """Mirror first (REMBG_MODEL_MIRROR, a folder URL), then the rembg release."""
    urls = []
    mirror = os.environ.get("REMBG_MODEL_MIRROR")
    if mirror:
        urls.append(mirror.rstrip("/") + "/" + info["file"])
    urls.append(RELEASE + info["file"])
    return urls


def fetch_model(name: str, offline: bool = False) -> Path:
    info = model_info(name)
    dest = models_dir() / info["file"]
    if dest.exists() and md5_file(dest) == info["md5"]:
        return dest
    if offline:
        die(f"model {name} is not cached at {dest} and --offline was given")
    dest.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    for url in model_urls(info):
        tmp = dest.with_suffix(".part")
        try:
            print(f"downloading {url}", file=sys.stderr)
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            got = md5_file(tmp)
            if got != info["md5"]:
                raise ValueError(f"md5 {got} != {info['md5']}")
            tmp.replace(dest)
            return dest
        except Exception as e:  # noqa: BLE001 - report every mirror's failure
            errors.append(f"{url}: {e}")
            tmp.unlink(missing_ok=True)
    die("could not download model weights:\n  " + "\n  ".join(errors))
    raise AssertionError  # unreachable


def options_key(model: str, opts: dict) -> str:
    blob = json.dumps({"v": PIPELINE_VERSION, "model": model, **opts}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def collect_inputs(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            out += sorted(q for q in p.iterdir() if q.suffix.lower() in IMAGE_EXTS)
        elif p.is_file():
            out.append(p)
        else:
            die(f"input not found: {p}")
    if not out:
        die("no input images")
    return out


def safe_stem(path: Path, prefix: str = "") -> str:
    keep = "".join(c if c.isalnum() or c in "-_" else "-" for c in path.stem.lower())
    return prefix + (keep.strip("-") or "image")


# --- image maths (numpy only, no model) ------------------------------------


def alpha_bbox(alpha, threshold: int = 8):
    """[x0, y0, x1, y1) of pixels above threshold, or None when empty."""
    import numpy as np

    ys, xs = np.nonzero(alpha > threshold)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def anchors(alpha, bbox):
    """Centroid of the alpha mass, and the foot point (bottom of the subject)."""
    import numpy as np

    a = alpha.astype("float64")
    total = a.sum()
    h, w = a.shape
    cx = float((a.sum(axis=0) * np.arange(w)).sum() / total)
    cy = float((a.sum(axis=1) * np.arange(h)).sum() / total)
    x0, y0, x1, y1 = bbox
    bottom = alpha[y1 - 1, x0:x1] > 8
    fx = float(x0 + np.nonzero(bottom)[0].mean()) if bottom.any() else cx
    return {"centroid": [round(cx, 1), round(cy, 1)], "foot": [round(fx, 1), float(y1)]}


def _resize(img, width: int, height: int):
    """Bilinear resize of a float HxWx3 array (PIL "F" mode per channel)."""
    import numpy as np
    from PIL import Image

    return np.stack(
        [np.asarray(Image.fromarray(img[..., i].astype("float32"), "F").resize((width, height), Image.Resampling.BILINEAR)) for i in range(3)],
        axis=-1,
    ).astype("float64")


def fill_plate(rgb, alpha, grow: int = 6):
    """Background plate: fill the subject hole by push-pull diffusion.

    Good enough for a parallax backplate that the cutout will mostly cover;
    not a generative inpaint. rgb uint8 HxWx3, alpha uint8 HxW.
    """
    import numpy as np
    from PIL import Image, ImageFilter
    from scipy.ndimage import gaussian_filter

    hole = Image.fromarray(alpha).point(lambda v: 255 if v > 16 else 0)
    if grow:
        hole = hole.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    w = 1.0 - np.asarray(hole, dtype="float64") / 255.0
    col = rgb.astype("float64") * w[..., None]

    levels = [(col, w)]
    while min(levels[-1][1].shape) > 2:
        c, ww = levels[-1]
        h2, w2 = (c.shape[0] + 1) // 2 * 2, (c.shape[1] + 1) // 2 * 2
        c = np.pad(c, ((0, h2 - c.shape[0]), (0, w2 - c.shape[1]), (0, 0)), mode="edge")
        ww = np.pad(ww, ((0, h2 - ww.shape[0]), (0, w2 - ww.shape[1])), mode="edge")
        c = c.reshape(h2 // 2, 2, w2 // 2, 2, 3).sum(axis=(1, 3))
        ww = ww.reshape(h2 // 2, 2, w2 // 2, 2).sum(axis=(1, 3))
        levels.append((c, ww))

    c, ww = levels[-1]
    img = c / np.maximum(ww, 1e-6)[..., None]
    for c, ww in reversed(levels[:-1]):
        up = _resize(img, c.shape[1], c.shape[0])
        known = np.minimum(ww, 1.0)[..., None]
        img = known * (c / np.maximum(ww, 1e-6)[..., None]) + (1 - known) * up
    # Soften the filled area so the low-frequency fill reads as defocused backplate.
    soft = np.stack([gaussian_filter(img[..., i], sigma=3) for i in range(3)], axis=-1)
    img = w[..., None] * img + (1 - w[..., None]) * soft
    out = img.clip(0, 255).astype("uint8")
    # Keep original pixels exactly where the plate was never covered.
    keep = (w >= 1.0)[..., None]
    return np.where(keep, rgb, out)


# --- processing --------------------------------------------------------------


class Cutter:
    def __init__(self, model: str, offline: bool):
        self.model = model
        self.offline = offline
        self._session = None
        self.inferences = 0

    def session(self):
        if self._session is None:
            path = fetch_model(self.model, self.offline)
            # rembg only loads custom weights from inside its home folder.
            os.environ["U2NET_HOME"] = str(models_dir())
            from rembg import new_session

            self._session = new_session("u2net_custom", model_path=str(path))
        return self._session

    def process(self, src: Path, opts: dict, dest: Path) -> dict:
        """Write cutout.png, trim.png, mask.png (and plate.png) into dest."""
        import numpy as np
        from PIL import Image, ImageOps
        from rembg import remove

        img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        t = time.time()
        cut = remove(
            img,
            session=self.session(),
            alpha_matting=opts["matting"],
            post_process_mask=opts["post_process"],
            decontaminate=not opts["matting"],
        ).convert("RGBA")
        self.inferences += 1
        rgba = np.asarray(cut)
        alpha = rgba[..., 3]
        bbox = alpha_bbox(alpha)
        if bbox is None:
            die(f"{src}: no subject found (empty mask)")
        pad = opts["pad"]
        h, w = alpha.shape
        tb = [max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad)]
        dest.mkdir(parents=True, exist_ok=True)
        cut.save(dest / "cutout.png", optimize=True)
        cut.crop(tb).save(dest / "trim.png", optimize=True)
        Image.fromarray(alpha).save(dest / "mask.png", optimize=True)
        files = ["cutout.png", "trim.png", "mask.png"]
        if opts["plate"]:
            Image.fromarray(fill_plate(np.asarray(img), alpha)).save(dest / "plate.jpg", quality=92)
            files.append("plate.jpg")
        meta = {
            "width": w,
            "height": h,
            "bbox": bbox,
            "trim": {"x": tb[0], "y": tb[1], "width": tb[2] - tb[0], "height": tb[3] - tb[1]},
            "coverage": round(float((alpha > 127).mean()), 4),
            **anchors(alpha, bbox),
            "files": files,
            "seconds": round(time.time() - t, 2),
        }
        (dest / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta


SUFFIX = {"cutout.png": ".png", "trim.png": ".trim.png", "mask.png": ".mask.png", "plate.jpg": ".plate.jpg"}


def cmd_run(a) -> None:
    info = model_info(a.model)
    opts = {"matting": a.matting, "post_process": a.post_process, "plate": a.plate, "pad": a.pad}
    okey = options_key(a.model, opts)
    out = Path(a.out) / "cutouts"
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    items = {i["name"]: i for i in manifest.get("items", [])}
    cutter = Cutter(a.model, a.offline)
    hits = 0
    for src in collect_inputs(a.inputs):
        data = src.read_bytes()
        sha = sha256_bytes(data)
        cdir = results_dir() / f"{sha[:24]}-{okey}"
        meta_file = cdir / "meta.json"
        meta = None
        if meta_file.exists():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if not all((cdir / f).exists() for f in meta["files"]):
                meta = None
        hit = meta is not None
        hits += hit
        if meta is None:
            results_dir().mkdir(parents=True, exist_ok=True)
            tmp = Path(tempfile.mkdtemp(prefix=".tmp-", dir=results_dir()))
            meta = cutter.process(src, opts, tmp)
            if cdir.exists():
                shutil.rmtree(cdir)
            shutil.move(str(tmp), str(cdir))
        name = safe_stem(src, a.name_prefix)
        files = {}
        for f in meta["files"]:
            rel = name + SUFFIX[f]
            shutil.copyfile(cdir / f, out / rel)
            files[f.split(".")[0]] = {"path": rel, "md5": md5_file(out / rel)}
        items[name] = {
            "name": name,
            "source": src.name,
            "sha256": sha,
            "model": a.model,
            "options": opts,
            **{k: meta[k] for k in ("width", "height", "bbox", "trim", "coverage", "centroid", "foot")},
            "files": files,
        }
        print(f"{'cached' if hit else 'cut':>6}  {name}  bbox={meta['bbox']}")
    manifest = {
        "generator": "hyperframes background-removal (rembg)",
        "items": sorted(items.values(), key=lambda i: i["name"]),
        "licenses": {
            "rembg": "MIT, (c) Daniel Gatis, https://github.com/danielgatis/rembg",
            a.model: f"{info['license']}, {info['source']}",
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    write_credits(out, manifest)
    print(f"{len(items)} item(s) in {manifest_path}; {cutter.inferences} inference(s), {hits} cache hit(s)")


def write_credits(out: Path, manifest: dict) -> None:
    lines = [
        "# Cutout credits",
        "",
        "Background removal by rembg (MIT, Daniel Gatis).",
        "",
    ]
    for name, lic in manifest["licenses"].items():
        lines.append(f"- {name}: {lic}")
    lines += [
        "",
        "U^2-Net: Qin, Zhang, Huang, Dehghan, Zaiane, Jagersand. U^2-Net: Going Deeper with",
        "Nested U-Structure for Salient Object Detection. Pattern Recognition 106, 2020.",
        "",
        "Source images keep their own licences; list them here before publishing:",
        "",
    ]
    for it in manifest["items"]:
        lines.append(f"- {it['source']} -> {it['name']}")
    (out / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def cmd_verify(a) -> None:
    out = Path(a.project) / "cutouts"
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    bad = []
    for it in manifest["items"]:
        for f in it["files"].values():
            p = out / f["path"]
            if not p.exists() or md5_file(p) != f["md5"]:
                bad.append(f["path"])
    if bad:
        die("missing or changed: " + ", ".join(bad))
    print(f"verified {len(manifest['items'])} cutout(s) in {out}")


def cmd_models(_a) -> None:
    for name, i in MODELS.items():
        state = "ok        " if i["commercial"] else "BLOCKED   "
        cached = "cached" if i.get("file") and (models_dir() / i["file"]).exists() else ""
        print(f"{state}{name:<18} {i['license']}  {cached}")


def cmd_fetch(a) -> None:
    p = fetch_model(a.model, a.offline)
    print(f"{a.model}: {p} ({p.stat().st_size} bytes, md5 ok)")


def du(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def cmd_cache(_a) -> None:
    for p in (models_dir(), results_dir()):
        print(f"{p}  {du(p) / 1e6:.1f} MB")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="cutout.sh", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("models")
    sub.add_parser("cache")
    f = sub.add_parser("fetch")
    f.add_argument("--model", default=DEFAULT_MODEL)
    f.add_argument("--offline", action="store_true")
    r = sub.add_parser("run")
    r.add_argument("inputs", nargs="+")
    r.add_argument("--out", required=True, help="video project folder; writes <out>/cutouts/")
    r.add_argument("--model", default=DEFAULT_MODEL)
    r.add_argument("--plate", action="store_true", help="also write a hole-filled background plate")
    r.add_argument("--matting", action="store_true", help="pymatting alpha matting (hair, fur), slower")
    r.add_argument("--post-process", action="store_true", help="smooth the mask (hard-edged objects)")
    r.add_argument("--pad", type=int, default=8, help="padding around the trimmed sprite")
    r.add_argument("--name-prefix", default="")
    r.add_argument("--offline", action="store_true", help="never download; fail if weights are not cached")
    v = sub.add_parser("verify")
    v.add_argument("project")
    a = ap.parse_args(argv)
    {"models": cmd_models, "fetch": cmd_fetch, "run": cmd_run, "verify": cmd_verify, "cache": cmd_cache}[a.cmd](a)


if __name__ == "__main__":
    main()
