# pixelfx (vendored)

Unmodified copy of the runtime files of https://github.com/patch-gg/pixelfx at
commit `5294518ce7c72e48b6100a744596e0acf57f2826` (v0.3.1): `package.json`,
`src/`, `LICENSE` (MIT) and `NOTICE.md`. The only edit: `package.json` drops
`scripts` and `devDependencies` (esbuild, used only by upstream's gallery tools),
so installing it pulls no extra packages. The gallery, docs, tools and the
gallery font (not MIT, see upstream `gallery/fonts/NOTICE.md`) are left out.

The root `package.json` installs it as `"pixelfx": "file:./vendor/pixelfx"`, so
`bun install` needs no GitHub download. To move to a new upstream commit:

```bash
git clone https://github.com/patch-gg/pixelfx /tmp/pixelfx && git -C /tmp/pixelfx checkout <sha>
rm -rf vendor/pixelfx/src && cp -r /tmp/pixelfx/{package.json,src,LICENSE,NOTICE.md} vendor/pixelfx/
# drop "scripts" and "devDependencies" from vendor/pixelfx/package.json
# update the commit above, then
bun install && node --test .claude/skills/gsap-hyperframes/*.test.mjs
```
