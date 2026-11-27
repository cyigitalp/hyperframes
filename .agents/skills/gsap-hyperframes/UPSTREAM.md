# Upstream

`gsap-core`, `gsap-timeline`, `gsap-utils`, `gsap-plugins` and
`gsap-performance` are copied unmodified from
https://github.com/greensock/gsap-skills at commit `aed9cfd`
(MIT License, Copyright (c) 2026 GreenSock).

Not vendored: `gsap-react`, `gsap-frameworks` (framework lifecycles do not
apply to compositions) and `gsap-scrolltrigger` (scroll-driven, not seekable).

To update, copy each `skills/<name>/SKILL.md` from upstream into both
`.claude/skills/<name>/` and `.agents/skills/<name>/`, then run
`bun run check:skill-mirror` and `bun run lint:skills`.

`pixelfx-frame.js` targets pixelfx at commit `5294518`
(github:patch-gg/pixelfx, MIT, see its NOTICE.md), installed as a root
dependency. To move it, change the commit in `package.json` and run
`bun install`, then `node --test .claude/skills/gsap-hyperframes/*.test.mjs`.
