const ROOT_KEYS = {
  "1": "bookmark_bar",
  "2": "other",
  "3": "mobile"
};

function getRootKey(node) {
  return ROOT_KEYS[node.id] || `custom:${node.title}`;
}

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
    // Chrome bookmarks require absolute URL-like values.
    // Pre-validate to avoid partial overwrite during import.
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function getTree() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((tree) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(tree);
    });
  });
}

async function getChildren(parentId) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getChildren(parentId, (children) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(children);
    });
  });
}

async function createBookmark(node) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(node, (created) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(created);
    });
  });
}

async function removeBookmark(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.remove(id, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

async function removeBookmarkTree(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.removeTree(id, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

async function clearChildren(parentId) {
  const children = await getChildren(parentId);
  for (const child of children) {
    if (child.url) {
      await removeBookmark(child.id);
    } else {
      await removeBookmarkTree(child.id);
    }
  }
}

async function createNode(parentId, node) {
  if (node.type === "bookmark") {
    await createBookmark({
      parentId,
      title: node.title || "",
      url: node.url
    });
    return;
  }

  const folder = await createBookmark({
    parentId,
    title: node.title || ""
  });

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    await createNode(folder.id, child);
  }
}

async function applySnapshot(snapshot) {
  const tree = await getTree();
  const root = tree[0];
  const currentRoots = root.children || [];
  const mapByKey = new Map(currentRoots.map((node) => [getRootKey(node), node]));

  for (const sourceRoot of snapshot.roots) {
    if (!sourceRoot || !Array.isArray(sourceRoot.children)) {
      continue;
    }

    let targetRoot = mapByKey.get(sourceRoot.key);
    if (!targetRoot) {
      targetRoot = currentRoots.find((node) => node.title === sourceRoot.title);
    }
    if (!targetRoot) {
      // Browsers usually do not allow creating new top-level bookmark roots.
      // Skip unknown roots to avoid aborting the whole import.
      continue;
    }

    await clearChildren(targetRoot.id);
    for (const child of sourceRoot.children) {
      await createNode(targetRoot.id, child);
    }
  }
}

export async function exportSnapshot() {
  const tree = await getTree();
  const root = tree[0];
  const roots = (root.children || []).map((node) => ({
    key: getRootKey(node),
    title: node.title,
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
}
