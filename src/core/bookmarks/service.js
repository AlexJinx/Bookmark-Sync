import { getSyncableRoots, resolveTargetRoot } from "./roots.js";

// ---- 自变更抑制 ----
// applySnapshot / clearAllBookmarks 会批量改写书签树，触发大量 bookmarks.on* 事件。
// 若不抑制，"拉取导入 -> 触发变更监听 -> 自动推送 -> 其他设备拉取 -> ..." 会形成回音循环；
// 清空书签则更糟：会把空树自动推送到云端。
// 计数器语义：>0 表示当前书签变更来自本扩展自身，变更监听器必须忽略。
// 安全性依据：导入/清空在单个消息处理内 await 完成，事件派发同属一个 SW 生命周期。
let selfMutationDepth = 0;

export function isSelfMutating() {
  return selfMutationDepth > 0;
}

async function withSelfMutation(fn) {
  selfMutationDepth += 1;
  try {
    return await fn();
  } finally {
    selfMutationDepth -= 1;
  }
}

// ---- 快照结构校验 ----

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("快照为空或格式非法");
  }
  if (!Array.isArray(snapshot.roots)) {
    throw new Error("快照缺少 roots 字段");
  }

  for (let i = 0; i < snapshot.roots.length; i += 1) {
    validateRoot(snapshot.roots[i], `roots[${i}]`);
  }
}

function validateRoot(root, path) {
  if (!root || typeof root !== "object") {
    throw new Error(`快照结构非法: ${path} 必须是对象`);
  }

  if (!Array.isArray(root.children)) {
    throw new Error(`快照结构非法: ${path}.children 必须是数组`);
  }

  if (root.key !== undefined && typeof root.key !== "string") {
    throw new Error(`快照结构非法: ${path}.key 必须是字符串`);
  }

  if (root.title !== undefined && typeof root.title !== "string") {
    throw new Error(`快照结构非法: ${path}.title 必须是字符串`);
  }

  for (let i = 0; i < root.children.length; i += 1) {
    validateSnapshotNode(root.children[i], `${path}.children[${i}]`);
  }
}

function validateSnapshotNode(node, path) {
  if (!node || typeof node !== "object") {
    throw new Error(`快照结构非法: ${path} 必须是对象`);
  }

  if (node.title !== undefined && typeof node.title !== "string") {
    throw new Error(`快照结构非法: ${path}.title 必须是字符串`);
  }

  if (node.type === "bookmark") {
    if (typeof node.url !== "string" || !node.url.trim()) {
      throw new Error(`快照结构非法: ${path}.url 必须是非空字符串`);
    }
    if (!isValidBookmarkUrl(node.url)) {
      throw new Error(`快照结构非法: ${path}.url 不是合法 URL`);
    }
    return;
  }

  if (node.type === "folder") {
    if (!Array.isArray(node.children)) {
      throw new Error(`快照结构非法: ${path}.children 必须是数组`);
    }
    for (let i = 0; i < node.children.length; i += 1) {
      validateSnapshotNode(node.children[i], `${path}.children[${i}]`);
    }
    return;
  }

  throw new Error(`快照结构非法: ${path}.type 必须是 bookmark 或 folder`);
}

function isValidBookmarkUrl(url) {
  try {
    // Chrome 书签要求绝对 URL；先校验避免导入到一半失败造成部分覆盖。
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ---- 树读写 ----

function toSnapshotNode(node) {
  if (node.url) {
    return {
      type: "bookmark",
      title: node.title || "",
      url: node.url
    };
  }

  return {
    type: "folder",
    title: node.title || "",
    children: (node.children || []).map(toSnapshotNode)
  };
}

async function clearChildren(parentId) {
  const children = await chrome.bookmarks.getChildren(parentId);
  for (const child of children) {
    if (child.url) {
      await chrome.bookmarks.remove(child.id);
    } else {
      await chrome.bookmarks.removeTree(child.id);
    }
  }
}

async function createNode(parentId, node) {
  if (node.type === "bookmark") {
    await chrome.bookmarks.create({
      parentId,
      title: node.title || "",
      url: node.url
    });
    return;
  }

  const folder = await chrome.bookmarks.create({
    parentId,
    title: node.title || ""
  });

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    await createNode(folder.id, child);
  }
}

async function applySnapshot(snapshot) {
  const syncableRoots = await getSyncableRoots();

  for (const sourceRoot of snapshot.roots) {
    if (!sourceRoot || !Array.isArray(sourceRoot.children)) {
      continue;
    }

    const targetRoot = resolveTargetRoot(sourceRoot, syncableRoots);
    if (!targetRoot) {
      // 浏览器通常不允许扩展创建新的顶层根节点，跳过未知根以免中断整体导入。
      continue;
    }

    await clearChildren(targetRoot.id);
    for (const child of sourceRoot.children) {
      await createNode(targetRoot.id, child);
    }
  }
}

// ---- 对外 API ----

export async function exportSnapshot() {
  const syncableRoots = await getSyncableRoots();
  const roots = syncableRoots.map(({ key, title, node }) => ({
    key,
    title,
    children: (node.children || []).map(toSnapshotNode)
  }));

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    roots
  };
}

export async function importSnapshot(snapshot) {
  validateSnapshot(snapshot);

  const backupSnapshot = await exportSnapshot();
  // 抑制范围覆盖导入与回滚全程（回滚同样是自变更，漏掉会触发回音推送）。
  return withSelfMutation(async () => {
    try {
      await applySnapshot(snapshot);
    } catch (error) {
      try {
        await applySnapshot(backupSnapshot);
      } catch (rollbackError) {
        throw new Error(`导入失败，且回滚失败：${error.message}；回滚错误：${rollbackError.message}`);
      }
      throw new Error(`导入失败，已回滚：${error.message}`);
    }

    return {
      importedAt: new Date().toISOString(),
      rootCount: snapshot.roots.length
    };
  });
}

// 清空三个标准根下的所有书签（不触碰 Edge workspace 等非标准根）。
// 返回清空前的快照；onBackupReady 在任何删除发生之前调用，
// 备份持久化失败则整个清空中止——绝不能出现“书签没了、备份也没存上”。
export async function clearAllBookmarks({ onBackupReady } = {}) {
  const backupSnapshot = await exportSnapshot();
  if (onBackupReady) {
    await onBackupReady(backupSnapshot);
  }

  await withSelfMutation(async () => {
    const syncableRoots = await getSyncableRoots();
    for (const root of syncableRoots) {
      await clearChildren(root.id);
    }
  });

  return {
    clearedAt: new Date().toISOString(),
    backupSnapshot
  };
}
