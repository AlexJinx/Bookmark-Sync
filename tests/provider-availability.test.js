import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { GitHubProvider } from "../src/providers/github.js";
import { GiteeProvider } from "../src/providers/gitee.js";
import { getBookmarkCounts, pushToRemote, pullFromRemote, getMergePreview, submitMerge, checkRemoteAhead } from "../src/background/sync-engine.js";
import { getCommitHistory, getCommitDetail } from "../src/background/history.js";
import { handleMessage } from "../src/background/message-router.js";
import { exportSnapshot } from "../src/core/bookmarks/service.js";
import { hashSnapshot } from "../src/core/snapshot/hash.js";
import { makeSyncState, getSyncScope } from "../src/background/sync-state.js";
import { AUTO_SYNC_ALARM, CHANGE_DEBOUNCE_ALARM, scheduleAutoSync } from "../src/background/scheduler.js";
import { PENDING_CHANGE_KEY, registerBookmarkTriggers } from "../src/background/triggers.js";

const clone = value => structuredClone(value);
const configured = () => ({ enabled: true, token: "test", owner: "owner", repo: "bookmarks", branch: "main", path: "bookmarks.json" });
let data, session, alarms, calls, listeners, local, cloud;
const disabledError = { code: "PROVIDER_DISABLED" };

