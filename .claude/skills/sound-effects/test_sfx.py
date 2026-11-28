"""Self-test for sfx.py (run with `sfx.sh selftest`): planning, mixing, ducking, analysis and one real earshot take."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HYPERFRAMES_CACHE", tempfile.mkdtemp(prefix="sfx-cache-"))

import numpy as np  # noqa: E402

import sfx  # noqa: E402

sfx.TAKES = tempfile.mkdtemp(prefix="sfx-takes-")  # the self-test never reads or fills the real take cache

SR = sfx.SR
rng = np.random.default_rng(7)


def speechy(dur, start=0.0, total=None):
    """syllable-like bursts of harmonic noise: a stand-in narration with pauses"""
    n = int((total or dur) * SR)
    x = np.zeros(n)
    t = np.arange(int(0.18 * SR)) / SR
    k = int(start * SR)
    while k < int((start + dur) * SR) - len(t):
        f = 140 + 40 * rng.random()
        syl = sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, 8)) * np.hanning(len(t))
        x[k: k + len(t)] += 0.3 * syl
        k += int((0.22 + 0.1 * rng.random()) * SR)
    return np.stack([x, x], axis=1)


class Plan(unittest.TestCase):
    def test_library_frames_and_snapping(self):
        doc = {"fps": 30, "duration": 4, "library": {"hit": {"want": "an impact", "gain_db": -3}},
               "cues": [{"id": "a", "use": "hit", "frame": 30}, {"id": "b", "use": "hit", "at": 1.012, "gain_db": 2}],
               "beds": [{"id": "room", "want": "room tone"}]}
        cues, beds, fps, dur = sfx.resolve(doc)
        self.assertEqual(cues[0]["at"], 1.0)
        self.assertEqual(cues[1]["at"], 1.0)  # snapped to frame 30
        self.assertEqual(cues[1]["gain_db"], 2)  # the cue overrides its preset
        self.assertEqual(cues[0]["gain_db"], -3)
        self.assertEqual(cues[0]["align"], "peak")
        self.assertEqual((beds[0]["from"], beds[0]["to"]), (0.0, 4.0))

    def test_errors(self):
        bad = [{"fps": 30, "duration": 4, "cues": [{"id": "a", "at": 9, "want": "x"}]},
               {"fps": 30, "duration": 4, "cues": [{"id": "a", "at": 1}]},
               {"fps": 30, "duration": 4, "cues": [{"id": "a", "at": 1, "want": "x"}, {"id": "a", "at": 2, "want": "x"}]},
               {"fps": 30, "duration": 4, "cues": [{"id": "a", "use": "nope", "at": 1}]},
               {"fps": 30, "cues": []}]
        for d in bad:
            with self.assertRaises(sfx.SfxError):
                sfx.resolve(d)


class Mixing(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sfx-mix-")
        os.makedirs(os.path.join(self.dir, "audio"))
        self.voice = speechy(2.5, 0.0, 2.5)
        sfx.write(os.path.join(self.dir, "audio", "voice.wav"), self.voice)
        music = 0.5 * rng.standard_normal((4 * SR, 2))
        sfx.write(os.path.join(self.dir, "audio", "music.wav"), music)

    def test_narration_is_never_overpowered_and_never_altered(self):
        doc = {"narration": {"file": "audio/voice.wav", "start": 0.5},
               "music": {"file": "audio/music.wav", "gain_db": 14},  # asked far too loud on purpose
               "mix": {"min_voice_margin_lu": 6}}
        boom = np.zeros((SR // 2, 2))
        boom[:2400] = 0.9 * rng.standard_normal((2400, 2))
        spec = {"id": "boom", "at": 1.0, "align": "onset", "gain_db": 10, "_take": "sfx/takes/boom.wav"}
        stems, rep = sfx.mix(doc, self.dir, [(spec, boom, sfx.landmarks(boom))], [], 4.0, log=lambda *_: None)
        self.assertGreaterEqual(rep["voice_margin_lu"], 5.5)
        self.assertLessEqual(rep["true_peak_dbtp"], -1.4)
        # the narration stem is the input, moved and scaled by the master gain only
        v = stems["voice"][int(0.5 * SR): int(0.5 * SR) + len(self.voice), 0]
        ratio = v[np.abs(self.voice[:, 0]) > 0.05] / self.voice[np.abs(self.voice[:, 0]) > 0.05, 0]
        self.assertLess(np.ptp(ratio), 1e-3)

    def test_music_only_film(self):
        doc = {"music": {"file": "audio/music.wav"}, "mix": {"target_lufs": -16}}
        stems, rep = sfx.mix(doc, self.dir, [], [], 4.0, log=lambda *_: None)
        self.assertAlmostEqual(rep["lufs"], -16, delta=0.6)
        self.assertNotIn("voice_margin_lu", rep)


class Analysis(unittest.TestCase):
    def test_landmarks(self):
        x = np.zeros((SR, 2))
        x[int(0.2 * SR): int(0.21 * SR)] = 0.2
        x[int(0.5 * SR): int(0.52 * SR)] = 0.9
        lm = sfx.landmarks(x)
        self.assertAlmostEqual(lm["onset_s"], 0.2, delta=0.011)
        self.assertAlmostEqual(lm["peak_s"], 0.5, delta=0.02)
        self.assertAlmostEqual(lm["end_s"], 0.52, delta=0.011)

    def test_silences(self):
        x = 0.1 * rng.standard_normal((3 * SR, 2))
        x[SR: 2 * SR] = 0
        self.assertEqual(sfx.silences(x), [[1.0, 2.0]])

    def test_locate_recovers_a_shift(self):
        hay = 0.01 * rng.standard_normal(2 * SR)
        tmpl = rng.standard_normal(SR // 4)
        hay[SR + 1600: SR + 1600 + len(tmpl)] += tmpl
        off, score = sfx.locate(hay, tmpl, SR)
        self.assertAlmostEqual(off, 1600 / SR, places=4)
        self.assertGreater(score, 0.9)


class Earshot(unittest.TestCase):
    def test_real_take_is_cached(self):
        spec = {"id": "w", "want": "a fast whoosh", "seed": 0}
        x, meta, hit = sfx.render_take(spec, log=lambda *_: None)
        self.assertFalse(hit)
        self.assertTrue(meta["design"].startswith("whoosh/"))
        self.assertGreater(len(x), SR // 10)
        x2, meta2, hit2 = sfx.render_take(spec, offline=True, log=lambda *_: None)
        self.assertTrue(hit2)
        self.assertTrue(np.allclose(x, x2))
        with self.assertRaises(sfx.SfxError):
            sfx.render_take({"id": "z", "want": "a fast whoosh", "seed": 99}, offline=True)
        json.dumps(meta)  # the manifest must be JSON


if __name__ == "__main__":
    unittest.main()
