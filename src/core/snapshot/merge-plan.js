function signature(node) {
  return JSON.stringify(node.type === "folder"
    ? { type: "folder", title: node.title || "", children: node.children.map(signature) }
    : { type: "bookmark", title: node.title || "", url: node.url });
}

export function createMergePlan(local, remote) {
  const conflicts = [];
  function choice(left, right, path) {
    const id = String(conflicts.length);
    conflicts.push({ id, local: left || null, remote: right || null, path });
    return { choice: id };
  }
  function nodes(left, right, path) {
    const used = new Set();
    return [...left.map(node => {
      let index = right.findIndex((other, i) => !used.has(i) && signature(node) === signature(other));
      if (index >= 0) { used.add(index); return { value: node }; }
      // Only pair unique identities. Duplicate/ambiguous items remain separate decisions.
      for (const key of [x => `${x.type}:${x.title || ""}`, x => x.type === "bookmark" ? `url:${x.url}` : null]) {
        const identity = key(node);
        if (!identity || left.filter(x => key(x) === identity).length !== 1) continue;
        const matches = right.map((other, i) => ({ other, i })).filter(x => !used.has(x.i) && key(x.other) === identity);
        if (matches.length === 1) { index = matches[0].i; break; }
      }
      if (index < 0) return choice(node, null, path);
      used.add(index);
      const other = right[index];
      if (node.type === "folder" && other.type === "folder" && node.title === other.title) {
        return { folder: node, children: nodes(node.children, other.children, [...path, node.title || "未命名目录"]) };
      }
      return choice(node, other, path);
    }), ...right.filter((_, i) => !used.has(i)).map(node => choice(null, node, path))];
  }
  const rootKey = root => root.key || `title:${root.title || ""}`;
  const roots = [], usedRoots = new Set();
  for (const root of local.roots) {
    const other = remote?.roots.find(x => rootKey(x) === rootKey(root));
    usedRoots.add(rootKey(root));
    roots.push({ root, children: nodes(root.children, other?.children || [], [root.title || root.key]) });
  }
  for (const root of remote?.roots || []) {
    if (!usedRoots.has(rootKey(root))) roots.push({ root, children: nodes([], root.children, [root.title || root.key]) });
  }
  function build(selections) {
    function resolve(items) {
      return items.flatMap(item => {
        if (item.value) return [structuredClone(item.value)];
        if (item.folder) return [{ ...structuredClone(item.folder), children: resolve(item.children) }];
        const decision = selections[item.choice];
        if (!["local", "remote", "both", "none"].includes(decision)) throw new Error("请先完成所有差异项的选择");
        const conflict = conflicts[Number(item.choice)];
        const selected = decision === "none" ? [] : decision === "both" ? [conflict.local, conflict.remote] : [conflict[decision]];
        return selected.filter(Boolean).map(x => structuredClone(x));
      });
    }
    return { ...structuredClone(local), updatedAt: new Date().toISOString(), roots: roots.map(({ root, children }) => ({ ...structuredClone(root), children: resolve(children) })) };
  }
  return { conflicts, build };
}
