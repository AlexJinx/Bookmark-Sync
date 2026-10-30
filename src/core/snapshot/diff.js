function flattenSnapshot(snapshot) {
  const entries = [];

  function walkNodes(nodes, parentPath) {
    for (const node of nodes || []) {
      if (!node || typeof node !== "object") {
        continue;
      }

      if (node.type === "bookmark") {
        const title = node.title || "";
        const path = parentPath ? `${parentPath}/${title}` : title;
        const url = node.url || "";
        entries.push({
          type: "bookmark",
          key: `B|${parentPath}|${title}|${url}`,
          sample: { kind: "bookmark", path, url }
        });
        continue;
      }

      const title = node.title || "";
      const path = parentPath ? `${parentPath}/${title}` : title;
      entries.push({
        type: "folder",
        key: `F|${parentPath}|${title}`,
        sample: { kind: "folder", path, url: "" }
      });
      walkNodes(node.children || [], path);
    }
  }

  for (const root of snapshot?.roots || []) {
    const rootPath = root?.key || root?.title || "root";
    walkNodes(root?.children || [], rootPath);
  }

  return entries;
}

function countByType(entries) {
  let bookmarks = 0;
  let folders = 0;
  for (const item of entries) {
    if (item.type === "bookmark") {
      bookmarks += 1;
    } else if (item.type === "folder") {
      folders += 1;
    }
  }
  return {
    bookmarks,
    folders,
    total: bookmarks + folders
  };
}

function toMultiMap(entries) {
  const map = new Map();
  for (const item of entries) {
    const current = map.get(item.key);
    if (!current) {
      map.set(item.key, { count: 1, sample: item.sample });
    } else {
      current.count += 1;
    }
  }
  return map;
}

function expandDiffSamples(map, limit) {
  const samples = [];
  for (const [, value] of map) {
    for (let i = 0; i < value.count; i += 1) {
      samples.push(value.sample);
      if (samples.length >= limit) {
        return samples;
      }
    }
  }
  return samples;
}

// 差异摘要：samples 输出结构化 {kind, path, url}，由 UI 负责格式化文案。
export function buildDiffSummary(localSnapshot, remoteSnapshot, sampleLimit = 6) {
  const localEntries = flattenSnapshot(localSnapshot);
  const remoteEntries = flattenSnapshot(remoteSnapshot);

  const localCounts = countByType(localEntries);
  const remoteCounts = countByType(remoteEntries);

  const localMap = toMultiMap(localEntries);
  const remoteMap = toMultiMap(remoteEntries);

  const onlyLocalMap = new Map();
  const onlyRemoteMap = new Map();

  const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
  for (const key of allKeys) {
    const local = localMap.get(key);
    const remote = remoteMap.get(key);
    const localCount = local?.count || 0;
    const remoteCount = remote?.count || 0;

    if (localCount > remoteCount) {
      onlyLocalMap.set(key, {
        count: localCount - remoteCount,
        sample: local?.sample || remote?.sample
      });
    } else if (remoteCount > localCount) {
      onlyRemoteMap.set(key, {
        count: remoteCount - localCount,
        sample: remote?.sample || local?.sample
      });
    }
  }

  let onlyLocalTotal = 0;
  for (const [, value] of onlyLocalMap) {
    onlyLocalTotal += value.count;
  }
  let onlyRemoteTotal = 0;
  for (const [, value] of onlyRemoteMap) {
    onlyRemoteTotal += value.count;
  }

  return {
    local: localCounts,
    remote: remoteCounts,
    onlyLocalTotal,
    onlyRemoteTotal,
    samples: {
      onlyLocal: expandDiffSamples(onlyLocalMap, sampleLimit),
      onlyRemote: expandDiffSamples(onlyRemoteMap, sampleLimit)
    }
  };
}

export function collectBookmarkList(snapshot) {
  const items = [];

  function walkNodes(nodes, parentPath) {
    for (const node of nodes || []) {
      if (!node || typeof node !== "object") {
        continue;
      }

      if (node.type === "bookmark") {
        items.push({
          title: node.title || "",
          url: node.url || "",
          path: parentPath
        });
        continue;
      }

      const title = node.title || "";
      const folderPath = parentPath ? `${parentPath}/${title}` : title;
      walkNodes(node.children || [], folderPath);
    }
  }

  for (const root of snapshot?.roots || []) {
    const rootTitle = root?.title || root?.key || "";
    walkNodes(root?.children || [], rootTitle);
  }

  return items;
}

function pushToIndex(map, key, index) {
  if (!key) {
    return;
  }
  const list = map.get(key);
  if (list) {
    list.push(index);
  } else {
    map.set(key, [index]);
  }
}

function takeUnusedIndex(list, used) {
  if (!list) {
    return -1;
  }
  for (const index of list) {
    if (!used.has(index)) {
      return index;
    }
  }
  return -1;
}

function sliceChangeGroup(items, limit) {
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit
  };
}

export function buildBookmarkChanges(previousSnapshot, currentSnapshot, { limit = 30 } = {}) {
  const previous = collectBookmarkList(previousSnapshot);
  const current = collectBookmarkList(currentSnapshot);
  const usedPrevious = new Set();
  const changed = [];
  const unmatched = [];

  const previousByUrl = new Map();
  previous.forEach((item, index) => pushToIndex(previousByUrl, item.url, index));

  for (const item of current) {
    const index = takeUnusedIndex(previousByUrl.get(item.url), usedPrevious);
    if (index === -1) {
      unmatched.push(item);
      continue;
    }

    usedPrevious.add(index);
    const before = previous[index];
    if (before.title !== item.title || before.path !== item.path) {
      changed.push({
        title: item.title,
        url: item.url,
        path: item.path,
        previousTitle: before.title,
        previousPath: before.path,
        previousUrl: before.url,
        kind: "updated"
      });
    }
  }

  const previousByTitle = new Map();
  previous.forEach((item, index) => {
    if (!usedPrevious.has(index)) {
      pushToIndex(previousByTitle, item.title, index);
    }
  });

  const added = [];
  for (const item of unmatched) {
    const index = takeUnusedIndex(previousByTitle.get(item.title), usedPrevious);
    if (index === -1) {
      added.push(item);
      continue;
    }

    usedPrevious.add(index);
    const before = previous[index];
    changed.push({
      title: item.title,
      url: item.url,
      path: item.path,
      previousTitle: before.title,
      previousPath: before.path,
      previousUrl: before.url,
      kind: "replaced"
    });
  }

  const removed = previous.filter((_, index) => !usedPrevious.has(index));

  return {
    added: sliceChangeGroup(added, limit),
    removed: sliceChangeGroup(removed, limit),
    changed: sliceChangeGroup(changed, limit)
  };
}
