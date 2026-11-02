import assert from "node:assert/strict";
import test from "node:test";
import { createMergePlan } from "../src/core/snapshot/merge-plan.js";
import { createDemoSession } from "../src/ui/merge/demo.js";
import { countSnapshotBookmarks } from "../src/core/snapshot/count.js";
const b = (title, url = "https://example.com") => ({ type: "bookmark", title, url });
const s = children => ({ version: 1, roots: [{ key: "bookmark_bar", title: "书签", children }] });

test("demo visual choices merge to three bookmarks or preserve both titles", async () => {
  const preview = await createDemoSession().load();
  const plan = createMergePlan(preview.local, preview.remote);
  assert.equal(plan.conflicts.length, 3);
  assert.throws(() => plan.build({}), /完成所有/);
  const selections = Object.fromEntries(plan.conflicts.map(x => [x.id, x.local && x.remote ? "local" : "both"]));
  assert.equal(countSnapshotBookmarks(plan.build(selections)), 3);
  assert.equal(countSnapshotBookmarks(plan.build(Object.fromEntries(plan.conflicts.map(x => [x.id, "both"])))), 4);
  assert.equal(countSnapshotBookmarks(preview.local), 2);
});
test("identical snapshots retain multiplicity with no decisions", () => {
  const plan = createMergePlan(s([b("a"), b("a")]), s([b("a"), b("a")]));
  assert.equal(plan.conflicts.length, 0);
  assert.equal(countSnapshotBookmarks(plan.build({})), 2);
});
test("same-name folders merge recursively and one-sided items can be excluded", () => {
  const folder = children => ({ type: "folder", title: "目录", children });
  const plan = createMergePlan(s([folder([b("a")])]), s([folder([b("a"), b("b", "https://b.example")])]));
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].local, null);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "local" })), 1);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "remote" })), 2);
});
test("missing remote requires confirmation and both keeps the local tree", () => {
  const plan = createMergePlan(s([b("a")]), null);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "both" })), 1);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "remote" })), 0);
});

test("explicit exclusion removes a difference while preserving identical bookmarks", () => {
  const plan = createMergePlan(s([b("same", "https://same.example"), b("local")]), s([b("same", "https://same.example"), b("remote")]));
  assert.equal(plan.conflicts.length, 1);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "none" })), 1);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "local" })), 2);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "remote" })), 2);
  assert.equal(countSnapshotBookmarks(plan.build({ 0: "both" })), 3);
  assert.throws(() => plan.build({}), /完成所有/);
});
