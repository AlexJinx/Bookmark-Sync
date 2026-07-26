export function countBookmarkNodes(nodes) {
  let count = 0;
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") {
      continue;
    }

    if (node.type === "bookmark") {
      count += 1;
      continue;
    }

    if (Array.isArray(node.children)) {
      count += countBookmarkNodes(node.children);
    }
  }
  return count;
}

export function countSnapshotBookmarks(snapshot) {
  let total = 0;
  for (const root of snapshot?.roots || []) {
    total += countBookmarkNodes(root?.children || []);
  }
  return total;
}
