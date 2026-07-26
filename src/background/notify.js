import { getConfig } from "../core/storage.js";

const ICON_URL = "assets/icons/icon128.png";

async function createNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL(ICON_URL),
      title,
      message: String(message || "").slice(0, 300)
    });
  } catch (error) {
    console.warn("notification failed", error);
  }
}

// key 对应 config.notify 下的开关：onAutoSyncError / onAutoSyncSuccess / onManualDone
export async function notifyIfEnabled(key, title, message) {
  const config = await getConfig();
  if (!config.notify?.[key]) {
    return;
  }
  await createNotification(title, message);
}

// 绕过 notify 开关直接通知（仅用于本身就是显式开关的功能，如启动远端检查）。
export async function notifyDirect(title, message) {
  await createNotification(title, message);
}
