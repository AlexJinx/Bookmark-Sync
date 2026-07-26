import { exportSnapshot, importSnapshot } from "../core/bookmarks/service.js";
import { createProviderClient, PROVIDER_IDS } from "../providers/registry.js";
import { getConfig, saveConfig, saveLastSync, getSyncState, saveSyncState } from "../core/storage.js";
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
import { isConflictError } from "./conflict.js";

// ---- 同步进行中护栏（供变更触发器跳过窗口内的自动推送） ----
// 计数器而非布尔：手动推送与定时推送可能重叠，先结束的一方不能把
// 护栏误置为"空闲"（布尔实现会让第三个同步趁隙挤进来）。
let syncRunningDepth = 0;

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

// Gist 首次推送会自动创建 Gist；把返回的 id 写回持久化配置，
// 并返回携带新 gistId 的工作配置（scope 计算必须用新 id）。
async function persistCreatedGistId(workingConfig, updateResult) {
  const createdGistId = updateResult?.createdGistId;
  if (!createdGistId) {
    return workingConfig;
  }

  const stored = await getConfig();
  if (!stored.gist?.gistId) {
    stored.gist.gistId = createdGistId;
    await saveConfig(stored);
  }

  return {
    ...workingConfig,
    gist: {
      ...workingConfig.gist,
      gistId: createdGistId
    }
  };
}

// ---- 推送 ----

function buildPushResult(config, { fileSha, commitSha = "", localHash, force = false, noop = false }) {
  return {
    lastSync: {
      at: new Date().toISOString(),
      direction: "push",
      provider: config.provider,
      fileSha,
      commitSha,
      noop: Boolean(noop),
      force: Boolean(force)
    },
    nextSyncState: makeSyncState(config, fileSha, localHash)
  };
}

async function pushToRemoteForConfig(config, { force = false, local, syncStateStore } = {}) {
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
    force,
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
      noop: true,
      force
    });
  }

  const payload = JSON.stringify(localSnapshot.snapshot, null, 2);
  const finalizePushResult = async (result, forceValue) => {
    const effectiveConfig = await persistCreatedGistId(config, result);
    return buildPushResult(effectiveConfig, {
      fileSha: result.fileSha,
      commitSha: result.commitSha,
      localHash: localSnapshot.localHash,
      force: forceValue
    });
  };

  try {
    const result = await client.updateRemoteFile(payload, remote.sha);
    return await finalizePushResult(result, force);
  } catch (error) {
    if (!isRemoteShaConflictError(error)) {
      throw error;
    }

    // Contents API 提交竞态：远端在 GET 与 PUT 之间被更新（409）。
    const latestRemote = await client.getRemoteFile();
    if (!latestRemote.exists) {
      if (!force) {
        throwConflictError("检测到冲突：远端文件在推送过程中被删除。", {
          operation: "push",
          type: "remote_deleted_during_update"
        });
      }

      try {
        const retryCreateResult = await client.updateRemoteFile(payload, null);
        return await finalizePushResult(retryCreateResult, true);
      } catch (retryError) {
        if (isRemoteShaConflictError(retryError)) {
          throw new Error("远端文件正在被频繁更新，强制推送失败。请先暂停其他设备同步后重试。");
        }
        throw retryError;
      }
    }

    const latestRemoteSnapshot = parseSnapshotText(latestRemote.contentText || "");
    const latestRemoteHash = await hashSnapshot(latestRemoteSnapshot);

    if (!force) {
      throwConflictError(
        "检测到冲突：远端在推送提交时已更新，请先拉取再推送。",
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

    if (latestRemoteHash === localSnapshot.localHash) {
      return buildPushResult(config, {
        fileSha: latestRemote.sha,
        localHash: localSnapshot.localHash,
        noop: true,
        force: true
      });
    }

    try {
      const retryResult = await client.updateRemoteFile(payload, latestRemote.sha);
      return await finalizePushResult(retryResult, true);
    } catch (retryError) {
      if (isRemoteShaConflictError(retryError)) {
        throw new Error("远端文件正在被频繁更新，强制推送失败。请先暂停其他设备同步后重试。");
      }
      throw retryError;
    }
  }
}

function buildMultiProviderLastSync(results, force) {
  const providers = results.map((item) => item.lastSync.provider);
  return {
    at: new Date().toISOString(),
    direction: "push",
    provider: providers.join(","),
    providers,
    noop: results.every((item) => Boolean(item.lastSync.noop)),
    force: Boolean(force),
    syncAllProviders: true,
    items: results.map((item) => item.lastSync)
  };
}

export async function pushToRemote({ force = false, provider = "", syncAllProviders = null } = {}) {
  return withSyncRun(async () => {
    const config = await getConfig();
    const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
    const syncStateStore = normalizeSyncStateStore(rawSyncState);
    const selectedProvider = typeof provider === "string" ? provider.trim() : "";
    const hasSyncAllOverride = typeof syncAllProviders === "boolean";
    const shouldSyncAllProviders = hasSyncAllOverride ? syncAllProviders : Boolean(config.syncAllProviders);

    if (selectedProvider) {
      assertKnownConfiguredProvider(config, selectedProvider);

      const result = await pushToRemoteForConfig(withProvider(config, selectedProvider), { force, local, syncStateStore });
      const nextSyncStateStore = setScopedSyncState(syncStateStore, result.nextSyncState);
      await saveSyncState(nextSyncStateStore);
      await saveLastSync(result.lastSync);
      return result.lastSync;
    }

    if (!shouldSyncAllProviders) {
      const result = await pushToRemoteForConfig(config, { force, local, syncStateStore });
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
      providers.map((item) => pushToRemoteForConfig(withProvider(config, item), { force, local, syncStateStore }))
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
      // 优先抛冲突错误，保留弹窗的冲突预览/强制重试交互；
      // 强制重试会全量重推，已成功平台因内容一致走 noop，幂等安全。
      const conflictFailure = failures.find((item) => isConflictError(item.error));
      throw (conflictFailure || failures[0]).error;
    }

    const lastSync = buildMultiProviderLastSync(results, force);
    await saveLastSync(lastSync);
    return lastSync;
  });
}

// ---- 拉取 ----

export async function pullFromRemote({ force = false, provider = "" } = {}) {
  return withSyncRun(async () => {
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

    const [local, rawSyncState] = await Promise.all([getLocalSnapshotAndHash(), getSyncState()]);
    const syncStateStore = normalizeSyncStateStore(rawSyncState);
    const syncState = getScopedSyncState(workingConfig, syncStateStore);

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

    const nextSyncState = makeSyncState(workingConfig, remote.sha, remoteHash);
    await saveSyncState(setScopedSyncState(syncStateStore, nextSyncState));

    const lastSync = {
      at: new Date().toISOString(),
      direction: "pull",
      provider: workingConfig.provider,
      fileSha: remote.sha,
      noop: remoteHash === local.localHash,
      force: Boolean(force)
    };
    await saveLastSync(lastSync);

    return lastSync;
  });
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
    return {
      provider,
      configured: true,
      exists: true,
      bookmarks: countSnapshotBookmarks(remoteSnapshot),
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
  const [config, localSnapshot] = await Promise.all([getConfig(), exportSnapshot()]);
  const localBookmarks = countSnapshotBookmarks(localSnapshot);

  const remotes = {};
  const results = await Promise.all(PROVIDER_IDS.map((provider) => getRemoteBookmarkCount(config, provider)));
  for (const item of results) {
    remotes[item.provider] = item;
  }

  return {
    localBookmarks,
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
