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
    const rootPath = root?.title || root?.key || "root";
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
