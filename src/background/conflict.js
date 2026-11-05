import { ErrorCodes } from "../core/actions.js";
import { buildDiffSummary } from "../core/snapshot/diff.js";
import { hasRemoteChanged, hasLocalChanged } from "./sync-state.js";
import { createMergePlan } from "../core/snapshot/merge-plan.js";

function mergeFromBase(operation, syncState, localSnapshot, remoteSnapshot) {
  const plan = createMergePlan(localSnapshot, remoteSnapshot, syncState.baseSnapshot, syncState.pendingMerge);
  if (plan.conflicts.length) {
    throwConflict(`有 ${plan.conflicts.length} 项书签变更需要确认，其余可确定的变更已自动合并。`,
      withPreview({ operation, type: "merge_required", conflictCount: plan.conflicts.length }, localSnapshot, remoteSnapshot));
  }
  return plan.build();
}

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

export function ensurePushNoConflict({ syncState, remote, localHash, remoteHash, localSnapshot, remoteSnapshot }) {
  if (remote.exists && remoteHash === localHash) {
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

  if ((syncState?.baseSnapshot || syncState?.pendingMerge) && localSnapshot && remoteSnapshot) {
    return mergeFromBase("push", syncState, localSnapshot, remoteSnapshot);
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

export function ensurePullNoConflict({ syncState, remote, localHash, remoteHash, localSnapshot, remoteSnapshot }) {
  if (localHash === remoteHash) {
    return;
  }

  if ((syncState?.baseSnapshot || syncState?.pendingMerge) && localSnapshot && remoteSnapshot) {
    return mergeFromBase("pull", syncState, localSnapshot, remoteSnapshot);
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
export function isRemoteShaConflictError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message.includes("409")) {
    return false;
  }
  return message.includes("does not match") || message.includes("sha");
}
