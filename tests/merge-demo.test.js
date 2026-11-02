import assert from "node:assert/strict";
import test from "node:test";
import { createMergeSession } from "../src/ui/merge/demo.js";
import { countSnapshotBookmarks } from "../src/core/snapshot/count.js";

test("demo load and submit never use real extension messaging", async () => {
  const session = createMergeSession({ demo: true, provider: "github", send: () => { throw new Error("Real request forbidden"); } });
  const preview = await session.load();
  assert.equal(countSnapshotBookmarks(preview.local), 2);
  assert.equal(countSnapshotBookmarks(preview.remote), 2);
  const merged = session.example();
  const result = await session.submit(merged, preview);
  assert.equal(countSnapshotBookmarks(result.snapshot), 3);
  result.snapshot.roots[0].children.length = 0;
  assert.equal(countSnapshotBookmarks(merged), 3);
  assert.equal(countSnapshotBookmarks((await session.load()).local), 2);
});

test("demo rejects stale versions and invalid snapshots", async () => {
  const session = createMergeSession({ demo: true });
  const old = await session.load();
  const draft = session.example();
  session.changeRemote();
  await assert.rejects(session.submit(draft, old), /旧版本提交被阻止/);
  const latest = await session.load();
  await session.submit(draft, latest);
  await assert.rejects(session.submit({ roots: [] }, latest), /不能为空/);
  assert.equal(countSnapshotBookmarks(draft), 3);
});

test("demo sessions are isolated and fresh sessions reset data", async () => {
  const first = createMergeSession({ demo: true });
  first.changeRemote();
  const second = createMergeSession({ demo: true });
  assert.equal((await second.load()).revision, 1);
  const preview = await second.load();
  preview.remote.roots[0].children.length = 0;
  assert.equal(countSnapshotBookmarks((await second.load()).remote), 2);
});

test("non-demo session still delegates to real merge handlers", async () => {
  const calls = [];
  const session = createMergeSession({ demo: false, provider: "gitee", send: async (...args) => { calls.push(args); } });
  await session.load();
  await session.submit({ roots: [] }, { scope: "scope", localHash: "local", remoteSha: "sha", remoteHash: "remote" });
  assert.equal(calls[0][0], "getMergePreview");
  assert.equal(calls[1][0], "submitMerge");
  assert.equal(calls[1][1].provider, "gitee");
});

test("pull session passes local merge direction", async () => {
  let payload;
  const session = createMergeSession({ demo: false, provider: "github", direction: "pull", send: async (_action, args) => { payload = args; } });
  await session.submit({ roots: [] }, { scope: "scope" });
  assert.equal(payload.direction, "pull");
});

test("pull demo applies only to its in-memory local snapshot and resets independently", async () => {
  const session = createMergeSession({ demo: true, direction: "pull", send: () => { throw new Error("Real request forbidden"); } });
  const before = await session.load();
  const merged = session.example();
  const result = await session.submit(merged, before);
  const after = await session.load();
  assert.deepEqual(after.local, merged);
  assert.deepEqual(after.remote, before.remote);
  assert.equal(countSnapshotBookmarks(after.local), 3);
  merged.roots[0].children.length = 0;
  result.snapshot.roots[0].children.length = 0;
  after.local.roots[0].children.length = 0;
  assert.equal(countSnapshotBookmarks((await session.load()).local), 3);
  await assert.rejects(session.submit(session.example(), before), /旧版本提交被阻止/);
  const reset = createMergeSession({ demo: true, direction: "pull" });
  assert.equal(countSnapshotBookmarks((await reset.load()).local), 2);
});

test("pull demo refuses stale local or remote revisions without applying the draft", async () => {
  for (const change of ["changeLocal", "changeRemote"]) {
    const session = createMergeSession({ demo: true, direction: "pull" });
    const preview = await session.load();
    session[change]();
    const changed = await session.load();
    await assert.rejects(session.submit(session.example(), preview), /旧版本提交被阻止/);
    assert.deepEqual(await session.load(), changed);
    await session.submit(session.example(), changed);
    assert.equal(countSnapshotBookmarks((await session.load()).local), 3);
    assert.deepEqual((await session.load()).remote, changed.remote);
  }
});
