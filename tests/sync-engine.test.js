import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GiteeProvider } from "../src/providers/gitee.js";
import { pushToRemote, pullFromRemote, getMergePreview, submitMerge } from "../src/background/sync-engine.js";
import { exportSnapshot } from "../src/core/bookmarks/service.js";
import { hashSnapshot } from "../src/core/snapshot/hash.js";
import { makeSyncState, getSyncScope } from "../src/background/sync-state.js";

const config = { provider: "gitee", gitee: { token: "test", owner: "owner", repo: "repo", branch: "master", path: "bookmarks.json" } };
const bookmark = (title, url = `https://example.test/${title}`) => ({ type: "bookmark", title, url });
const snapshot = children => ({ version: 1, roots: [{ key: "bookmark_bar", title: "收藏夹栏", children }] });
let data, root, remote, writes, race, failBackup, id;
const clone = value => structuredClone(value);
function find(node, wanted) {
  if (node.id === wanted) return node;
  for (const child of node.children || []) { const result = find(child, wanted); if (result) return result; }
}
function setLocal(snapshot) {
  function convert(node) { return { id: String(++id), title: node.title, ...(node.type === "bookmark" ? { url: node.url } : { children: node.children.map(convert) }) }; }
  root = { id: "1", title: "收藏夹栏", children: snapshot.roots[0].children.map(convert) };
}
async function initialize(base, local = base, cloud = base, { legacy = false } = {}) {
  setLocal(local);
  remote = { exists: true, sha: cloud === base ? "base-sha" : "changed-sha", contentText: JSON.stringify(cloud) };
  const state = makeSyncState(config, "base-sha", await hashSnapshot(base), legacy ? null : base);
  data.syncState = { scopes: { [getSyncScope(config)]: state } };
}
const state = () => data.syncState.scopes[getSyncScope(config)];
const remoteNodes = () => JSON.parse(remote.contentText).roots[0].children;
const localNodes = async () => (await exportSnapshot()).roots[0].children;

beforeEach(() => {
  data = { syncConfig: clone(config) }; id = 10; writes = []; race = false; failBackup = false;
  globalThis.chrome = { storage: { local: {
    get: async key => ({ [key]: clone(data[key]) }),
    set: async values => { if (failBackup && values.lastMergeBackup) throw new Error("backup failed"); Object.assign(data, clone(values)); }
  } }, bookmarks: {
    getTree: async () => [{ id: "0", children: [clone(root)] }],
    getChildren: async parentId => clone(find(root, parentId).children || []),
    remove: async nodeId => {
      function remove(node) { node.children = (node.children || []).filter(child => child.id !== nodeId); node.children.forEach(child => { if (child.children) remove(child); }); }
      remove(root);
    },
    removeTree: async nodeId => chrome.bookmarks.remove(nodeId),
    create: async ({ parentId, title, url }) => {
      const node = { id: String(++id), title, ...(url ? { url } : { children: [] }) };
      find(root, parentId).children.push(node); return clone(node);
    }
  } };
  GiteeProvider.prototype.getRemoteFile = async () => clone(remote);
  GiteeProvider.prototype.updateRemoteFile = async (payload, sha) => {
    if (race) { remote.sha = "raced-sha"; throw new Error("409 sha does not match"); }
    assert.equal(sha, remote.sha);
    writes.push(payload); remote = { exists: true, sha: `written-${writes.length}`, contentText: payload };
    return { fileSha: remote.sha, commitSha: "commit" };
  };
});

