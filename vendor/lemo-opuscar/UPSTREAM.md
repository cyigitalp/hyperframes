# Upstream

Source: https://github.com/lemomo-ai/lemo-opuscar at commit `439b98a`
(`439b98af08b04400f8fd8a8dd19cd773c0c96532`, v2.0.0). "Lemo-Opuscar by Lemomo (LemoLab)".

Only material that upstream's `LICENSE` and `REUSE.toml` put under the
**MIT License** is copied here, unmodified:

| File                   | What                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `core/lib.js`          | easings, springs, envelopes, seeded PRNG, monotone keyframe tracks   |
| `core/post/crt.js`     | WebGL2 CRT / videotape post (glow, chroma bleed, scanlines, power-on, tracking noise) |
| `core/three/post.js`   | Three.js post chain: GTAO, physical depth of field, bloom, grade     |
| `LICENSE`, `LICENSES/MIT.txt` | upstream licence statement and the MIT text                  |

`styles.jsonl` is generated from each `styles/<slug>/style.json` (MIT
configuration data): slug, name, category, uses, one-line synopsis, plus a
`tech` tag list we derived by scanning that style's demo code.

## Not copied, on purpose

- **Every Markdown file and the image prompts** (`STYLE.md`, `DEMO.md`,
  `TECHNIQUE.md`, `DIRECTOR.md`, READMEs, `styles/*/demo/prompts/`): CC BY-NC 4.0.
  Upstream's additional permission lets us read and follow them to make our
  own films, commercial ones included, but not redistribute them in a public
  repository or a product. The `lemo-opuscar-styles` skill fetches one
  style's `STYLE.md` at the pinned commit only when a film needs it.
- Films, posters, stills, subtitles (CC BY 4.0), fonts (OFL), third-party
  data, footage, music and models (own licences), the six TTS narration
  tracks, Clawd and third-party marks (no licence given).
- `core/render`, `core/audio`, `core/tts`, `core/image`: upstream's own
  Playwright renderer and Python audio/TTS/image tools. HyperFrames stays the
  renderer; Higgsfield and ElevenLabs stay the media path (`/media-use`).

## Updating

Clone upstream at the new commit, re-read `LICENSE` and `REUSE.toml` (the
rules can change), copy the files above, regenerate `styles.jsonl` with
`node scripts/lemo-opuscar-index.mjs <upstream-checkout>`, update the commit in this file and in
`.claude/skills/lemo-opuscar-styles/SKILL.md` (and its `.agents` mirror),
then let the `Media deps` workflow re-render the CRT fixture.
