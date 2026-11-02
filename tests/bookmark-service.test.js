import assert from "node:assert/strict";
import test from "node:test";

function createBookmarkApiMock({ omitCreatedBookmarks = false } = {}) {
  let nextId = 4;
  const root = {
    id: "0",
    title: "",
    children: [
      { id: "1", title: "收藏夹栏", children: [] },
      { id: "2", title: "其他收藏夹", children: [] },
      { id: "3", title: "移动设备", children: [] }
    ]
  };

  function findNode(id, node = root) {
    if (node.id === String(id)) {
      return node;
    }
    for (const child of node.children || []) {
      const found = findNode(id, child);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function removeNode(id, node = root) {
    const index = (node.children || []).findIndex((child) => child.id === String(id));
    if (index >= 0) {
      node.children.splice(index, 1);
      return true;
    }
    return (node.children || []).some((child) => removeNode(id, child));
  }

  const runtime = { lastError: null };
  const bookmarks = {
    async getTree() {
      return [root];
    },
    async getChildren(parentId) {
      return [...(findNode(parentId)?.children || [])];
    },
    async create(input) {
      const node = {
        id: String(nextId++),
        title: input.title || "",
        children: []
      };
      if (input.url) {
        node.url = input.url;
      }
      if (!(omitCreatedBookmarks && input.url)) {
        findNode(input.parentId).children.push(node);
      }
      return node;
    },
    async remove(id) {
      removeNode(id);
    },
    async removeTree(id) {
      removeNode(id);
    }
  };

  return { root, runtime, bookmarks, findNode };
}

async function loadBookmarkService(mock) {
  globalThis.chrome = {
    runtime: mock.runtime,
    bookmarks: mock.bookmarks
  };
  const moduleUrl = new URL("../src/core/bookmarks/service.js", import.meta.url);
  moduleUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

function createSnapshot() {
  return {
    version: 1,
    roots: [
      {
        key: "bookmark_bar",
        title: "收藏夹栏",
        children: [
          {
            type: "folder",
            title: "Tools",
            children: [
              {
                type: "bookmark",
                title: "Example",
                url: "https://example.com"
              }
            ]
          }
        ]
      }
    ]
  };
}

test("并发导入会被串行化，不会创建重复目录树", async () => {
  const mock = createBookmarkApiMock();
  const { importSnapshot } = await loadBookmarkService(mock);
  const snapshot = createSnapshot();

  await Promise.all([importSnapshot(snapshot), importSnapshot(snapshot)]);

  const toolsFolders = mock.findNode("1").children.filter((node) => node.title === "Tools");
  assert.equal(toolsFolders.length, 1);
  assert.equal(toolsFolders[0].children.length, 1);
});

test("导入前会阻止完全相同的重复目录", async () => {
  const mock = createBookmarkApiMock();
  const { importSnapshot } = await loadBookmarkService(mock);
  const snapshot = createSnapshot();
  snapshot.roots[0].children.push(structuredClone(snapshot.roots[0].children[0]));

  await assert.rejects(importSnapshot(snapshot), /完全重复目录/);
  assert.equal(mock.findNode("1").children.length, 0);
});

test("导入后校验失败会恢复导入前书签", async () => {
  const mock = createBookmarkApiMock({ omitCreatedBookmarks: true });
  const { importSnapshot } = await loadBookmarkService(mock);

  await assert.rejects(importSnapshot(createSnapshot()), /导入失败，已回滚/);
  assert.equal(mock.findNode("1").children.length, 0);
});

test("导入前本地版本变化会被阻止且不修改书签", async () => {
  const mock = createBookmarkApiMock();
  const { importSnapshot } = await loadBookmarkService(mock);
  await assert.rejects(importSnapshot(createSnapshot(), { expectedLocalHash: "outdated" }), /本地书签已变化/);
  assert.equal(mock.findNode("1").children.length, 0);
});

test("拉取冲突不能强制绕过，合并只写本地且过期版本被阻止", async () => {
  const mock = createBookmarkApiMock();
  await loadBookmarkService(mock);
  const store = { syncConfig: { provider: "github", github: { token: "test", owner: "owner", repo: "repo", branch: "main", path: "snapshot.json" } } };
  chrome.storage = { local: {
    get: async key => ({ [key]: structuredClone(store[key]) }),
    set: async patch => Object.assign(store, structuredClone(patch))
  } };
  const { GitHubProvider } = await import("../src/providers/github.js");
  const { pullFromRemote, getMergePreview, submitMerge } = await import("../src/background/sync-engine.js");
  const read = GitHubProvider.prototype.getRemoteFile;
  const write = GitHubProvider.prototype.updateRemoteFile;
  let sha = "v1", writes = 0;
  const remote = createSnapshot();
  GitHubProvider.prototype.getRemoteFile = async () => ({ exists: true, sha, contentText: JSON.stringify(remote) });
  GitHubProvider.prototype.updateRemoteFile = async () => { writes++; throw new Error("must not write cloud"); };
  try {
    await mock.bookmarks.create({ parentId: "1", title: "local", url: "https://local.example" });
    await assert.rejects(pullFromRemote({ provider: "github", force: true }), error => error.code === "SYNC_CONFLICT");
    assert.equal(mock.findNode("1").children[0].title, "local");
    const expected = await getMergePreview("github");
    sha = "v2";
    await assert.rejects(submitMerge({ provider: "github", direction: "pull", expected, snapshot: remote }), /已变化/);
    sha = "v1";
    await submitMerge({ provider: "github", direction: "pull", expected, snapshot: remote });
    assert.equal(mock.findNode("1").children[0].title, "Tools");
    assert.equal(store.lastMergeBackup.local.roots[0].children[0].title, "local");
    assert.equal(store.lastSync.direction, "pull");
    assert.equal(store.lastSync.merged, true);
    assert.equal(writes, 0);
    await assert.rejects(submitMerge({ provider: "github", direction: "pull", expected, snapshot: remote }), /已变化/);
  } finally {
    GitHubProvider.prototype.getRemoteFile = read;
    GitHubProvider.prototype.updateRemoteFile = write;
  }
});
