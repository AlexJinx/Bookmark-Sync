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