test("推送本地新增自动通过，并持久化完整共同基线", async () => {
  const base = snapshot([bookmark("a")]), local = snapshot([bookmark("a"), bookmark("Audio")]);
  await initialize(base, local);
  await pushToRemote({ provider: "gitee" });
  assert.deepEqual(remoteNodes(), local.roots[0].children);
  assert.deepEqual(state().baseSnapshot.roots[0].children, local.roots[0].children);
});
test("双方独立新增：推送不改本地，重复推送不丢远端新增，拉取后建立基线", async () => {
  const base = snapshot([bookmark("a")]), local = snapshot([bookmark("a"), bookmark("local")]);
  await initialize(base, local, snapshot([bookmark("a"), bookmark("remote")]));
  const first = await pushToRemote({ provider: "gitee" });
  assert.equal(first.needsPull, true);
  assert.deepEqual(await localNodes(), local.roots[0].children);
  assert.deepEqual(remoteNodes().map(x => x.title), ["a", "local", "remote"]);
  assert.deepEqual(state().baseSnapshot, base);
  await pushToRemote({ provider: "gitee" });
  assert.equal(writes.length, 1);
  const pull = await pullFromRemote({ provider: "gitee" });
  assert.equal(pull.needsPush, false);
  assert.deepEqual(await localNodes(), remoteNodes());
  assert.equal(state().remoteSha, remote.sha);
  assert.equal(state().localHash, await hashSnapshot(await exportSnapshot()));
});
test("拉取保留本地新增，不写远端；随后推送收敛", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, snapshot([bookmark("a"), bookmark("local")]), snapshot([bookmark("a"), bookmark("remote")]));
  const result = await pullFromRemote({ provider: "gitee" });
  assert.equal(result.needsPush, true);
  assert.equal(writes.length, 0);
  assert.deepEqual((await localNodes()).map(x => x.title), ["a", "local", "remote"]);
  await pushToRemote({ provider: "gitee" });
  assert.deepEqual(remoteNodes(), await localNodes());
  assert.equal(state().remoteSha, remote.sha);
});
test("远端删除应用到本地，不会恢复旧书签", async () => {
  const base = snapshot([bookmark("a"), bookmark("b")]);
  await initialize(base, base, snapshot([bookmark("b")]));
  await pullFromRemote({ provider: "gitee" });
  assert.deepEqual(await localNodes(), [bookmark("b")]);
});
test("真实冲突提供原因，不写入任意一端", async () => {
  await initialize(snapshot([bookmark("a")]), snapshot([bookmark("a", "https://left.test")]), snapshot([bookmark("a", "https://right.test")]));
  await assert.rejects(pushToRemote({ provider: "gitee" }), error => error.details.type === "merge_required");
  const preview = await getMergePreview("gitee");
  assert.equal(preview.reason.type, "merge_required");
  assert.ok(preview.base);
  assert.equal(writes.length, 0);
});
test("旧版一致快照自动补齐基线；首次不同内容仍需确认", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, base, base, { legacy: true });
  await pushToRemote({ provider: "gitee" });
  assert.ok(state().baseSnapshot);
  data.syncState = { scopes: {} }; setLocal(snapshot([bookmark("new")]));
  await assert.rejects(pushToRemote({ provider: "gitee" }), error => error.details.type === "no_base_diverged");
});
test("提交期间远端更新不会重试覆盖，不推进基线", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, snapshot([bookmark("a"), bookmark("local")]));
  race = true;
  await assert.rejects(pushToRemote({ provider: "gitee" }), { code: "SYNC_CONFLICT" });
  assert.equal(writes.length, 0);
  assert.deepEqual(state().baseSnapshot, base);
});
test("自动合并备份失败时不写远端", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, snapshot([bookmark("a"), bookmark("local")]), snapshot([bookmark("a"), bookmark("remote")]));
  failBackup = true;
  await assert.rejects(pushToRemote({ provider: "gitee" }), /backup failed/);
  assert.equal(writes.length, 0);
});
test("手动确认保留本地后建立基线，下次推送不重复弹出", async () => {
  const base = snapshot([bookmark("a")]), local = snapshot([bookmark("local")]);
  await initialize(base, local); data.syncState = { scopes: {} };
  const preview = await getMergePreview("gitee");
  await submitMerge({ provider: "gitee", snapshot: local, expected: preview });
  assert.deepEqual(state().baseSnapshot, local);
  assert.equal((await pushToRemote({ provider: "gitee" })).noop, true);
});
test("预览后本地变化拒绝提交，草稿不会覆盖新数据", async () => {
  const base = snapshot([bookmark("a")]); await initialize(base);
  const preview = await getMergePreview("gitee"); setLocal(snapshot([bookmark("new")]));
  await assert.rejects(submitMerge({ provider: "gitee", snapshot: base, expected: preview }), /已变化/);
  assert.equal(writes.length, 0);
});

test("单向推送后云端删除刚接受的本地新增，再次推送不会复活", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, snapshot([bookmark("a"), bookmark("local")]), snapshot([bookmark("a"), bookmark("remote")]));
  await pushToRemote({ provider: "gitee" });
  assert.ok(state().pendingMerge);
  remote = { exists: true, sha: "deleted-local", contentText: JSON.stringify(snapshot([bookmark("a"), bookmark("remote")])) };
  await pushToRemote({ provider: "gitee" });
  assert.deepEqual(remoteNodes().map(x => x.title), ["a", "remote"]);
  await pullFromRemote({ provider: "gitee" });
  assert.deepEqual(await localNodes(), remoteNodes());
  assert.equal(state().pendingMerge, undefined);
});
test("单向拉取后本地删除刚接受的远端新增，再次拉取不会复活", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, snapshot([bookmark("a"), bookmark("local")]), snapshot([bookmark("a"), bookmark("remote")]));
  await pullFromRemote({ provider: "gitee" });
  setLocal(snapshot([bookmark("a"), bookmark("local")]));
  await pullFromRemote({ provider: "gitee" });
  assert.deepEqual((await localNodes()).map(x => x.title), ["a", "local"]);
  await pushToRemote({ provider: "gitee" });
  assert.deepEqual(remoteNodes(), await localNodes());
});
test("单向合并后继续在本地新增，保留此前云端内容", async () => {
  const base = snapshot([bookmark("a")]);
  await initialize(base, snapshot([bookmark("a"), bookmark("local")]), snapshot([bookmark("a"), bookmark("remote")]));
  await pushToRemote({ provider: "gitee" });
  setLocal(snapshot([bookmark("a"), bookmark("local"), bookmark("next")]));
  await pushToRemote({ provider: "gitee" });
  assert.deepEqual(remoteNodes().map(x => x.title), ["a", "local", "next", "remote"]);
});
