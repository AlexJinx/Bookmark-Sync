import { exportSnapshot, importSnapshot, validateSnapshot } from "../core/bookmarks/service.js";
import { createProviderClient, PROVIDER_IDS } from "../providers/registry.js";
import { getConfig, saveLastSync, getSyncState, saveSyncState } from "../core/storage.js";
import { isProviderConfigured, getConfiguredProviders } from "../core/config.js";
import { hashSnapshot, parseSnapshotText } from "../core/snapshot/hash.js";
import { countSnapshotBookmarks } from "../core/snapshot/count.js";
import { RemoteStatus } from "../core/actions.js";
import {
  ensurePushNoConflict,
  ensurePullNoConflict,
  isRemoteShaConflictError,
  throwConflictError,
  withPreview
} from "./conflict.js";
import {
  normalizeSyncStateStore,
  getScopedSyncState,
  setScopedSyncState,
  makeSyncState
} from "./sync-state.js";
import { getSyncScope } from "./sync-state.js";
import { isConflictError } from "./conflict.js";
import { createSerialOperationQueue } from "../operation-queue.js";
import { summarizeExactDuplicateFolders } from "../snapshot-inspector.js";

// ---- 同步进行中护栏（供变更触发器跳过窗口内的自动推送） ----
// 计数器而非布尔：手动推送与定时推送可能重叠，先结束的一方不能把
// 护栏误置为"空闲"（布尔实现会让第三个同步趁隙挤进来）。
let syncRunningDepth = 0;
const syncOperations = createSerialOperationQueue();

export async function getMergePreview(provider) {
  return syncOperations.run("mergePreview", async () => {
    const config = withProvider(await getConfig(), provider);
    assertKnownConfiguredProvider(config, provider);
    const local = await getLocalSnapshotAndHash();
    const remote = await createProviderClient(config).getRemoteFile();
    const remoteSnapshot = remote.exists ? parseSnapshotText(remote.contentText || "") : null;
    return {
      provider, scope: getSyncScope(config), local: local.snapshot, remote: remoteSnapshot,
      localHash: local.localHash, remoteSha: remote.sha || null,
      remoteHash: remoteSnapshot ? await hashSnapshot(remoteSnapshot) : null
    };
  });
}

export async function submitMerge({ provider, expected, snapshot, direction = "push" }) {
  return syncOperations.run("submitMerge", () => withSyncRun(async () => {
    if (!["push", "pull"].includes(direction)) throw new Error("未知合并方向");
    const config = withProvider(await getConfig(), provider);
    assertKnownConfiguredProvider(config, provider);
    validateSnapshot(snapshot);
    ensureNoExactDuplicateFolders({ snapshot, operation: direction, side: direction === "pull" ? "local" : "remote" });
    const local = await getLocalSnapshotAndHash();
    const client = createProviderClient(config);
    const remote = await client.getRemoteFile();
    const remoteSnapshot = remote.exists ? parseSnapshotText(remote.contentText || "") : null;
    const remoteHash = remoteSnapshot ? await hashSnapshot(remoteSnapshot) : null;
    if (!expected || getSyncScope(config) !== expected.scope || local.localHash !== expected.localHash ||
        (remote.sha || null) !== expected.remoteSha || remoteHash !== expected.remoteHash) {
      throw new Error("本地、云端或仓库配置已变化。你的草稿仍保留，请重新载入两侧数据后再次合并。");
    }
    await chrome.storage.local.set({ lastMergeBackup: {
      at: new Date().toISOString(), provider, direction, scope: expected.scope,
      local: local.snapshot, remote: remoteSnapshot
    } });
    if (direction === "pull") {
      await importSnapshot(snapshot, { expectedLocalHash: expected.localHash });
      // Only equal snapshots are a shared baseline. Other choices remain unsynced.
      const mergedHash = await hashSnapshot(snapshot);
      if (remote.exists && mergedHash === remoteHash) {
        const state = normalizeSyncStateStore(await getSyncState());
        await saveSyncState(setScopedSyncState(state, makeSyncState(config, remote.sha, mergedHash)));
      }
      const lastSync = { at: new Date().toISOString(), direction, provider, merged: true, fileSha: remote.sha };
      await saveLastSync(lastSync);
      return lastSync;
    }
    // Never retry with a newer SHA: that would overwrite changes not reviewed by the user.
    const result = await client.updateRemoteFile(JSON.stringify(snapshot, null, 2), remote.sha);
    const lastSync = { at: new Date().toISOString(), direction: "push", provider, merged: true,
      fileSha: result.fileSha, commitSha: result.commitSha };
    await saveLastSync(lastSync);
    // Local bookmarks remain unchanged, so do not mark the merged snapshot as a shared baseline.
    return lastSync;
  }));
}

