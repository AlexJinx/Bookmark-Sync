function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.roots)) {
    throw new Error("快照格式非法，无法计算哈希");
  }
  return {
    version: snapshot.version || 1,
    roots: snapshot.roots
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const chunks = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${chunks.join(",")}}`;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function parseSnapshotText(text) {
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new Error("远端文件不是合法 JSON");
  }
  normalizeSnapshot(snapshot);
  return snapshot;
}

export async function hashSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const stableText = stableStringify(normalized);
  return sha256Hex(stableText);
}
