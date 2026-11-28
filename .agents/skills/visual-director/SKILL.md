---
name: visual-director
description: Decide, scene by scene, how a video shows its story - authentic photos and archive for real events, places, people, companies and products, AI images, 2D characters, 3D, motion graphics or a mix - with licensed media, layered photo scenes (animated subjects, annotations, environmental effects), visual metaphor and comedy, one art direction, and honest labels on recreations. Load when planning scenes.json or the look of a video, when a scene needs real-world evidence or licensed photos, or when a plan reads as a slideshow of code-built graphics. Ships plan-check.mjs (plan lint) and photo-search.mjs (commercially cleared photo search with credits).
license: MIT
metadata:
  internal: true
---

# Visual director

Choose each scene's medium from what the viewer must believe at that beat,
not from what is quick to build. No quotas: the story decides the mix.

## Per scene, decide

1. **Evidence** (`evidence` in scenes.json):
   - `authentic`: the video says something real happened, exists or looks a
     certain way (an event, a place, a person, a company, a product). Show
     real evidence: a licensed photo, footage, an archive document, a
     screenshot. A made-up graphic of a real thing is not evidence.
   - `recreation`: nothing real can be shown (a past moment no camera caught,
     a process inside a machine). Generate or build it and **say so on
     screen** (`label`: "AI recreation", "Illustration", "Reconstruction").
     Never generate a real person's likeness.
   - `illustrative`: a metaphor, a joke, an idea; anything goes.
   - `data`: a number or a place; `data-animation`, `map-animation` with the
     source on screen.
2. **Treatment**: photo, cut-out collage, 2D character, 3D, motion graphics,
   map, chart, footage, or a combination. Strongest scenes combine a real
   photo plate with things that move on it.
3. **What moves** and why: the subject (cut out with `background-removal`
   and performed with `character-animation`), annotations that draw on,
   the environment (steam, dust, light, weather, water), and a motivated
   camera (`cinematography`). A still photo with only a zoom is the weakest
   option, not the default.
4. **The idea**: a visual metaphor, an exaggeration, a contrast of scale or
   a gag. Plan a visual turn every 20-30 s (`gag` in the scene).

## A layered photo scene

Real photo plate (clean background) → cut-out subject on its own plane →
environmental effect (steam, dust, particles) → animated annotations (ink
arrows, tags, labels, circles) → a character or prop that interacts with the
photo → camera with parallax across those depths → a credit line. The
`photo-mix` demo in `.github/workflows/fixtures/creative/` is this recipe.

## Finding real media

```bash
node <SKILL_DIR>/photo-search.mjs search "espresso crema" --source all --min-width 1600 > cands.json
node <SKILL_DIR>/photo-search.mjs get cands.json 2 --project <project> --key espresso
```

`search` queries Openverse (commercial licences only), Wikimedia Commons
(licence from each file's metadata) and NASA's image library (public domain;
NASA must not appear to endorse). It drops anything not cleared for
commercial use (NC, ND, editorial, all rights reserved, non-free). `get`
downloads to `assets/photos/<key>`, appends `CREDITS.md` and registers the
asset with `production.mjs`. Look at a candidate before using it; check it
shows what the narration claims. Also free: `/media-use` asset search, Poly
Haven (CC0 3D, `polyhaven-assets`). Higgsfield images cost credits: only for
what can't be found, and labeled when it shows a real thing.

## Art direction

One `look` for the film in scenes.json (or `## Look` in direction.md):
palette (3-5 colours), type, texture and grain, light, lens, and how photos
are graded to sit together (`/media-use` grades). Every scene follows it;
variety comes from scale, framing and medium, not from new styles.

## scenes.json fields

```json
{
  "look": {
    "palette": ["#2a170c", "#ffd24a", "#fff8ea"],
    "type": "heavy grotesk",
    "texture": "paper grain",
    "light": "warm key"
  },
  "scenes": [
    {
      "id": "s1_hook",
      "start": 0,
      "end": 3.2,
      "hook": "steam swerves into Pip's face",
      "evidence": "authentic",
      "treatment": "photo-mix",
      "gag": "steam to the face",
      "layers": [
        {
          "kind": "photo",
          "subject": "espresso",
          "provenance": "authentic",
          "source": "find",
          "licence": "CC0",
          "credit": "Rachel Michetti"
        },
        { "kind": "effect", "subject": "steam", "provenance": "built", "motion": "rising wisps" },
        { "kind": "character", "subject": "Pip", "provenance": "built" }
      ],
      "camera": { "move": "push-in", "shot": "close", "motivation": "the word 'smell'" },
      "character": {
        "rig": "pip",
        "actions": [
          { "preset": "walk", "start": 0 },
          { "preset": "take", "start": 2.1, "kind": "jolt" }
        ]
      }
    }
  ]
}
```

`provenance` is `authentic`, `ai` or `built`; `real: true` on an AI layer of
a real thing requires a `label`; `hold: true` with a reason allows a still beat.

## Check the plan

`node <SKILL_DIR>/plan-check.mjs production/scenes.json --direction production/direction.md`
fails a title-card hook, a late start, authentic claims without authentic
media, unlabeled recreations, AI likenesses of real people, unlicensed or
non-commercial media, scenes where nothing moves, and characters that only
slide; it warns on missing evidence types, unmotivated camera moves,
repetition, mostly code-built films, too few gags and a missing look.
Fix errors before building; weigh warnings against the story.
