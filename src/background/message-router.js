import { Actions } from "../core/actions.js";
import { getConfig, saveConfig, getLastSync, getClearBackup, saveClearBackup } from "../core/storage.js";
import { exportSnapshot, importSnapshot, clearAllBookmarks } from "../core/bookmarks/service.js";
import { countSnapshotBookmarks } from "../core/snapshot/count.js";
import { createProviderClient } from "../providers/registry.js";
import { pushToRemote, pullFromRemote, getBookmarkCounts } from "./sync-engine.js";
import { scheduleAutoSync } from "./scheduler.js";
import { acknowledgeBadge, clearPendingBadge, BadgeState } from "./badge.js";
import { hasPendingChangePush } from "./triggers.js";
import { emit, Events } from "./events.js";

const handlers = {
  [Actions.GET_CONFIG]: () => getConfig(),

  [Actions.SAVE_CONFIG]: async (message) => {
    const saved = await saveConfig(message.config || {});
    await scheduleAutoSync(saved);
    return saved;
  },

  [Actions.GET_LAST_SYNC]: () => getLastSync(),

  [Actions.TEST_CONNECTION]: async (message) => {
    const config = message?.config || (await getConfig());
    const client = createProviderClient(config);
    return client.testConnection();
  },

  [Actions.EXPORT_LOCAL]: () => exportSnapshot(),

  [Actions.IMPORT_LOCAL]: (message) => importSnapshot(message.snapshot),

  [Actions.GET_BOOKMARK_COUNTS]: () => getBookmarkCounts(),

  [Actions.PUSH_TO_REMOTE]: async (message) => {
    const result = await pushToRemote({
      force: Boolean(message.force),
      provider: typeof message.provider === "string" ? message.provider : "",
      syncAllProviders: typeof message.syncAllProviders === "boolean" ? message.syncAllProviders : null
    });
    await emit(Events.MANUAL_SYNC_SUCCESS, { direction: "push", result });
    return result;
  },

  [Actions.PULL_FROM_REMOTE]: async (message) => {
    const result = await pullFromRemote({
      force: Boolean(message.force),
      provider: typeof message.provider === "string" ? message.provider : ""
    });
    await emit(Events.MANUAL_SYNC_SUCCESS, { direction: "pull", result });
    return result;
  },

  [Actions.CLEAR_LOCAL_BOOKMARKS]: async () => {
    let clearedBookmarks = 0;
    const { clearedAt } = await clearAllBookmarks({
      onBackupReady: async (snapshot) => {
        clearedBookmarks = countSnapshotBookmarks(snapshot);
        await saveClearBackup({ at: new Date().toISOString(), snapshot });
      }
    });
    return { clearedAt, clearedBookmarks };
  },

  [Actions.RESTORE_CLEAR_BACKUP]: async () => {
    const backup = await getClearBackup();
    if (!backup?.snapshot) {
      throw new Error("没有可恢复的清空备份");
    }
    const result = await importSnapshot(backup.snapshot);
    return { ...result, backupAt: backup.at };
  },

  [Actions.GET_SYNC_UI_STATE]: async () => {
    const [badgeState, pendingChangePush, lastSync] = await Promise.all([
      acknowledgeBadge(),
      hasPendingChangePush(),
      getLastSync()
    ]);
    if (badgeState === BadgeState.PENDING && !pendingChangePush) {
      // 没有待推任务的 PENDING 徽章（如启动时"云端有更新"提醒）：
      // 打开弹窗即视为已知晓，否则不拉取的用户会永远挂着"…"。
      await clearPendingBadge();
    }
    return { badgeState, pendingChangePush, lastSync };
  }
};

export async function handleMessage(message) {
  const handler = handlers[message?.action];
  if (!handler) {
    throw new Error("未知 action");
  }
  return handler(message);
}
