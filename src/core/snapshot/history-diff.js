function flatten(snapshot) {
  const result = [];
  function walk(nodes, path) {
    for (const node of nodes || []) {
      const entry = { type: node.type, title: node.title || "", path: JSON.stringify(path), url: node.url || "" };
      result.push(entry);
      if (node.type === "folder") walk(node.children, [...path, node.title || ""]);
    }
  }
  for (const root of snapshot?.roots || []) walk(root.children, [root.key || root.title || "root"]);
  return result;
}

export function buildHistoryDiff(before, after, limit = 200) {
  const old = flatten(before), next = flatten(after);
  const buckets = new Map();
  for (const item of old) {
    const key = JSON.stringify(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const added = [];
  for (const item of next) {
    const bucket = buckets.get(JSON.stringify(item));
    if (bucket?.length) bucket.pop(); else added.push(item);
  }
  const removed = [...buckets.values()].flat();
  const usedOld = new Set(), usedNew = new Set(), changed = [];
  // Snapshots have no stable IDs. Pair only unique matches; ambiguous changes remain additions/deletions.
  for (const keyOf of [x => JSON.stringify([x.type, x.path, x.title]), x => x.type === "bookmark" ? x.url : null]) {
    const left = new Map(), right = new Map();
    for (const [items, used, map] of [[removed, usedOld, left], [added, usedNew, right]]) {
      for (const item of items) {
        const key = keyOf(item);
        if (used.has(item) || !key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
      }
    }
    for (const [key, values] of left) {
      const matches = right.get(key);
      if (values.length !== 1 || matches?.length !== 1) continue;
      const previous = values[0], item = matches[0];
      usedOld.add(previous); usedNew.add(item);
      changed.push({ ...item, previousTitle: previous.title, previousPath: previous.path, previousUrl: previous.url });
    }
  }
  const displayPath = path => JSON.parse(path).join(" / ");
  const group = items => ({ total: items.length, truncated: items.length > limit, items: items.slice(0, limit).map(item => ({
    ...item, path: displayPath(item.path), ...(item.previousPath ? { previousPath: displayPath(item.previousPath) } : {})
  })) });
  return { hasComparison: true, added: group(added.filter(x => !usedNew.has(x))),
    removed: group(removed.filter(x => !usedOld.has(x))), changed: group(changed) };
}
