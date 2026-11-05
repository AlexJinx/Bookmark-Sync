// Keep nested values structured until the final stringify. Stringifying child
// signatures recursively doubles escaping at each level in deeply nested trees.
export function comparableNode(node) {
  return node.type === "folder"
    ? ["folder", node.title || "", node.children.map(comparableNode)]
    : ["bookmark", node.title || "", node.url];
}

export function nodeSignature(node) {
  return JSON.stringify(comparableNode(node));
}

export function nodesEqual(left, right) {
  return JSON.stringify(left.map(comparableNode)) === JSON.stringify(right.map(comparableNode));
}