export function isSyncRunning() {
  return syncRunningDepth > 0;
}

async function withSyncRun(fn) {
  syncRunningDepth += 1;
  try {
    return await fn();
  } finally {
    syncRunningDepth -= 1;
  }
}

// ---- 工具 ----

function withProvider(config, provider) {
  return {
    ...config,
    provider
  };
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

function assertKnownConfiguredProvider(config, provider) {
  if (!PROVIDER_IDS.includes(provider)) {
    throw new Error(`未知 provider: ${provider}`);
  }
  if (!isProviderConfigured(config, provider)) {
    throw new Error(`平台未完成配置: ${provider}`);
  }
}

function ensureNoExactDuplicateFolders({ snapshot, operation, side }) {
  const duplicates = summarizeExactDuplicateFolders(snapshot);
  if (duplicates.extraFolders === 0) {
    return;
  }
  const location = side === "remote" ? "远端快照" : "本地书签";
  throwConflictError(`${location}包含 ${duplicates.extraFolders} 个完全重复目录，已阻止覆盖操作。`, {
    operation,
    type: `${side}_duplicate_folders`,
    duplicates
  });
}

// ---- 推送 ----

function buildPushResult(config, { fileSha, commitSha = "", localHash, noop = false }) {
  return {
    lastSync: {
      at: new Date().toISOString(),
      direction: "push",
      provider: config.provider,
      fileSha,
      commitSha,
      noop: Boolean(noop)
    },
    nextSyncState: makeSyncState(config, fileSha, localHash)
  };
}

async function pushToRemoteForConfig(config, { local, syncStateStore } = {}) {
  const client = createProviderClient(config);
  const localSnapshot = local || (await getLocalSnapshotAndHash());
  const scopedStateStore = syncStateStore || normalizeSyncStateStore(await getSyncState());
  const syncState = getScopedSyncState(config, scopedStateStore);

  const remote = await client.getRemoteFile();
  let remoteHash = null;
  let remoteSnapshot = null;
  if (remote.exists) {
    remoteSnapshot = parseSnapshotText(remote.contentText || "");
    remoteHash = await hashSnapshot(remoteSnapshot);
  }

  ensurePushNoConflict({
    syncState,
    remote,
    localHash: localSnapshot.localHash,
    remoteHash,
    localSnapshot: localSnapshot.snapshot,
    remoteSnapshot
  });

  if (remote.exists && remoteHash === localSnapshot.localHash) {
    return buildPushResult(config, {
      fileSha: remote.sha,
      localHash: localSnapshot.localHash,
      noop: true
    });
  }

  const payload = JSON.stringify(localSnapshot.snapshot, null, 2);
  const finalizePushResult = (result) => {
    return buildPushResult(config, {
      fileSha: result.fileSha,
      commitSha: result.commitSha,
      localHash: localSnapshot.localHash
    });
  };

  try {
    const result = await client.updateRemoteFile(payload, remote.sha);
    return await finalizePushResult(result);
  } catch (error) {
    if (!isRemoteShaConflictError(error)) {
      throw error;
    }

    // Contents API 提交竞态：远端在 GET 与 PUT 之间被更新（409）。
    const latestRemote = await client.getRemoteFile();
    if (!latestRemote.exists) {
      throwConflictError("检测到冲突：远端文件在推送过程中被删除。", {
        operation: "push",
        type: "remote_deleted_during_update"
      });
    }

    const latestRemoteSnapshot = parseSnapshotText(latestRemote.contentText || "");
    throwConflictError(
        "检测到冲突：远端在推送提交时已更新，请先解决冲突再推送。",
        withPreview(
          {
            operation: "push",
            type: "remote_changed"
          },
          localSnapshot.snapshot,
          latestRemoteSnapshot
        )
      );
  }
}

function buildMultiProviderLastSync(results) {
  const providers = results.map((item) => item.lastSync.provider);
  return {
    at: new Date().toISOString(),
    direction: "push",
    provider: providers.join(","),
    providers,
    noop: results.every((item) => Boolean(item.lastSync.noop)),
    syncAllProviders: true,
    items: results.map((item) => item.lastSync)
  };
}

export async function pushToRemote({ provider = "", syncAllProviders = null } = {}) {
  return syncOperations.run("pushToRemote", () => withSyncRun(async () => {
    const config = await getConfig();
    const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
    ensureNoExactDuplicateFolders({ snapshot: local.snapshot, operation: "push", side: "local" });
    const syncStateStore = normalizeSyncStateStore(rawSyncState);
    const selectedProvider = typeof provider === "string" ? provider.trim() : "";
    const hasSyncAllOverride = typeof syncAllProviders === "boolean";
    const shouldSyncAllProviders = hasSyncAllOverride ? syncAllProviders : Boolean(config.syncAllProviders);

    if (selectedProvider) {
      assertKnownConfiguredProvider(config, selectedProvider);

      const result = await pushToRemoteForConfig(withProvider(config, selectedProvider), { local, syncStateStore });
      const nextSyncStateStore = setScopedSyncState(syncStateStore, result.nextSyncState);
      await saveSyncState(nextSyncStateStore);
      await saveLastSync(result.lastSync);
      return result.lastSync;
    }

    if (!shouldSyncAllProviders) {
      const result = await pushToRemoteForConfig(config, { local, syncStateStore });
      const nextSyncStateStore = setScopedSyncState(syncStateStore, result.nextSyncState);
      await saveSyncState(nextSyncStateStore);
      await saveLastSync(result.lastSync);
      return result.lastSync;
    }

    const providers = getConfiguredProviders(config);
    if (providers.length === 0) {
      throw new Error("未找到已配置的平台，请先在设置中完善至少一个平台配置");
    }

    const settled = await Promise.allSettled(
      providers.map((item) => pushToRemoteForConfig(withProvider(config, item), { local, syncStateStore }))
    );

    const results = [];
    const failures = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        failures.push({ provider: providers[index], error: outcome.reason });
      }
    });

    // 部分失败时也必须先落盘已成功平台的基线：它们的远端提交已经发生，
    // 不落盘的话下次推送会把自己的提交误判为"远端已更新"冲突。
    let nextSyncStateStore = syncStateStore;
    for (const result of results) {
      nextSyncStateStore = setScopedSyncState(nextSyncStateStore, result.nextSyncState);
    }
    if (results.length > 0) {
      await saveSyncState(nextSyncStateStore);
    }

    if (failures.length > 0) {
      // 优先抛冲突错误，让弹窗打开对应平台的合并页。
      if (results.length > 0) {
        await saveLastSync({
          at: new Date().toISOString(),
          direction: "push",
          provider: results.map((item) => item.lastSync.provider).join(","),
          providers: results.map((item) => item.lastSync.provider),
          partial: true,
          syncAllProviders: true,
          items: results.map((item) => item.lastSync),
          failures: failures.map((item) => ({ provider: item.provider, message: item.error?.message || String(item.error) }))
        });
      }
      const conflictFailure = failures.find((item) => isConflictError(item.error));
      if (conflictFailure) {
        conflictFailure.error.details = { ...conflictFailure.error.details, provider: conflictFailure.provider };
        throw conflictFailure.error;
      }
      const succeeded = results.map((item) => item.lastSync.provider);
      const successText = succeeded.length > 0 ? `已成功：${succeeded.join("、")}；` : "";
      const failureText = failures.map((item) => `${item.provider}: ${item.error?.message || String(item.error)}`).join("；");
      const error = new Error(`多平台推送未全部完成。${successText}失败：${failureText}`);
      error.code = "PARTIAL_PUSH";
      error.details = { succeeded, failures: failures.map((item) => ({ provider: item.provider, message: item.error?.message || String(item.error) })) };
      throw error;
    }

    const lastSync = buildMultiProviderLastSync(results);
    await saveLastSync(lastSync);
    return lastSync;
  }));
}

