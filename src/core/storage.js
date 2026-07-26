import { migrateConfig } from "./config.js";

// storage 键名冻结：改名会丢失既有用户数据。
const CONFIG_KEY = "syncConfig";
const LAST_SYNC_KEY = "lastSync";
const SYNC_STATE_KEY = "syncState";
const CLEAR_BACKUP_KEY = "lastClearBackup";

async function getLocal(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

export async function getConfig() {
  const raw = await getLocal(CONFIG_KEY);
  return migrateConfig(raw);
}

export async function saveConfig(nextConfig) {
  const merged = migrateConfig(nextConfig);
  await chrome.storage.local.set({ [CONFIG_KEY]: merged });
  return merged;
}

export async function getLastSync() {
  return (await getLocal(LAST_SYNC_KEY)) || null;
}

export async function saveLastSync(lastSync) {
  await chrome.storage.local.set({ [LAST_SYNC_KEY]: lastSync });
}

export async function getSyncState() {
  return (await getLocal(SYNC_STATE_KEY)) || null;
}

export async function saveSyncState(syncState) {
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: syncState });
}

export async function getClearBackup() {
  return (await getLocal(CLEAR_BACKUP_KEY)) || null;
}

export async function saveClearBackup(backup) {
  await chrome.storage.local.set({ [CLEAR_BACKUP_KEY]: backup });
}
