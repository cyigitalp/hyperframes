# Creative QC rubric

Score what is on screen, not what the plan intended. 3 = acceptable for
publishing, 4 = good, 5 = memorable. A score of 4 or 5 needs two timestamped
pieces of evidence; any score needs one.

| Dimension         | 1                                     | 3                                               | 5                                                                    |
| ----------------- | ------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| hook              | title or logo card, nothing moves     | subject on screen by 1 s, but a generic image   | a question, a surprise or a gag in motion at frame 0                 |
| story             | facts in a list                       | a clear line, beats follow                      | setup, turn and payoff; each scene needs the one before              |
| visual-engagement | one medium, repeated layouts          | some real media, some variety                   | authentic photos, cut-outs, 3D, graphics chosen per beat, no repeats |
| animation         | slides and fades                      | layered motion with eases                       | every element moves with weight, anticipation and follow-through     |
| character         | a still picture moved around          | some body motion, one expression                | acting: looks, expressions, gestures and reactions timed to beats    |
| cinematography    | none, or motion with no reason        | motivated moves, some depth                     | shot sizes vary, parallax and focus direct the eye, seamless cuts    |
| humor             | none                                  | one visual joke                                 | a turn every 20-30 s that lands on timing                            |
| pacing            | dead holds or frantic cutting         | steady rhythm                                   | rhythm follows the narration; tension and release                    |
| sync              | visuals ignore the words              | cuts near the beats                             | every key word has its visual event                                  |
| audio-mix         | music masks words, clipping           | words clear, music under                        | SFX land on frames, music shapes the beats                           |
| factual           | an unsourced or wrong claim on screen | claims sourced, AI recreations unlabeled in one | every claim sourced; recreations labeled                             |
| thumbnail         | over three words or unreadable small  | readable, generic                               | one idea, three words or fewer, readable at phone size               |

## eval.json

```json
{
  "evaluator": "creative director, from contact.png, hook.png and motion sheets",
  "dimensions": {
    "hook": {
      "score": 4,
      "evidence": [
        { "t": 0, "note": "..." },
        { "t": 0.4, "note": "..." }
      ]
    },
    "story": {
      "score": 3,
      "notes": "...",
      "evidence": [{ "t": 3.2, "note": "..." }],
      "scenes": ["s4"]
    },
    "sync": { "score": "unverified", "notes": "no word timings" }
  },
  "findings": [
    {
      "match": { "kind": "hold", "scene": "s9" },
      "status": "accepted",
      "reason": "deliberate end card"
    }
  ],
  "add": [{ "t": 12.4, "scene": "s5", "severity": "P1", "problem": "...", "fix": "..." }]
}
```

- `scenes` on a low score names the scenes that caused it; they go on the
  repair list.
- A measured finding can be `fixed`, `false-positive` or `accepted` with a
  `reason`; a P0 cannot be accepted.
- Add what only an eye can see as new findings: a joke that does not land,
  a wrong fact, an off-model character, an unlabeled AI recreation, a
  mismatched voice. Every finding has a time, a scene, the problem and one
  concrete fix.
- Technical (encode, resolution, loudness numbers) and creative findings stay
  separate: a clean encode is not a creative score.
