// Service Worker 入口。
// MV3 硬性要求：所有事件监听必须在顶层同步注册（任何 await 之后注册的监听器
// 都会在 SW 冷启动时错过事件）。处理逻辑内部可以异步。
import { getConfig, saveConfig } from "../core/storage.js";
import { getProviderLabel } from "../providers/registry.js";
import { handleMessage } from "./message-router.js";
import { pushToRemote, checkRemoteAhead, isSyncRunning } from "./sync-engine.js";
import { isConflictError } from "./conflict.js";
import { scheduleAutoSync, ensureAutoSyncSchedule, AUTO_SYNC_ALARM, CHANGE_DEBOUNCE_ALARM, BADGE_CLEAR_ALARM } from "./scheduler.js";
import {
  registerBookmarkTriggers,
  hasPendingChangePush,
  clearPendingChangePush,
  rescheduleChangePush,
  restorePendingChangePush
} from "./triggers.js";
import { setBadge, applyStoredBadge, clearSuccessBadge, clearPendingBadge, BadgeState } from "./badge.js";
import { notifyIfEnabled, notifyDirect } from "./notify.js";
import { on, emit, Events } from "./events.js";

const NOTIFY_TITLE = "书签同步";

// ---- 自动推送编排（定时鬧钟与变更防抖共用） ----

async function runAutoPush() {
  try {
    const result = await pushToRemote();
    await emit(Events.AUTO_SYNC_SUCCESS, { result });
    return "success";
  } catch (error) {
    if (isConflictError(error)) {
      console.warn("auto sync skipped due to conflict", error.details || error.message);
      await emit(Events.AUTO_SYNC_CONFLICT, { error });
      return "conflict";
    }
    console.error("auto sync failed", error);
    await emit(Events.AUTO_SYNC_ERROR, { error });
    return "error";
  }
}

// 变更推送失败的退避重试上限：网络抖动能自愈，坏 token 不至于无限刷错误通知。
const CHANGE_PUSH_RETRY_KEY = "changePushRetries";
const CHANGE_PUSH_MAX_RETRIES = 2;

async function runChangePush() {
  if (!(await hasPendingChangePush())) {
    return;
  }

  const config = await getConfig();
  if (!config.changeSync?.enabled) {
    await clearPendingChangePush();
    // 变更同步已被关闭：残留的"待推送"徽章一并清掉，否则会永远挂着。
    await clearPendingBadge();
    return;
  }

  if (isSyncRunning()) {
    // 有同步在进行（如用户手动推送），往后挪一轮再试。
    rescheduleChangePush(60);
    return;
  }

  // 先清标记再推送：推送期间产生的新变更会重新置位，不会被误吞。
  await clearPendingChangePush();
  const outcome = await runAutoPush();

  if (outcome === "error") {
    // 失败不能静默丢弃这次变更（仅配置了变更同步、没开定时兜底的用户
    // 将永远推不上去）：恢复待推标记，退避后重试，有限次数。
    const stored = await chrome.storage.session.get(CHANGE_PUSH_RETRY_KEY);
    const retries = Number(stored[CHANGE_PUSH_RETRY_KEY]) || 0;
    if (retries < CHANGE_PUSH_MAX_RETRIES) {
      await chrome.storage.session.set({ [CHANGE_PUSH_RETRY_KEY]: retries + 1 });
      await restorePendingChangePush(120);
      return;
    }
  }
  // 成功/冲突跳过/重试耗尽：重置重试计数（冲突需用户介入，不做自动重试）。
  await chrome.storage.session.remove(CHANGE_PUSH_RETRY_KEY);
}

// ---- 事件订阅：徽章 + 通知 ----

on(Events.AUTO_SYNC_SUCCESS, async ({ result }) => {
  await setBadge(result?.noop ? BadgeState.IDLE : BadgeState.SUCCESS);
  if (!result?.noop) {
    await notifyIfEnabled("onAutoSyncSuccess", NOTIFY_TITLE, "自动推送完成");
  }
});

on(Events.AUTO_SYNC_CONFLICT, async ({ error }) => {
  await setBadge(BadgeState.CONFLICT);
  await notifyIfEnabled(
    "onAutoSyncError",
    NOTIFY_TITLE,
    `自动推送因冲突跳过：${error?.details?.summary || error?.message || "检测到冲突"}`
  );
});

on(Events.AUTO_SYNC_ERROR, async ({ error }) => {
  await setBadge(BadgeState.ERROR);
  await notifyIfEnabled("onAutoSyncError", NOTIFY_TITLE, `自动推送失败：${error?.message || error}`);
});

on(Events.CHANGE_PENDING, async () => {
  await setBadge(BadgeState.PENDING);
});

on(Events.MANUAL_SYNC_SUCCESS, async ({ direction, result }) => {
  // 手动操作成功后清掉遗留的错误/冲突/待推送徽章。
  await setBadge(BadgeState.IDLE);
  if (!result?.noop) {
    await notifyIfEnabled(
      "onManualDone",
      NOTIFY_TITLE,
      direction === "push" ? "推送完成" : "拉取完成"
    );
  }
});

on(Events.REMOTE_AHEAD, async ({ providers }) => {
  await setBadge(BadgeState.PENDING);
  const labels = (providers || []).map((id) => getProviderLabel(id)).join("、");
  // checkRemoteOnStartup 本身是显式开关，开启即视为同意提醒。
  await notifyDirect(NOTIFY_TITLE, `云端书签有更新（${labels}），点击扩展图标拉取。`);
});

// ---- 顶层监听注册 ----

registerBookmarkTriggers();

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const config = await getConfig();
    await saveConfig(config); // 触发配置迁移落盘
    await scheduleAutoSync(config);
  })().catch((error) => {
    console.error("onInstalled init failed", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    await ensureAutoSyncSchedule();
    await applyStoredBadge();

    const config = await getConfig();
    if (config.checkRemoteOnStartup) {
      const ahead = await checkRemoteAhead();
      if (ahead) {
        await emit(Events.REMOTE_AHEAD, ahead);
      }
    }
  })().catch((error) => {
    console.error("onStartup init failed", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  (async () => {
    if (alarm.name === AUTO_SYNC_ALARM) {
      await runAutoPush();
      return;
    }
    if (alarm.name === CHANGE_DEBOUNCE_ALARM) {
      await runChangePush();
      return;
    }
    if (alarm.name === BADGE_CLEAR_ALARM) {
      await clearSuccessBadge();
    }
  })().catch((error) => {
    console.error("alarm handler failed", alarm?.name, error);
  });
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
