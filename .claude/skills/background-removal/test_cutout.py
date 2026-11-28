"""Unit tests for cutout.py helpers (no model download). Run with the cutout venv:
cutout.sh selftest."""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("cutout", Path(__file__).with_name("cutout.py"))
cutout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutout)


class Helpers(unittest.TestCase):
    def test_bbox_and_anchors(self):
        a = np.zeros((10, 20), dtype="uint8")
        a[2:8, 5:9] = 255
        self.assertEqual(cutout.alpha_bbox(a), [5, 2, 9, 8])
        an = cutout.anchors(a, [5, 2, 9, 8])
        self.assertEqual(an["centroid"], [6.5, 4.5])
        self.assertEqual(an["foot"], [6.5, 8.0])
        self.assertIsNone(cutout.alpha_bbox(np.zeros((4, 4), dtype="uint8")))

    def test_fill_plate_keeps_outside_and_fills_hole(self):
        rgb = np.zeros((64, 64, 3), dtype="uint8")
        rgb[:, :32] = (200, 0, 0)
        rgb[:, 32:] = (0, 0, 200)
        alpha = np.zeros((64, 64), dtype="uint8")
        alpha[20:44, 20:44] = 255
        rgb[20:44, 20:44] = (0, 255, 0)  # the subject, must vanish
        out = cutout.fill_plate(rgb, alpha)
        self.assertTrue((out[0, 0] == (200, 0, 0)).all())
        self.assertTrue((out[63, 63] == (0, 0, 200)).all())
        self.assertLess(int(out[20:44, 20:44, 1].max()), 10)

    def test_options_key_changes_with_options(self):
        a = cutout.options_key("u2net", {"plate": True})
        self.assertEqual(a, cutout.options_key("u2net", {"plate": True}))
        self.assertNotEqual(a, cutout.options_key("u2net", {"plate": False}))
        self.assertNotEqual(a, cutout.options_key("silueta", {"plate": True}))

    def test_non_commercial_models_are_blocked(self):
        for name, info in cutout.MODELS.items():
            if info["commercial"]:
                self.assertRegex(info["md5"], r"^[0-9a-f]{32}$")
                self.assertTrue(info["file"].endswith(".onnx"))
            else:
                with self.assertRaises(SystemExit):
                    cutout.model_info(name)
        self.assertTrue(cutout.MODELS[cutout.DEFAULT_MODEL]["commercial"])

    def test_offline_without_weights_fails(self):
        with tempfile.TemporaryDirectory() as d:
            os.environ["HYPERFRAMES_CACHE"] = d
            try:
                with self.assertRaises(SystemExit):
                    cutout.fetch_model("u2net", offline=True)
            finally:
                del os.environ["HYPERFRAMES_CACHE"]

    def test_mirror_is_tried_first(self):
        os.environ["REMBG_MODEL_MIRROR"] = "https://example.invalid/m/"
        try:
            urls = cutout.model_urls(cutout.MODELS["u2net"])
        finally:
            del os.environ["REMBG_MODEL_MIRROR"]
        self.assertEqual(urls[0], "https://example.invalid/m/u2net.onnx")
        self.assertTrue(urls[1].startswith(cutout.RELEASE))

    def test_safe_stem(self):
        self.assertEqual(cutout.safe_stem(Path("My Hero (1).PNG")), "my-hero--1")
        self.assertEqual(cutout.safe_stem(Path("a.png"), "bg-"), "bg-a")


if __name__ == "__main__":
    unittest.main()
