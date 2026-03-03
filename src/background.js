import { exportSnapshot, importSnapshot } from "./bookmark-service.js";
import { createProviderClient } from "./providers.js";
import { getConfig, saveConfig, getLastSync, saveLastSync, getSyncState, saveSyncState } from "./storage.js";
import { hashSnapshot, parseSnapshotText } from "./snapshot-hash.js";
import { buildDiffSummary } from "./snapshot-diff.js";

const AUTO_SYNC_ALARM = "bookmarkAutoSync";
const CONFLICT_CODE = "SYNC_CONFLICT";

class SyncConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SyncConflictError";
    this.code = CONFLICT_CODE;
    this.details = {
      summary: message,
      ...details
    };
  }
}

function getSyncScope(config) {
  const scoped = config[config.provider] || {};
  return [config.provider, scoped.owner || "", scoped.repo || "", scoped.branch || "", scoped.path || ""].join("|");
}

function getScopedSyncState(config, syncState) {
  if (!syncState) {
    return null;
  }
  if (syncState.scope !== getSyncScope(config)) {
    return null;
  }
  return syncState;
}

function makeSyncState(config, remoteSha, localHash) {
  return {
    scope: getSyncScope(config),
    remoteSha: remoteSha || null,
    localHash,
    updatedAt: new Date().toISOString()
  };
}

function hasRemoteChanged(syncState, remoteSha) {
  const base = syncState?.remoteSha || null;
  const current = remoteSha || null;
  return base !== current;
}

function hasLocalChanged(syncState, localHash) {
  if (!syncState) {
    return true;
  }
  return syncState.localHash !== localHash;
}

function throwConflict(message, details) {
  throw new SyncConflictError(message, details);
}

function withPreview(details, localSnapshot, remoteSnapshot) {
  if (!localSnapshot || !remoteSnapshot) {
    return details;
  }
  return {
    ...details,
    preview: buildDiffSummary(localSnapshot, remoteSnapshot)
  };
}

function normalizeIntervalMinutes(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 60;
  }
  return Math.max(15, parsed);
}

async function scheduleAutoSync(config) {
  await new Promise((resolve) => chrome.alarms.clear(AUTO_SYNC_ALARM, () => resolve()));
  if (!config.autoSyncEnabled) {
    return;
  }

  const periodInMinutes = normalizeIntervalMinutes(config.autoSyncIntervalMinutes);
  chrome.alarms.create(AUTO_SYNC_ALARM, { periodInMinutes });
}

async function ensureAutoSyncSchedule() {
  const config = await getConfig();
  await scheduleAutoSync(config);
}

async function getLocalSnapshotAndHash() {
  const snapshot = await exportSnapshot();
  const localHash = await hashSnapshot(snapshot);
  return { snapshot, localHash };
}

async function getRemoteSnapshotAndHash(remote) {
  if (!remote.exists) {
    throw new Error("远端文件不存在，请先执行一次推送");
  }
  const snapshot = parseSnapshotText(remote.contentText || "");
  const remoteHash = await hashSnapshot(snapshot);
  return { snapshot, remoteHash };
}

function ensurePushNoConflict({ force, syncState, remote, localHash, remoteHash, localSnapshot, remoteSnapshot }) {
  if (force) {
    return;
  }

  if (!remote.exists) {
    if (syncState?.remoteSha) {
      const localChanged = hasLocalChanged(syncState, localHash);
      if (localChanged) {
        throwConflict("检测到冲突：远端文件已被删除且本地也有新改动。", {
          operation: "push",
          type: "remote_deleted_and_local_changed"
        });
      }
      throwConflict("检测到冲突：远端文件已被删除，已阻止自动回写。", {
        operation: "push",
        type: "remote_deleted"
      });
    }
    return;
  }

  if (!syncState) {
    if (remoteHash === localHash) {
      return;
    }
    throwConflict("检测到冲突：首次同步时本地与远端内容不同。", {
      ...withPreview(
        {
          operation: "push",
          type: "no_base_diverged"
        },
        localSnapshot,
        remoteSnapshot
      )
    });
  }

  const remoteChanged = hasRemoteChanged(syncState, remote.sha);
  if (!remoteChanged) {
    return;
  }

  const localChanged = hasLocalChanged(syncState, localHash);
  if (localChanged) {
    throwConflict("检测到冲突：本地和远端都发生了变化。", {
      ...withPreview(
        {
          operation: "push",
          type: "both_changed"
        },
        localSnapshot,
        remoteSnapshot
      )
    });
  }

  throwConflict("检测到冲突：远端已更新，请先拉取再推送。", {
    ...withPreview(
      {
        operation: "push",
        type: "remote_changed"
      },
      localSnapshot,
      remoteSnapshot
    )
  });
}

