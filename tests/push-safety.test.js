import assert from "node:assert/strict";
import test from "node:test";
import { GitHubProvider } from "../src/providers/github.js";
import { pushToRemote } from "../src/background/sync-engine.js";

test("legacy force cannot bypass push conflicts or retry a rejected write", async () => {
  const store = { syncConfig: { provider: "github", github: { token: "test", owner: "owner", repo: "repo", branch: "main", path: "snapshot.json" } } };
  const root = { id: "0", title: "", children: [{ id: "1", title: "Bookmarks", children: [] }] };
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    bookmarks: { getTree: async () => [root] },
    storage: { local: {
      get: async key => ({ [key]: structuredClone(store[key]) }),
      set: async patch => Object.assign(store, structuredClone(patch))
    } }
  };
  const originalRead = GitHubProvider.prototype.getRemoteFile;
  const originalWrite = GitHubProvider.prototype.updateRemoteFile;
  let writes = 0;
  let remote = { exists: false, sha: null };
  let race = false;
  let deleted = false;
  GitHubProvider.prototype.getRemoteFile = async () => structuredClone(remote);
  GitHubProvider.prototype.updateRemoteFile = async text => {
    writes++;
    if (race) {
      remote = deleted ? { exists: false, sha: null } : { ...remote, sha: "changed" };
      throw new Error("409 sha does not match");
    }
    remote = { exists: true, sha: "v1", contentText: text };
    return { fileSha: "v1" };
  };
  try {
    await pushToRemote({ provider: "github" });
    const baselineRemote = structuredClone(remote);
    root.children[0].children.push({ id: "2", title: "local", url: "https://example.com" });
    remote.sha = "changed";
    await assert.rejects(pushToRemote({ provider: "github", force: true }), error => error.code === "SYNC_CONFLICT");
    assert.equal(writes, 1);
    for (const remove of [false, true]) {
      remote = structuredClone(baselineRemote);
      race = true;
      deleted = remove;
      const before = writes;
      await assert.rejects(pushToRemote({ provider: "github", force: true }), error => error.code === "SYNC_CONFLICT");
      assert.equal(writes, before + 1, "must not retry with a newer SHA or recreate a deleted file");
    }
    assert.equal(store.lastSync.force, undefined);
  } finally {
    GitHubProvider.prototype.getRemoteFile = originalRead;
    GitHubProvider.prototype.updateRemoteFile = originalWrite;
    globalThis.chrome = previousChrome;
  }
});
