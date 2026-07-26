// 顶层书签根节点识别与映射。
// 快照键保持 bookmark_bar / other / mobile 不变（向后兼容既有快照）。
// 识别顺序：
//   1. node.folderType（Chromium 134+ 提供，最可靠，未来 id 变化也不受影响）
//   2. Firefox 固定 GUID（为未来移植预留；menu 是 Firefox 独有的可选根）
//   3. Chromium 传统 id "1"/"2"/"3"（当前 Chrome/Edge 的实际路径）
// 未识别的根（如 Edge workspace folder、managed 根）一律跳过，不导出也不导入。

const FOLDER_TYPE_KEYS = {
  "bookmarks-bar": "bookmark_bar",
  other: "other",
  mobile: "mobile"
};

const FIREFOX_GUID_KEYS = {
  "toolbar_____": "bookmark_bar",
  "unfiled_____": "other",
  "mobile______": "mobile",
  "menu________": "menu"
};

const CHROMIUM_ID_KEYS = {
  "1": "bookmark_bar",
  "2": "other",
  "3": "mobile"
};

export function resolveRootKey(node) {
  if (!node) {
    return null;
  }

  if (typeof node.folderType === "string") {
    if (node.folderType === "managed") {
      return null;
    }
    return FOLDER_TYPE_KEYS[node.folderType] || null;
  }

  if (FIREFOX_GUID_KEYS[node.id]) {
    return FIREFOX_GUID_KEYS[node.id];
  }

  return CHROMIUM_ID_KEYS[node.id] || null;
}

// 返回 [{key, id, title, node}]，仅包含可同步的标准根。
export async function getSyncableRoots() {
  const tree = await chrome.bookmarks.getTree();
  const roots = [];
  for (const node of tree[0]?.children || []) {
    const key = resolveRootKey(node);
    if (key) {
      roots.push({ key, id: node.id, title: node.title || "", node });
    }
  }
  return roots;
}

// 快照根 -> 本地目标根：key 匹配优先，其次标题回退（与旧版语义一致），找不到则跳过。
export function resolveTargetRoot(sourceRoot, syncableRoots) {
  if (!sourceRoot) {
    return null;
  }

  const byKey = syncableRoots.find((item) => item.key === sourceRoot.key);
  if (byKey) {
    return byKey;
  }

  return syncableRoots.find((item) => item.title === sourceRoot.title) || null;
}
