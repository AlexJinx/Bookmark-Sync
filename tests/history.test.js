import assert from "node:assert/strict";
import test from "node:test";
import { GitHubProvider } from "../src/providers/github.js";
import { GiteeProvider } from "../src/providers/gitee.js";
import { getCommitHistory, getCommitDetail } from "../src/background/history.js";
import { buildHistoryDiff } from "../src/core/snapshot/history-diff.js";
import { toBase64 } from "../src/core/encoding.js";

const bookmark = (title, url) => ({ type: "bookmark", title, url });
const snapshot = children => ({ version: 1, roots: [{ key: "bookmark_bar", title: "收藏夹", children }] });
const scoped = { token: "test", owner: "owner", repo: "repo", branch: "feature/test", path: "book marks/snapshot.json" };

test("history diff handles duplicates, metadata, unique renames and URL changes", () => {
  const a = bookmark("A", "https://a.example"), b = bookmark("B", "https://b.example");
  const changes = buildHistoryDiff(snapshot([a, a, b]), snapshot([a, bookmark("C", b.url)]));
  assert.equal(changes.removed.total, 1);
  assert.equal(changes.changed.total, 1);
  assert.equal(changes.changed.items[0].previousTitle, "B");
  assert.equal(buildHistoryDiff(snapshot([a]), snapshot([bookmark("A", "https://new.example")])).changed.total, 1);
  const renamedRoot = snapshot([a]); renamedRoot.roots[0].title = "Bookmarks";
  assert.equal(buildHistoryDiff(snapshot([a]), renamedRoot).changed.total, 0);
  const added = buildHistoryDiff(null, snapshot([a, b]), 1).added;
  assert.equal(added.total, 2); assert.equal(added.items.length, 1); assert.equal(added.truncated, true);
});

for (const [provider, Provider] of [["github", GitHubProvider], ["gitee", GiteeProvider]]) {
  test(`${provider}: pagination detects full final pages and forwards offsets`, async () => {
    const original = Provider.prototype.request;
    let total = 100;
    globalThis.chrome = { storage: { local: { get: async () => ({ syncConfig: { provider, [provider]: scoped } }) } } };
    Provider.prototype.request = async url => {
      const params = new URL(url).searchParams;
      const size = Number(params.get("per_page"));
      const start = (Number(params.get("page")) - 1) * size;
      return new Response(JSON.stringify(Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ sha: String(start + i), commit: {} }))));
    };
    try {
      const first = await getCommitHistory({ provider, limit: 50, page: 1 });
      assert.equal(first.hasNext, true);
      const last = await getCommitHistory({ provider, limit: 50, page: 2 });
      assert.equal(last.commits[0].sha, "50");
      assert.equal(last.commits.length, 50);
      assert.equal(last.hasNext, false);
      total = 51;
      assert.equal((await getCommitHistory({ provider, limit: 50, page: 2 })).commits.length, 1);
      total = 0;
      assert.equal((await getCommitHistory({ provider, limit: 50 })).hasNext, false);
    } finally { Provider.prototype.request = original; }
  });
  test(`${provider}: lists path-filtered commits and compares exact parent versions`, async () => {
    const original = Provider.prototype.request;
    const requests = [];
    const sha = "a".repeat(40), parent = "b".repeat(40);
    let mode = "normal";
    globalThis.chrome = { storage: { local: { get: async () => ({ syncConfig: { provider, [provider]: scoped } }) } } };
    Provider.prototype.request = async url => {
      const u = new URL(url); requests.push(u);
      const commit = { sha, commit: { message: "sync", author: { name: "Author", date: "2026-01-01" } }, parents: mode === "first" ? [] : [{ sha: parent }], files: [{ filename: scoped.path }] };
      if (u.pathname.endsWith("/commits")) return new Response(JSON.stringify([commit]));
      if (u.pathname.endsWith(`/commits/${sha}`)) return new Response(JSON.stringify(commit));
      if (mode === "invalid") return new Response(JSON.stringify({ content: toBase64("not json") }));
      if (mode === "deleted" && u.searchParams.get("ref") === sha) return new Response("{}", { status: 404 });
      const children = u.searchParams.get("ref") === sha ? [bookmark("A", "https://a.example")] : [];
      return new Response(JSON.stringify({ sha: "file", content: toBase64(JSON.stringify(snapshot(children))) }));
    };
    try {
      const history = await getCommitHistory({ provider });
      assert.equal(history.commits[0].authorName, "Author");
      assert.equal(requests[0].searchParams.get("sha"), scoped.branch);
      assert.equal(requests[0].searchParams.get("path"), scoped.path);
      const detail = await getCommitDetail({ provider, sha });
      assert.equal(detail.changes.added.total, 1);
      assert.deepEqual(requests.filter(u => u.pathname.includes("/contents/")).map(u => u.searchParams.get("ref")), [parent, sha]);
      mode = "first";
      assert.equal((await getCommitDetail({ provider, sha })).changes.added.total, 1);
      mode = "invalid";
      assert.equal((await getCommitDetail({ provider, sha })).changes.hasComparison, false);
      mode = "deleted";
      assert.equal((await getCommitDetail({ provider, sha })).changes.hasComparison, true);
    } finally { Provider.prototype.request = original; }
  });
}
