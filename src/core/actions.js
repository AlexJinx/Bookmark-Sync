// 消息协议常量：值与旧版 magic string 完全一致，保证零 wire 变更。
export const Actions = Object.freeze({
  GET_CONFIG: "getConfig",
  SAVE_CONFIG: "saveConfig",
  GET_LAST_SYNC: "getLastSync",
  TEST_CONNECTION: "testConnection",
  EXPORT_LOCAL: "exportLocal",
  IMPORT_LOCAL: "importLocal",
  GET_BOOKMARK_COUNTS: "getBookmarkCounts",
  PUSH_TO_REMOTE: "pushToRemote",
  PULL_FROM_REMOTE: "pullFromRemote",
  CLEAR_LOCAL_BOOKMARKS: "clearLocalBookmarks",
  RESTORE_CLEAR_BACKUP: "restoreClearBackup",
  GET_SYNC_UI_STATE: "getSyncUiState"
});

export const ErrorCodes = Object.freeze({
  SYNC_CONFLICT: "SYNC_CONFLICT"
});

// 远端书签计数的状态码：UI 依据码渲染，不再对中文消息做子串匹配。
export const RemoteStatus = Object.freeze({
  OK: "ok",
  NOT_CONFIGURED: "not_configured",
  NO_SNAPSHOT: "no_snapshot",
  ERROR: "error"
});