beforeEach(async () => {
  data = { syncConfig: { provider: "github", github: configured(), gitee: configured() } };
  session = {}; alarms = new Map(); calls = []; listeners = {};
  local = { id: "0", children: [{ id: "1", title: "收藏夹栏", children: [{ id: "11", title: "a", url: "https://example.test/a" }] }] };
  const storage = store => ({
    get: async key => ({ [key]: clone(store[key]) }),
    set: async values => Object.assign(store, clone(values)),
    remove: async key => { delete store[key]; }
  });
  const event = name => ({ addListener: handler => { listeners[name] = handler; } });
  globalThis.chrome = {
    storage: { local: storage(data), session: storage(session) },
    bookmarks: {
      getTree: async () => [clone(local)],
      // These tests must never need to replace local bookmarks.
      getChildren: async () => { throw new Error("unexpected local import"); },
      onCreated: event("created"), onChanged: event("changed"), onMoved: event("moved"), onRemoved: event("removed")
    },
    alarms: {
      clear: async name => alarms.delete(name),
      create: (name, details) => alarms.set(name, details)
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
  };
  const snapshot = await exportSnapshot();
  cloud = Object.fromEntries(["github", "gitee"].map(id => [id, { exists: true, sha: "base", contentText: JSON.stringify(snapshot) }]));
  for (const [id, Provider] of [["github", GitHubProvider], ["gitee", GiteeProvider]]) {
    Provider.prototype.getRemoteFile = async () => { calls.push([id, "read"]); return clone(cloud[id]); };
    Provider.prototype.updateRemoteFile = async payload => {
      calls.push([id, "write"]);
      cloud[id] = { exists: true, sha: "written", contentText: payload };
      return { fileSha: "written", commitSha: "commit" };
    };
    Provider.prototype.listCommits = async () => { calls.push([id, "history"]); return []; };
    Provider.prototype.getCommit = async () => { calls.push([id, "detail"]); return {}; };
    Provider.prototype.testConnection = async () => { calls.push([id, "test"]); return { fullName: "owner/bookmarks" }; };
  }
});

function onlyGitee() {
  data.syncConfig.github.enabled = false;
}

function disableAll() {
  data.syncConfig.github.enabled = false;
  data.syncConfig.gitee.enabled = false;
}

async function establishBaselines() {
  const snapshot = await exportSnapshot();
  const hash = await hashSnapshot(snapshot);
  data.syncState = { scopes: {} };
  for (const provider of ["github", "gitee"]) {
    const config = { ...data.syncConfig, provider };
    data.syncState.scopes[getSyncScope(config)] = makeSyncState(config, "base", hash, snapshot);
  }
}

test("只启用 Gitee 时，云端计数、默认推拉和全平台推送均不访问 GitHub", async () => {
  onlyGitee();
  const counts = await getBookmarkCounts();
  assert.deepEqual(Object.keys(counts.remotes), ["gitee"]);
  assert.equal(counts.localBookmarks, 1);
  assert.equal(counts.remotes.gitee.bookmarks, 1);
  cloud.gitee = { exists: false, sha: null };
  assert.equal((await pushToRemote()).provider, "gitee");
  assert.equal((await pullFromRemote()).provider, "gitee");
  const all = await pushToRemote({ syncAllProviders: true });
  assert.deepEqual(all.providers, ["gitee"]);
  assert.ok(calls.some(([id, operation]) => id === "gitee" && operation === "write"));
  assert.ok(calls.every(([id]) => id === "gitee"));
});

test("只启用 GitHub 时，统计、默认推送和历史不访问 Gitee", async () => {
  data.syncConfig.provider = "gitee";
  data.syncConfig.gitee.enabled = false;
  const counts = await getBookmarkCounts();
  assert.deepEqual(Object.keys(counts.remotes), ["github"]);
  cloud.github = { exists: false, sha: null };
  assert.equal((await pushToRemote()).provider, "github");
  await getCommitHistory({ provider: "github" });
  assert.ok(calls.some(([id, operation]) => id === "github" && operation === "write"));
  assert.ok(calls.every(([id]) => id === "github"));
});

test("两个仓库都启用时，全平台推送分别写入并保留两份同步基线", async () => {
  cloud.github = { exists: false, sha: null };
  cloud.gitee = { exists: false, sha: null };
  const result = await pushToRemote({ syncAllProviders: true });
  assert.deepEqual(result.providers, ["github", "gitee"]);
  assert.deepEqual(calls.filter(([, operation]) => operation === "write").map(([id]) => id).sort(), ["gitee", "github"]);
  assert.equal(Object.keys(data.syncState.scopes).length, 2);
  assert.ok(Object.values(data.syncState.scopes).every(state => state.baseSnapshot));
});

test("即使显式指定，禁用仓库的推拉、合并、历史及连接测试也会被拒绝", async () => {
  onlyGitee();
  for (const operation of [
    () => pushToRemote({ provider: "github" }),
    () => pullFromRemote({ provider: "github" }),
    () => getMergePreview("github"),
    () => submitMerge({ provider: "github", snapshot: {} }),
    () => getCommitHistory({ provider: "github" }),
    () => getCommitDetail({ provider: "github", sha: "commit" }),
    () => handleMessage({ action: "testConnection", config: data.syncConfig })
  ]) await assert.rejects(operation, disabledError);
  assert.deepEqual(calls, []);
  assert.equal(data.lastMergeBackup, undefined);
});

test("启动云端更新检查只读取已启用仓库", async () => {
  await establishBaselines();
  onlyGitee();
  cloud.github.sha = "github-updated";
  cloud.gitee.sha = "gitee-updated";
  assert.deepEqual(await checkRemoteAhead(), { providers: ["gitee"] });
  assert.deepEqual(calls, [["gitee", "read"]]);
});

test("全部禁用时保留本地统计，不读取仓库、不同步或建立定时任务", async () => {
  disableAll();
  const counts = await getBookmarkCounts();
  assert.equal(counts.localBookmarks, 1);
  assert.deepEqual(counts.remotes, {});
  assert.equal(await checkRemoteAhead(), null);
  await assert.rejects(pushToRemote(), { code: "NO_SYNC_PROVIDER" });
  await assert.rejects(pushToRemote({ syncAllProviders: true }), { code: "NO_SYNC_PROVIDER" });
  await assert.rejects(pullFromRemote(), { code: "NO_SYNC_PROVIDER" });
  alarms.set(AUTO_SYNC_ALARM, {});
  await scheduleAutoSync({ ...data.syncConfig, autoSyncEnabled: true });
  assert.equal(alarms.has(AUTO_SYNC_ALARM), false);
  assert.deepEqual(calls, []);
});

test("计数等待本地书签期间禁用仓库，不会使用旧配置发起云端读取", async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  chrome.bookmarks.getTree = async () => { entered(); await gate; return [clone(local)]; };
  const counting = getBookmarkCounts();
  await started;
  disableAll();
  release();
  assert.deepEqual((await counting).remotes, {});
  assert.deepEqual(calls, []);
});