// ---- 拉取 ----

export async function pullFromRemote({ provider = "" } = {}) {
  return syncOperations.run("pullFromRemote", () => withSyncRun(async () => {
    const config = await getConfig();
    const selectedProvider = typeof provider === "string" ? provider.trim() : "";
    let workingConfig = config;

    if (selectedProvider) {
      assertKnownConfiguredProvider(config, selectedProvider);
      workingConfig = withProvider(config, selectedProvider);
    }

    const client = createProviderClient(workingConfig);

    const remote = await client.getRemoteFile();
    const { snapshot: remoteSnapshot, remoteHash } = await getRemoteSnapshotAndHash(remote);
    ensureNoExactDuplicateFolders({ snapshot: remoteSnapshot, operation: "pull", side: "remote" });

    const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
    const syncStateStore = normalizeSyncStateStore(rawSyncState);
    const syncState = getScopedSyncState(workingConfig, syncStateStore);

    ensurePullNoConflict({
      syncState,
      remote,
      localHash: local.localHash,
      remoteHash,
      localSnapshot: local.snapshot,
      remoteSnapshot
    });

    if (remoteHash !== local.localHash) {
      await importSnapshot(remoteSnapshot, { expectedLocalHash: local.localHash });
    }

    const nextSyncState = makeSyncState(workingConfig, remote.sha, remoteHash);
    await saveSyncState(setScopedSyncState(syncStateStore, nextSyncState));

    const lastSync = {
      at: new Date().toISOString(),
      direction: "pull",
      provider: workingConfig.provider,
      fileSha: remote.sha,
      noop: remoteHash === local.localHash
    };
    await saveLastSync(lastSync);

    return lastSync;
  }));
}