function ensurePullNoConflict({ force, syncState, remote, localHash, remoteHash, localSnapshot, remoteSnapshot }) {
  if (force) {
    return;
  }

  if (!syncState) {
    if (localHash === remoteHash) {
      return;
    }
    throwConflict("检测到冲突：首次拉取会覆盖与你当前不同的本地书签。", {
      ...withPreview(
        {
          operation: "pull",
          type: "no_base_diverged"
        },
        localSnapshot,
        remoteSnapshot
      )
    });
  }

  const remoteChanged = hasRemoteChanged(syncState, remote.sha);
  const localChanged = hasLocalChanged(syncState, localHash);

  if (remoteChanged && localChanged) {
    throwConflict("检测到冲突：本地和远端都发生了变化。", {
      ...withPreview(
        {
          operation: "pull",
          type: "both_changed"
        },
        localSnapshot,
        remoteSnapshot
      )
    });
  }

  if (!remoteChanged && localChanged) {
    throwConflict("检测到冲突：本地有未同步改动，拉取将覆盖这些改动。", {
      ...withPreview(
        {
          operation: "pull",
          type: "local_changed"
        },
        localSnapshot,
        remoteSnapshot
      )
    });
  }
}

async function pushToRemote({ force = false } = {}) {
  const config = await getConfig();
  const client = createProviderClient(config);

  const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
  const syncState = getScopedSyncState(config, rawSyncState);

  const remote = await client.getRemoteFile();
  let remoteHash = null;
  let remoteSnapshot = null;
  if (remote.exists) {
    remoteSnapshot = parseSnapshotText(remote.contentText || "");
    remoteHash = await hashSnapshot(remoteSnapshot);
  }

  ensurePushNoConflict({
    force,
    syncState,
    remote,
    localHash: local.localHash,
    remoteHash,
    localSnapshot: local.snapshot,
    remoteSnapshot
  });

  if (remote.exists && remoteHash === local.localHash) {
    const nextSyncState = makeSyncState(config, remote.sha, local.localHash);
    await saveSyncState(nextSyncState);

    const lastSync = {
      at: new Date().toISOString(),
      direction: "push",
      provider: config.provider,
      fileSha: remote.sha,
      commitSha: "",
      noop: true
    };
    await saveLastSync(lastSync);
    return lastSync;
  }

  const payload = JSON.stringify(local.snapshot, null, 2);
  const result = await client.updateRemoteFile(payload, remote.sha);

  const nextSyncState = makeSyncState(config, result.fileSha, local.localHash);
  await saveSyncState(nextSyncState);

  const lastSync = {
    at: new Date().toISOString(),
    direction: "push",
    provider: config.provider,
    fileSha: result.fileSha,
    commitSha: result.commitSha,
    force: Boolean(force)
  };
  await saveLastSync(lastSync);

  return lastSync;
}

async function pullFromRemote({ force = false } = {}) {
  const config = await getConfig();
  const client = createProviderClient(config);

  const remote = await client.getRemoteFile();
  const { snapshot: remoteSnapshot, remoteHash } = await getRemoteSnapshotAndHash(remote);

  const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
  const syncState = getScopedSyncState(config, rawSyncState);

  ensurePullNoConflict({
    force,
    syncState,
    remote,
    localHash: local.localHash,
    remoteHash,
    localSnapshot: local.snapshot,
    remoteSnapshot
  });

  if (remoteHash !== local.localHash) {
    await importSnapshot(remoteSnapshot);
  }

  const nextSyncState = makeSyncState(config, remote.sha, remoteHash);
  await saveSyncState(nextSyncState);

  const lastSync = {
    at: new Date().toISOString(),
    direction: "pull",
    provider: config.provider,
    fileSha: remote.sha,
    noop: remoteHash === local.localHash,
    force: Boolean(force)
  };
  await saveLastSync(lastSync);

  return lastSync;
}

async function handleMessage(message) {
  switch (message?.action) {
    case "getConfig":
      return getConfig();
    case "saveConfig": {
      const saved = await saveConfig(message.config || {});
      await scheduleAutoSync(saved);
      return saved;
    }
    case "getLastSync":
      return getLastSync();
    case "testConnection": {
      const config = message?.config || (await getConfig());
      const client = createProviderClient(config);
      return client.testConnection();
    }
    case "exportLocal":
      return exportSnapshot();
    case "importLocal":
      return importSnapshot(message.snapshot);
    case "pushToRemote":
      return pushToRemote({ force: Boolean(message.force) });
    case "pullFromRemote":
      return pullFromRemote({ force: Boolean(message.force) });
    default:
      throw new Error("未知 action");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await saveConfig(config);
  await scheduleAutoSync(config);
});

chrome.runtime.onStartup.addListener(() => {
  ensureAutoSyncSchedule().catch((error) => {
    console.error("auto sync schedule init failed", error);
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_SYNC_ALARM) {
    return;
  }
  try {
    await pushToRemote();
  } catch (err) {
    if (err?.code === CONFLICT_CODE) {
      console.warn("auto sync skipped due to conflict", err.details || err.message);
      return;
    }
    console.error("auto sync failed", err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: {
          message: error.message || String(error),
          code: error.code || "",
          details: error.details || null
        }
      });
    });
  return true;
});
