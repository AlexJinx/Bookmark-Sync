import { isSelfMutating } from "../core/bookmarks/service.js";
import { getConfig } from "../core/storage.js";
import { normalizeDebounceSeconds } from "../core/config.js";
import { CHANGE_DEBOUNCE_ALARM } from "./scheduler.js";
import { emit, Events } from "./events.js";

// 书签变更触发的自动推送（防抖）。
//
// 关键约束：
// 1. MV3 SW 空闲 ~30 秒即被销毁，防抖绝不能用 setTimeout —— 用一次性 chrome.alarms，
//    每次变更重建鬧钟实现滑动窗口；"待推送"标记放 chrome.storage.session（随浏览器
//    会话存活，SW 重启不丢）。
// 2. 回音抑制：本扩展自身的导入/清空（isSelfMutating）触发的事件必须忽略，
//    否则形成 拉取->推送->他机拉取->... 的循环。
// 3. 浏览器原生"导入书签"（onImportBegan/Ended）期间会喷大量事件，
//    暂停计数，结束后按一次变更处理。

export const PENDING_CHANGE_KEY = "pendingChangePush";

let nativeImportActive = false;

async function markDirty() {
  if (isSelfMutating() || nativeImportActive) {
    return;
  }

  const config = await getConfig();
  if (!config.changeSync?.enabled) {
    return;
  }

  const debounceSeconds = normalizeDebounceSeconds(config.changeSync.debounceSeconds);
  await chrome.storage.session.set({ [PENDING_CHANGE_KEY]: true });
  chrome.alarms.create(CHANGE_DEBOUNCE_ALARM, { when: Date.now() + debounceSeconds * 1000 });
  await emit(Events.CHANGE_PENDING);
}

export async function hasPendingChangePush() {
  const result = await chrome.storage.session.get(PENDING_CHANGE_KEY);
  return Boolean(result[PENDING_CHANGE_KEY]);
}

export async function clearPendingChangePush() {
  await chrome.storage.session.remove(PENDING_CHANGE_KEY);
}

// 推送时机未到（同步进行中等），把鬧钟往后挪再试。
export function rescheduleChangePush(delaySeconds = 60) {
  chrome.alarms.create(CHANGE_DEBOUNCE_ALARM, { when: Date.now() + delaySeconds * 1000 });
}

// 推送失败后的有限重试：恢复待推标记并退避重排鬧钟（由 index.js 控制重试次数）。
export async function restorePendingChangePush(delaySeconds = 120) {
  await chrome.storage.session.set({ [PENDING_CHANGE_KEY]: true });
  rescheduleChangePush(delaySeconds);
}

function onBookmarkEvent() {
  markDirty().catch((error) => {
    console.error("bookmark change trigger failed", error);
  });
}

// 必须在 SW 顶层被同步调用（index.js），确保事件监听在每次 SW 唤醒时都注册。
export function registerBookmarkTriggers() {
  chrome.bookmarks.onCreated.addListener(onBookmarkEvent);
  chrome.bookmarks.onChanged.addListener(onBookmarkEvent);
  chrome.bookmarks.onMoved.addListener(onBookmarkEvent);
  chrome.bookmarks.onRemoved.addListener(onBookmarkEvent);
  if (chrome.bookmarks.onChildrenReordered) {
    chrome.bookmarks.onChildrenReordered.addListener(onBookmarkEvent);
  }
  if (chrome.bookmarks.onImportBegan) {
    chrome.bookmarks.onImportBegan.addListener(() => {
      nativeImportActive = true;
    });
  }
  if (chrome.bookmarks.onImportEnded) {
    chrome.bookmarks.onImportEnded.addListener(() => {
      nativeImportActive = false;
      onBookmarkEvent();
    });
  }
}
