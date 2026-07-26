import { ErrorCodes } from "../core/actions.js";
import { buildDiffSummary } from "../core/snapshot/diff.js";
import { hasRemoteChanged, hasLocalChanged } from "./sync-state.js";

export class SyncConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SyncConflictError";
    this.code = ErrorCodes.SYNC_CONFLICT;
    this.details = {
      summary: message,
      ...details
    };
  }
}

export function isConflictError(error) {
  return error?.code === ErrorCodes.SYNC_CONFLICT;
}

function throwConflict(message, details) {
  throw new SyncConflictError(message, details);
}

export function withPreview(details, localSnapshot, remoteSnapshot) {
  if (!localSnapshot || !remoteSnapshot) {
    return details;
  }
  return {
    ...details,
    preview: buildDiffSummary(localSnapshot, remoteSnapshot)
  };
}

export function ensurePushNoConflict({ force, syncState, remote, localHash, remoteHash, localSnapshot, remoteSnapshot }) {
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

export function ensurePullNoConflict({ force, syncState, remote, localHash, remoteHash, localSnapshot, remoteSnapshot }) {
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

export function throwConflictError(message, details) {
  throwConflict(message, details);
}

// Contents API 在 sha 过期时返回 409（真正的 compare-and-swap）。
// Gist 的 PATCH 无此机制，此判定对 gist 永远为 false —— 属预期行为。
export function isRemoteShaConflictError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message.includes("409")) {
    return false;
  }
  return message.includes("does not match") || message.includes("sha");
}
