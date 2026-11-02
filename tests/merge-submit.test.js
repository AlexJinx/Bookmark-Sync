import assert from "node:assert/strict";
import test from "node:test";
import { GitHubProvider } from "../src/providers/github.js";
import { getMergePreview, submitMerge } from "../src/background/sync-engine.js";

test("merge submission validates versions, backs up data and never retries a rejected write", async () => {
  const store = { syncConfig: { provider: "github", github: { token: "test", owner: "owner", repo: "repo", branch: "main", path: "snapshot.json" } } };
  const root = { id: "0", title: "", children: [{ id: "1", title: "Bookmarks", children: [] }] };
  globalThis.chrome = {
    bookmarks: { getTree: async () => [root] },
    storage: { local: {
      get: async key => ({ [key]: structuredClone(store[key]) }),
      set: async patch => Object.assign(store, structuredClone(patch))
    } }
  };
  let sha = "v1";
  const remote = { version: 1, roots: [{ key: "bookmark_bar", title: "Bookmarks", children: [] }] };
  let writes = 0;
  let rejectWrite = false;
  const oldRead = GitHubProvider.prototype.getRemoteFile;
  const oldWrite = GitHubProvider.prototype.updateRemoteFile;
  GitHubProvider.prototype.getRemoteFile = async () => ({ exists: true, sha, contentText: JSON.stringify(remote) });
  GitHubProvider.prototype.updateRemoteFile = async (_text, expectedSha) => {
    writes++;
    assert.equal(expectedSha, sha);
    assert.ok(store.lastMergeBackup);
    if (rejectWrite) throw new Error("409 sha does not match");
    return { fileSha: "v2", commitSha: "commit2" };
  };
  try {
    const preview = await getMergePreview("github");
    const args = { provider: "github", expected: preview, snapshot: remote };
    sha = "changed";
    await assert.rejects(submitMerge(args), /已变化/);
    assert.equal(writes, 0);
    sha = "v1";
    root.children[0].children.push({ id: "4", title: "new", url: "https://example.com" });
    await assert.rejects(submitMerge(args), /已变化/);
    root.children[0].children = [];
    await assert.rejects(submitMerge({ ...args, snapshot: { roots: [] } }), /不能为空/);
    assert.equal(writes, 0);
    rejectWrite = true;
    await assert.rejects(submitMerge(args), /409/);
    assert.equal(writes, 1);
    rejectWrite = false;
    await submitMerge(args);
    assert.equal(writes, 2);
    assert.equal(store.lastSync.merged, true);
    assert.equal(store.syncState, undefined);
    assert.deepEqual(root.children[0].children, []);
  } finally {
    GitHubProvider.prototype.getRemoteFile = oldRead;
    GitHubProvider.prototype.updateRemoteFile = oldWrite;
  }
});
