import { getConfig } from "../core/storage.js";
import { normalizeIntervalMinutes } from "../core/config.js";

// 鬧钟名冻结：既有用户浏览器里已存在同名 alarm。
export const AUTO_SYNC_ALARM = "bookmarkAutoSync";
export const CHANGE_DEBOUNCE_ALARM = "bookmarkChangeDebounce";
export const BADGE_CLEAR_ALARM = "badgeAutoClear";

export async function scheduleAutoSync(config) {
  await chrome.alarms.clear(AUTO_SYNC_ALARM);
  if (!config.autoSyncEnabled) {
    return;
  }

  const periodInMinutes = normalizeIntervalMinutes(config.autoSyncIntervalMinutes);
  chrome.alarms.create(AUTO_SYNC_ALARM, { periodInMinutes });
}

export async function ensureAutoSyncSchedule() {
  const config = await getConfig();
  await scheduleAutoSync(config);
}
