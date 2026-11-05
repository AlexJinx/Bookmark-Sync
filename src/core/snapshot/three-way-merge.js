import { comparableNode, nodeSignature as signature, nodesEqual as same } from "./merge-signature.js";

// Snapshots have no cross-device node IDs. Match only unambiguous sibling
// identities; uncertain renames, duplicate identities and ordering need review.
const identity = node => JSON.stringify([node.type, node.title || ""]);
const urlIdentity = node => node.type === "bookmark" ? node.url : null;

function locations(snapshot) {
  const result = new Map();
  function walk(nodes, path) {
    for (const node of nodes) {
      const keys = [identity(node), ...(urlIdentity(node) ? [`url:${urlIdentity(node)}`] : [])];
      for (const key of keys) result.set(key, [...(result.get(key) || []), JSON.stringify(path)]);
      if (node.type === "folder") walk(node.children, [...path, node.title || ""]);
    }
  }
  for (const root of snapshot.roots) walk(root.children, [root.key || root.title]);
  return result;
}

function moved(before, after) {
  for (const [key, paths] of before) {
    const current = after.get(key);
    if (paths.length === 1 && current?.length === 1 && paths[0] !== current[0]) return true;
  }
  return false;
}

function align(base, current) {
  const used = new Set(), indices = [];
  for (const node of base) {
    const candidates = current.map((other, i) => ({ other, i })).filter(({ other }) =>
      identity(other) === identity(node) || (urlIdentity(node) && urlIdentity(other) === urlIdentity(node)));
    if (candidates.length > 1 || (candidates.length === 1 && used.has(candidates[0].i))) return null;
    const index = candidates[0]?.i ?? -1;
    indices.push(index);
    if (index >= 0) used.add(index);
  }
  const added = current.filter((_, i) => !used.has(i));
  // A missing identity plus a new identity may be a rename, not a deletion.
  if (base.some((node, i) => indices[i] < 0 && added.some(other => other.type === node.type))) return null;
  const present = indices.filter(i => i >= 0);
  if (present.some((index, i) => i > 0 && index < present[i - 1])) return null;
  return { indices, added };
}

export function createThreeWayMergePlan(local, remote, base) {
  const conflicts = [], automatic = [];
  const content = snapshot => [...snapshot.roots].map(root => [root.key || root.title, root.children.map(comparableNode)])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  const baseContent = JSON.stringify(content(base));
  const bothChanged = JSON.stringify(content(local)) !== baseContent && JSON.stringify(content(remote)) !== baseContent;
  const previousLocations = bothChanged ? locations(base) : null;
  const uncertainMove = bothChanged && (moved(previousLocations, locations(local)) || moved(previousLocations, locations(remote)));
  function choice(left, right, path, reason, group = false) {
    const id = String(conflicts.length);
    const wrap = children => ({ type: "folder", title: "此目录的内容", children });
    conflicts.push({ id, local: group ? wrap(left) : left, remote: group ? wrap(right) : right, path, reason, group });
    return { choice: id };
  }
  function values(nodes) { return nodes.map(value => ({ value })); }
  function list(left, right, before, path) {
    if (same(left, right)) return values(left);
    if (uncertainMove && path.length === 1) return [choice(left, right, path, "ambiguous_move", true)];
    if (same(left, before) || same(right, before)) {
      const source = same(left, before) ? "remote" : "local";
      automatic.push({ path, source });
      return values(source === "remote" ? right : left);
    }
    const conflictStart = conflicts.length, automaticStart = automatic.length;
    const ambiguous = () => {
      conflicts.length = conflictStart; automatic.length = automaticStart;
      return [choice(left, right, path, "ambiguous_identity_or_order", true)];
    };
    const l = align(before, left), r = align(before, right);
    if (!l || !r) return ambiguous();
    const resolved = new Map();
    before.forEach((original, i) => {
      const a = left[l.indices[i]] || null, b = right[r.indices[i]] || null;
      let result;
      if (!a && !b) result = [];
      else if (a && b && signature(a) === signature(b)) result = values([a]);
      else if (a && signature(a) === signature(original)) {
        automatic.push({ path, source: "remote" }); result = values(b ? [b] : []);
      } else if (b && signature(b) === signature(original)) {
        automatic.push({ path, source: "local" }); result = values(a ? [a] : []);
      } else if (a?.type === "folder" && b?.type === "folder" && a.title === b.title && a.title === original.title) {
        result = [{ folder: a, children: list(a.children, b.children, original.children, [...path, a.title]) }];
      } else result = [choice(a, b, path, !a || !b ? "delete_modify" : "both_modified")];
      // Use the local position when available. Deleted local nodes with remote
      // edits are kept as explicit choices at the end, never silently discarded.
      resolved.set(i, result);
    });
    const result = [], usedRight = new Set();
    for (let index = 0; index < left.length; index++) {
      const baseIndex = l.indices.indexOf(index);
      if (baseIndex >= 0) { result.push(...resolved.get(baseIndex)); continue; }
      const node = left[index];
      const matches = r.added.map((other, i) => ({ other, i })).filter(({ other }) =>
        identity(node) === identity(other) || (urlIdentity(node) && urlIdentity(node) === urlIdentity(other)));
      if (matches.length > 1 || (matches.length === 1 && usedRight.has(matches[0].i))) {
        return ambiguous();
      }
      const match = matches[0];
      if (!match) { automatic.push({ path, source: "local" }); result.push(...values([node])); }
      else {
        usedRight.add(match.i);
        if (signature(node) === signature(match.other)) result.push(...values([node]));
        else if (node.type === "folder" && match.other.type === "folder") {
          result.push({ folder: node, children: list(node.children, match.other.children, [], [...path, node.title]) });
        } else result.push(choice(node, match.other, path, "both_added"));
      }
    }
    before.forEach((_, i) => { if (l.indices[i] < 0) result.push(...resolved.get(i)); });
    r.added.forEach((node, i) => {
      if (!usedRight.has(i)) { automatic.push({ path, source: "remote" }); result.push(...values([node])); }
    });
    return result;
  }
  const key = root => root.key || `title:${root.title || ""}`;
  const roots = new Map([...local.roots, ...remote.roots, ...base.roots].map(root => [key(root), root]));
  const plans = [...roots].map(([id, root]) => ({ root,
    children: list(local.roots.find(x => key(x) === id)?.children || [],
      remote.roots.find(x => key(x) === id)?.children || [],
      base.roots.find(x => key(x) === id)?.children || [], [root.title || root.key])
  }));
  function build(selections = {}) {
    function resolve(items) {
      return items.flatMap(item => {
        if (item.value) return [structuredClone(item.value)];
        if (item.folder) return [{ ...structuredClone(item.folder), children: resolve(item.children) }];
        const decision = selections[item.choice], conflict = conflicts[Number(item.choice)];
        if (!["local", "remote", "both", "none"].includes(decision)) throw new Error("请先完成所有差异项的选择");
        const selected = decision === "none" ? [] : decision === "both" ? [conflict.local, conflict.remote] : [conflict[decision]];
        return selected.filter(Boolean).flatMap(node => structuredClone(conflict.group ? node.children : [node]));
      });
    }
    return { ...structuredClone(local), updatedAt: new Date().toISOString(),
      roots: plans.map(({ root, children }) => ({ ...structuredClone(root), children: resolve(children) })) };
  }
  return { conflicts, automatic, hasBase: true, build };
}
