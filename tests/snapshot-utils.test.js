import assert from "node:assert/strict";
import test from "node:test";

import { buildDiffSummary } from "../src/core/snapshot/diff.js";
import { hashSnapshot } from "../src/core/snapshot/hash.js";
import { summarizeExactDuplicateFolders } from "../src/snapshot-inspector.js";

function folder(title, url) {
  return {
    type: "folder",
    title,
    children: [{ type: "bookmark", title: "Example", url }]
  };
}

test("快照检查器只报告内容完全相同的同级目录", () => {
  const snapshot = {
    version: 1,
    roots: [
      {
        key: "bookmark_bar",
        title: "收藏夹栏",
        children: [folder("Tools", "https://example.com"), folder("Tools", "https://example.com"), folder("Tools", "https://openai.com")]
      }
    ]
  };

  const result = summarizeExactDuplicateFolders(snapshot);
  assert.equal(result.groupCount, 1);
  assert.equal(result.extraFolders, 1);
  assert.match(result.samples[0], /Tools/);
});

test("根节点本地化标题不同不会改变快照哈希或差异", async () => {
  const local = {
    version: 1,
    roots: [{ key: "bookmark_bar", title: "收藏夹栏", children: [folder("Tools", "https://example.com")] }]
  };
  const remote = {
    version: 1,
    roots: [{ key: "bookmark_bar", title: "Bookmarks bar", children: [folder("Tools", "https://example.com")] }]
  };

  assert.equal(await hashSnapshot(local), await hashSnapshot(remote));
  const diff = buildDiffSummary(local, remote);
  assert.equal(diff.onlyLocalTotal, 0);
  assert.equal(diff.onlyRemoteTotal, 0);
});