// ---- 计数 ----

async function getRemoteBookmarkCount(config, provider) {
  if (!PROVIDER_IDS.includes(provider)) {
    throw new Error(`未知 provider: ${provider}`);
  }

  if (!isProviderConfigured(config, provider)) {
    return {
      provider,
      configured: false,
      exists: false,
      bookmarks: null,
      status: RemoteStatus.NOT_CONFIGURED,
      message: ""
    };
  }

  try {
    const client = createProviderClient(withProvider(config, provider));
    const remoteFile = await client.getRemoteFile();

    if (!remoteFile.exists) {
      return {
        provider,
        configured: true,
        exists: false,
        bookmarks: null,
        status: RemoteStatus.NO_SNAPSHOT,
        message: ""
      };
    }

    const remoteSnapshot = parseSnapshotText(remoteFile.contentText || "");
    const duplicateFolders = summarizeExactDuplicateFolders(remoteSnapshot);
    return {
      provider,
      configured: true,
      exists: true,
      bookmarks: countSnapshotBookmarks(remoteSnapshot),
      duplicateFolders: duplicateFolders.extraFolders,
      status: RemoteStatus.OK,
      message: ""
    };
  } catch (error) {
    return {
      provider,
      configured: true,
      exists: null,
      bookmarks: null,
      status: RemoteStatus.ERROR,
      message: error.message || String(error)
    };
  }
}

export async function getBookmarkCounts() {
  const [config, localSnapshot] = await Promise.all([
    getConfig(),
    syncOperations.run("readLocalBookmarkCounts", () => exportSnapshot())
  ]);
  const localBookmarks = countSnapshotBookmarks(localSnapshot);
  const localDuplicates = summarizeExactDuplicateFolders(localSnapshot);

  const remotes = {};
  const results = await Promise.all(PROVIDER_IDS.map((provider) => getRemoteBookmarkCount(config, provider)));
  for (const item of results) {
    remotes[item.provider] = item;
  }

  return {
    localBookmarks,
    localDuplicateFolders: localDuplicates.extraFolders,
    remotes
  };
}

// ---- 启动时远端检查（仅提示，绝不自动导入） ----

export async function checkRemoteAhead() {
  const config = await getConfig();
  const providers = getConfiguredProviders(config);
  if (providers.length === 0) {
    return null;
  }

  const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
  const syncStateStore = normalizeSyncStateStore(rawSyncState);

  const ahead = [];
  for (const provider of providers) {
    try {
      const workingConfig = withProvider(config, provider);
      const syncState = getScopedSyncState(workingConfig, syncStateStore);
      if (!syncState) {
        continue;
      }

      const client = createProviderClient(workingConfig);
      const remote = await client.getRemoteFile();
      if (!remote.exists) {
        continue;
      }

      const remoteChanged = (syncState.remoteSha || null) !== (remote.sha || null);
      const localChanged = syncState.localHash !== local.localHash;
      if (remoteChanged && !localChanged) {
        ahead.push(provider);
      }
    } catch {
      // 启动网络抖动属常态，静默忽略。
    }
  }

  return ahead.length > 0 ? { providers: ahead } : null;
}
