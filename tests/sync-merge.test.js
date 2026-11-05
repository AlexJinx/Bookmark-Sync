import test from "node:test";
import assert from "node:assert/strict";
import { createMergePlan } from "../src/core/snapshot/merge-plan.js";
import { ensurePushNoConflict, ensurePullNoConflict } from "../src/background/conflict.js";
import { makeSyncState } from "../src/background/sync-state.js";

const bookmark = (title, url = `https://example.com/${title}`) => ({ type: "bookmark", title, url });
const folder = (title, children) => ({ type: "folder", title, children });
const snapshot = children => ({ version: 1, roots: [{ key: "bar", title: "收藏夹栏", children }] });
const children = plan => plan.build().roots[0].children;

test("本地新增 Audio 自动合并，不进入冲突列表", () => {
  const base = snapshot([bookmark("a")]);
  const audio = folder("Audio", [bookmark("Fish Audio", "https://fish.audio/app/")]);
  const plan = createMergePlan(snapshot([...base.roots[0].children, audio]), base, base);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(children(plan), [...base.roots[0].children, audio]);
});
test("独立新增与独立修改自动合并", () => {
  const base = snapshot([bookmark("a"), bookmark("b")]);
  const local = snapshot([bookmark("a", "https://local.test"), bookmark("b"), bookmark("c")]);
  const remote = snapshot([bookmark("a"), bookmark("b", "https://remote.test"), bookmark("d")]);
  const plan = createMergePlan(local, remote, base);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(children(plan), [local.roots[0].children[0], remote.roots[0].children[1], bookmark("c"), bookmark("d")]);
});
test("删除不会被另一侧的旧副本恢复", () => {
  const base = snapshot([bookmark("a"), bookmark("b")]);
  const plan = createMergePlan(snapshot([bookmark("b")]), snapshot([bookmark("a")]), base);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(children(plan), []);
});
test("删除与修改相撞要求选择", () => {
  const plan = createMergePlan(snapshot([]), snapshot([bookmark("a", "https://changed.test")]), snapshot([bookmark("a")]));
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].reason, "delete_modify");
  assert.throws(() => plan.build());
  assert.deepEqual(plan.build({ 0: "none" }).roots[0].children, []);
});
test("同一书签两边修改、同名新增要求选择", () => {
  for (const base of [snapshot([bookmark("a")]), snapshot([])]) {
    const plan = createMergePlan(snapshot([bookmark("a", "https://left.test")]), snapshot([bookmark("a", "https://right.test")]), base);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.build({ 0: "remote" }).roots[0].children[0].url, "https://right.test");
  }
});
test("同一目录内独立修改递归合并", () => {
  const base = snapshot([folder("AI", [bookmark("a"), bookmark("b")])]);
  const local = snapshot([folder("AI", [bookmark("a"), bookmark("b"), bookmark("c")])]);
  const remote = snapshot([folder("AI", [bookmark("b")])]);
  assert.deepEqual(children(createMergePlan(local, remote, base)), [folder("AI", [bookmark("b"), bookmark("c")])]);
});
test("旧版没有快照基线时不猜测单边差异", () => {
  const plan = createMergePlan(snapshot([bookmark("a")]), snapshot([]));
  assert.equal(plan.hasBase, false);
  assert.equal(plan.conflicts[0].reason, "no_base");
});
test("重复身份、无法识别的重命名与排序保守确认，选择后不引入虚拟目录", () => {
  const base = snapshot([bookmark("a"), bookmark("b")]);
  const remote = snapshot([bookmark("a"), bookmark("b"), bookmark("remote")]);
  for (const list of [[bookmark("a"), bookmark("a"), bookmark("b")], [bookmark("renamed", "https://new.test"), bookmark("b")], [bookmark("b"), bookmark("a")]]) {
    const local = snapshot(list), plan = createMergePlan(local, remote, base);
    assert.equal(plan.conflicts.length, 1);
    assert.deepEqual(plan.build({ 0: "local" }).roots[0].children, list);
  }
});
test("有共同基线时，推送和拉取允许双方独立变更", () => {
  const base = snapshot([bookmark("a")]);
  const local = snapshot([bookmark("a"), bookmark("local")]);
  const remote = snapshot([bookmark("a"), bookmark("remote")]);
  const args = { syncState: { remoteSha: "old", localHash: "base", baseSnapshot: base },
    remote: { exists: true, sha: "new" }, localHash: "local", remoteHash: "remote", localSnapshot: local, remoteSnapshot: remote };
  for (const ensure of [ensurePushNoConflict, ensurePullNoConflict]) {
    assert.deepEqual(ensure(args).roots[0].children, [bookmark("a"), bookmark("local"), bookmark("remote")]);
  }
});
test("删除整个远端文件仍须确认，旧版冲突保护保留", () => {
  assert.throws(() => ensurePushNoConflict({ syncState: { remoteSha: "old", localHash: "base", baseSnapshot: snapshot([]) }, remote: { exists: false }, localHash: "local" }), { code: "SYNC_CONFLICT" });
  assert.throws(() => ensurePushNoConflict({ syncState: null, remote: { exists: true }, localHash: "local", remoteHash: "remote" }), { code: "SYNC_CONFLICT" });
});
test("共同基线保存独立快照，不改变既有 scope", () => {
  const base = snapshot([bookmark("a")]);
  const state = makeSyncState({ provider: "gitee", gitee: { owner: "o", repo: "r", branch: "master", path: "b.json" } }, "sha", "hash", base);
  base.roots[0].children.length = 0;
  assert.equal(state.scope, "gitee|o|r|master|b.json");
  assert.equal(state.baseSnapshot.roots[0].children.length, 1);
});

test("移动与另一侧删除相撞时不自动恢复被删除的书签", () => {
  const base = snapshot([folder("A", [bookmark("x")]), folder("B", [])]);
  const local = snapshot([folder("A", []), folder("B", [bookmark("x")])]);
  const remote = snapshot([folder("A", []), folder("B", [])]);
  const plan = createMergePlan(local, remote, base);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].reason, "ambiguous_move");
  assert.deepEqual(plan.build({ 0: "remote" }).roots[0].children, remote.roots[0].children);
});

test("深层目录比较不会递归膨胀字符串", () => {
  let node = bookmark("deep");
  for (let i = 0; i < 60; i++) node = folder(`level-${i}`, [node]);
  const tree = snapshot([node]);
  for (const base of [null, tree]) {
    const plan = createMergePlan(tree, structuredClone(tree), base);
    assert.equal(plan.conflicts.length, 0);
    assert.deepEqual(plan.build({}).roots, tree.roots);
  }
});
