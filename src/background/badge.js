import { BADGE_CLEAR_ALARM } from "./scheduler.js";

// 工具栏徽章：让"自动任务因冲突/失败被跳过"从 console.warn 变成用户可见的状态。
export const BadgeState = Object.freeze({
  IDLE: "idle",
  PENDING: "pending",
  SUCCESS: "success",
  CONFLICT: "conflict",
  ERROR: "error"
});

const BADGE_STYLES = {
  [BadgeState.IDLE]: { text: "", color: "#64748b" },
  [BadgeState.PENDING]: { text: "…", color: "#64748b" },
  [BadgeState.SUCCESS]: { text: "✓", color: "#16a34a" },
  [BadgeState.CONFLICT]: { text: "!", color: "#f59e0b" },
  [BadgeState.ERROR]: { text: "!", color: "#dc2626" }
};

const BADGE_STATE_KEY = "badgeState";

export async function setBadge(state) {
  const style = BADGE_STYLES[state] || BADGE_STYLES[BadgeState.IDLE];
  await chrome.action.setBadgeText({ text: style.text });
  if (style.text) {
    await chrome.action.setBadgeBackgroundColor({ color: style.color });
  }
  await chrome.storage.session.set({ [BADGE_STATE_KEY]: state });

  if (state === BadgeState.SUCCESS) {
    // 成功徽章短暂展示后自动清除。alarms 最小延迟会被浏览器钳制（约 30 秒），可接受。
    chrome.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + 30 * 1000 });
  }
}

export async function getBadgeState() {
  const result = await chrome.storage.session.get(BADGE_STATE_KEY);
  return result[BADGE_STATE_KEY] || BadgeState.IDLE;
}

// SW 重启后恢复徽章显示（badge 文本本身随浏览器会话保留，此处兜底重放）。
export async function applyStoredBadge() {
  const state = await getBadgeState();
  const style = BADGE_STYLES[state] || BADGE_STYLES[BadgeState.IDLE];
  await chrome.action.setBadgeText({ text: style.text });
  if (style.text) {
    await chrome.action.setBadgeBackgroundColor({ color: style.color });
  }
}

// 成功徽章到期自动清除；错误/冲突徽章保留，直到用户处理。
export async function clearSuccessBadge() {
  const state = await getBadgeState();
  if (state === BadgeState.SUCCESS) {
    await setBadge(BadgeState.IDLE);
  }
}

// 待推送徽章的定向清除：调用方需先确认已无待推送任务（避免清掉真实的防抖等待提示）。
export async function clearPendingBadge() {
  const state = await getBadgeState();
  if (state === BadgeState.PENDING) {
    await setBadge(BadgeState.IDLE);
  }
}

// 用户打开弹窗视为已知晓，清除错误/冲突/成功徽章。
export async function acknowledgeBadge() {
  const state = await getBadgeState();
  if (state === BadgeState.ERROR || state === BadgeState.CONFLICT || state === BadgeState.SUCCESS) {
    await setBadge(BadgeState.IDLE);
  }
  return state;
}
