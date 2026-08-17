import assert from "node:assert/strict";
import test from "node:test";

globalThis.chrome = {
  runtime: {
    lastError: null,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} }
  },
  alarms: {
    onAlarm: { addListener() {} },
    clear(_name, callback) {
      callback();
    },
    create() {}
  }
};

const { ensurePullNoConflict, ensurePushNoConflict } = await import("../src/background/conflict.js");

test("远端 SHA 变化但内容已与本地一致时推送不误报冲突", () => {
  assert.doesNotThrow(() =>
    ensurePushNoConflict({
      force: false,
      syncState: { remoteSha: "old-sha", localHash: "old-hash" },
      remote: { exists: true, sha: "new-sha" },
      localHash: "same-hash",
      remoteHash: "same-hash",
      localSnapshot: null,
      remoteSnapshot: null
    })
  );
});

test("同步基线过期但本地与远端内容一致时拉取不误报冲突", () => {
  assert.doesNotThrow(() =>
    ensurePullNoConflict({
      force: false,
      syncState: { remoteSha: "same-sha", localHash: "old-hash" },
      remote: { exists: true, sha: "same-sha" },
      localHash: "same-hash",
      remoteHash: "same-hash",
      localSnapshot: null,
      remoteSnapshot: null
    })
  );
});

test("本地和远端内容确实同时变化时仍然阻止拉取", () => {
  assert.throws(
    () =>
      ensurePullNoConflict({
        force: false,
        syncState: { remoteSha: "old-sha", localHash: "old-hash" },
        remote: { exists: true, sha: "new-sha" },
        localHash: "new-local-hash",
        remoteHash: "new-remote-hash",
        localSnapshot: null,
        remoteSnapshot: null
      }),
    (error) => error?.code === "SYNC_CONFLICT" && error?.details?.type === "both_changed"
  );
});
