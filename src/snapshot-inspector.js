function canonicalNode(node) {
  if (node?.type === "bookmark") {
    return JSON.stringify(["bookmark", node.title || "", node.url || ""]);
  }

  return JSON.stringify([
    "folder",
    node?.title || "",
    (node?.children || []).map((child) => canonicalNode(child))
  ]);
}

function joinPath(parentPath, title) {
  const value = title || "(未命名目录)";
  return parentPath ? `${parentPath}/${value}` : value;
}

export function findExactDuplicateFolderGroups(snapshot) {
  const groups = [];

  function walk(nodes, parentPath) {
    const folders = (nodes || []).filter((node) => node?.type === "folder");
    const bySignature = new Map();

    for (const folder of folders) {
      const signature = canonicalNode(folder);
      const current = bySignature.get(signature);
      if (current) {
        current.count += 1;
      } else {
        bySignature.set(signature, {
          title: folder.title || "",
          count: 1
        });
      }
    }

    for (const value of bySignature.values()) {
      if (value.count <= 1) {
        continue;
      }
      groups.push({
        parentPath,
        path: joinPath(parentPath, value.title),
        title: value.title,
        count: value.count,
        extraCount: value.count - 1
      });
    }

    for (const folder of folders) {
      walk(folder.children || [], joinPath(parentPath, folder.title));
    }
  }

  for (const root of snapshot?.roots || []) {
    const rootPath = root?.key || root?.title || "root";
    walk(root?.children || [], rootPath);
  }

  return groups;
}

export function summarizeExactDuplicateFolders(snapshot, sampleLimit = 6) {
  const groups = findExactDuplicateFolderGroups(snapshot);
  return {
    groupCount: groups.length,
    extraFolders: groups.reduce((total, item) => total + item.extraCount, 0),
    samples: groups.slice(0, Math.max(0, sampleLimit)).map((item) => `${item.path}（${item.count} 份）`)
  };
}