test("推送导出本地书签期间禁用目标，在读取云端前中止", async () => {
  onlyGitee();
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  chrome.bookmarks.getTree = async () => { entered(); await gate; return [clone(local)]; };
  const pushing = pushToRemote({ provider: "gitee" });
  const rejected = assert.rejects(pushing, disabledError);
  await started;
  data.syncConfig.gitee.enabled = false;
  release();
  await rejected;
  assert.deepEqual(calls, []);
});

test("保存全部禁用配置会取消待推送与防抖任务，重新启用会恢复定时推送", async () => {
  data.syncConfig.autoSyncEnabled = true;
  data.syncConfig.changeSync = { enabled: true, debounceSeconds: 60 };
  session[PENDING_CHANGE_KEY] = true;
  session.badgeState = "pending";
  alarms.set(AUTO_SYNC_ALARM, {});
  alarms.set(CHANGE_DEBOUNCE_ALARM, {});
  disableAll();
  const saved = await handleMessage({ action: "saveConfig", config: data.syncConfig });
  assert.equal(saved.github.token, "test");
  assert.equal(saved.autoSyncEnabled, true);
  assert.equal(session[PENDING_CHANGE_KEY], undefined);
  assert.equal(session.badgeState, "idle");
  assert.equal(alarms.has(AUTO_SYNC_ALARM), false);
  assert.equal(alarms.has(CHANGE_DEBOUNCE_ALARM), false);
  saved.gitee.enabled = true;
  const enabled = await handleMessage({ action: "saveConfig", config: saved });
  assert.equal(enabled.provider, "gitee");
  assert.equal(alarms.has(AUTO_SYNC_ALARM), true);
});

test("书签变更在全部禁用时不产生待推送，重新启用后正常防抖", async () => {
  disableAll();
  data.syncConfig.changeSync = { enabled: true, debounceSeconds: 45 };
  registerBookmarkTriggers();
  listeners.created();
  await setImmediate();
  assert.equal(session[PENDING_CHANGE_KEY], undefined);
  assert.equal(alarms.has(CHANGE_DEBOUNCE_ALARM), false);
  data.syncConfig.gitee.enabled = true;
  listeners.created();
  await setImmediate();
  assert.equal(session[PENDING_CHANGE_KEY], true);
  assert.equal(alarms.has(CHANGE_DEBOUNCE_ALARM), true);
});

test("禁用后拒绝旧合并页的提交，重新启用后仍能读取原仓库历史", async () => {
  onlyGitee();
  const preview = await getMergePreview("gitee");
  calls = [];
  data.syncConfig.gitee.enabled = false;
  for (const direction of ["push", "pull"]) {
    await assert.rejects(submitMerge({ provider: "gitee", expected: preview, snapshot: preview.local, direction }), disabledError);
  }
  assert.deepEqual(calls, []);
  data.syncConfig.gitee.enabled = true;
  const result = await getCommitHistory({ provider: "gitee" });
  assert.equal(result.configured, true);
  assert.deepEqual(calls, [["gitee", "history"]]);
});

test("推送读取途中禁用仓库时，在写入前中止", async () => {
  onlyGitee();
  GiteeProvider.prototype.getRemoteFile = async () => {
    calls.push(["gitee", "read"]);
    data.syncConfig.gitee.enabled = false;
    return { exists: false, sha: null };
  };
  await assert.rejects(pushToRemote({ provider: "gitee" }), disabledError);
  assert.deepEqual(calls, [["gitee", "read"]]);
});

test("拉取读取途中禁用仓库时，在覆盖本地前中止", async () => {
  onlyGitee();
  const snapshot = await exportSnapshot();
  snapshot.roots[0].children.push({ type: "bookmark", title: "remote", url: "https://example.test/remote" });
  GiteeProvider.prototype.getRemoteFile = async () => {
    data.syncConfig.gitee.enabled = false;
    return { exists: true, sha: "changed", contentText: JSON.stringify(snapshot) };
  };
  // An empty remote history requires an explicit merge when its contents differ.
  await establishBaselines();
  await assert.rejects(pullFromRemote({ provider: "gitee" }), disabledError);
  assert.equal((await exportSnapshot()).roots[0].children.length, 1);
});
