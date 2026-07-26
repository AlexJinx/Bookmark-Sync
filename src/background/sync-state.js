import { getProviderMeta } from "../providers/registry.js";

// scope 字符串是 syncState.scopes 的键，格式冻结（见 registry.js 注释）。
export function getSyncScope(config) {
  const meta = getProviderMeta(config.provider);
  return meta.scopeOf(config[config.provider] || {});
}

export function normalizeSyncStateStore(syncState) {
  if (!syncState || typeof syncState !== "object") {
    return { scopes: {} };
  }

  // 兼容早期单 scope 结构 {scope, remoteSha, localHash, ...}
  if (typeof syncState.scope === "string") {
    return {
      scopes: {
        [syncState.scope]: syncState
      }
    };
  }

  if (!syncState.scopes || typeof syncState.scopes !== "object") {
    return { scopes: {} };
  }

  return {
    scopes: { ...syncState.scopes }
  };
}

export function getScopedSyncState(config, syncStateStore) {
  const scope = getSyncScope(config);
  return syncStateStore.scopes[scope] || null;
}

export function setScopedSyncState(syncStateStore, nextSyncState) {
  if (!nextSyncState?.scope) {
    return syncStateStore;
  }

  return {
    scopes: {
      ...(syncStateStore?.scopes || {}),
      [nextSyncState.scope]: nextSyncState
    }
  };
}

export function makeSyncState(config, remoteSha, localHash) {
  return {
    scope: getSyncScope(config),
    remoteSha: remoteSha || null,
    localHash,
    updatedAt: new Date().toISOString()
  };
}

export function hasRemoteChanged(syncState, remoteSha) {
  const base = syncState?.remoteSha || null;
  const current = remoteSha || null;
  return base !== current;
}

export function hasLocalChanged(syncState, localHash) {
  if (!syncState) {
    return true;
  }
  return syncState.localHash !== localHash;
}
