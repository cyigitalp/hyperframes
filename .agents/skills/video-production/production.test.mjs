import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as P from "./production.mjs";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prod-"));
  P.init(dir, { title: "Test", credits: 100 });
  return dir;
}
const write = (dir, f, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), text);
};

test("init resumes instead of resetting", () => {
  const dir = project();
  write(dir, "production/brief.md", "idea");
  P.done(dir, "brief", ["production/brief.md"]);
  P.init(dir, { title: "Other", credits: 5 });
  const s = P.load(dir);
  assert.equal(s.title, "Test");
  assert.equal(s.stages.brief.status, "done");
});

test("status resumes at the first open stage and flags changed files", () => {
  const dir = project();
  write(dir, "production/brief.md", "idea");
  write(dir, "production/research.md", "facts");
  P.done(dir, "brief", ["production/brief.md"]);
  P.done(dir, "research", ["production/research.md"]);
  assert.equal(P.status(dir).next, "script");
  write(dir, "production/research.md", "edited facts");
  const st = P.status(dir);
  assert.equal(st.next, "research");
  assert.deepEqual(st.stages[1].changed, ["production/research.md"]);
});

test("reopen marks later done stages for recheck only", () => {
  const dir = project();
  for (const k of ["brief", "research", "script"]) {
    write(dir, `production/${k}.md`, k);
    P.done(dir, k, [`production/${k}.md`]);
  }
  P.reopen(dir, "research", "wrong date");
  const st = P.status(dir);
  assert.equal(st.next, "research");
  assert.equal(st.stages[2].status, "recheck");
});

test("done refuses missing outputs and unknown stages", () => {
  const dir = project();
  assert.throws(() => P.done(dir, "script", ["nope.md"]), /missing output/);
  assert.throws(() => P.done(dir, "nope"), /unknown stage/);
});

test("failed scenes are listed for repair with attempt counts", () => {
  const dir = project();
  write(dir, "compositions/s1.html", "<a>");
  write(dir, "compositions/s2.html", "<b>");
  P.scene(dir, "s1", "ok", ["compositions/s1.html"]);
  P.scene(dir, "s2", "failed", [], "text overflow");
  P.scene(dir, "s2", "failed");
  const st = P.status(dir);
  assert.deepEqual(st.repair, ["s2"]);
  assert.equal(st.scenes[1].attempts, 2);
  assert.equal(st.scenes[1].note, "text overflow");
  write(dir, "compositions/s1.html", "<changed>");
  assert.deepEqual(P.status(dir).repair, ["s1", "s2"]);
});

test("a registered asset is reused until its file changes", () => {
  const dir = project();
  assert.equal(P.asset(dir, "hero").ok, false);
  write(dir, "assets/hero.png", "png");
  P.asset(dir, "hero", { path: "assets/hero.png", source: "higgsfield", credits: 4, job: "j1" });
  assert.equal(P.asset(dir, "hero").ok, true);
  write(dir, "assets/hero.png", "other");
  assert.equal(P.asset(dir, "hero").why, "file changed");
});

test("spend refuses past the budget unless approved", () => {
  const dir = project();
  assert.equal(P.spend(dir, 60, { what: "narration" }).ok, true);
  assert.equal(P.spend(dir, 50, { what: "video", record: false }).ok, false);
  assert.equal(P.spend(dir, 50, { what: "video" }).ok, false);
  assert.equal(P.load(dir).budget.spent, 60);
  assert.equal(P.spend(dir, 50, { what: "video", approved: true }).left, -10);
  P.setBudget(dir, 200, "owner raised it");
  assert.equal(P.status(dir).budget.left, 90);
});

test("deliver gate checks files, three-word thumbnail and open work", () => {
  const dir = project();
  const d = {
    video: "renders/final.mp4",
    thumbnail: "renders/thumb.png",
    title: "T",
    description: "D",
  };
  write(dir, "renders/final.mp4", "mp4");
  write(dir, "renders/thumb.png", "png");
  write(
    dir,
    "production/delivery.json",
    JSON.stringify({ ...d, thumbnailText: "Way Too Many Words" }),
  );
  const bad = P.deliverCheck(dir);
  assert.throws(() => P.done(dir, "deliver"), /deliver gate/);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.includes("three words")));
  write(dir, "production/delivery.json", JSON.stringify({ ...d, thumbnailText: "Gold Rush" }));
  for (const k of P.STAGES.slice(0, -1)) P.done(dir, k);
  assert.deepEqual(P.deliverCheck(dir), { ok: true, problems: [] });
  P.done(dir, "deliver", ["production/delivery.json"]);
  assert.equal(P.status(dir).next, null);
});

test("CLI exit codes", () => {
  const dir = project();
  assert.equal(P.main(["spend", dir, "500", "--what", "x", "--check"]), P.EXIT.budget);
  assert.equal(P.main(["asset", dir, "none"]), P.EXIT.missing);
  assert.equal(P.main(["deliver", dir]), P.EXIT.incomplete);
});
