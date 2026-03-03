const CONFIG_KEY = "syncConfig";
const LAST_SYNC_KEY = "lastSync";
const SYNC_STATE_KEY = "syncState";

export const DEFAULT_CONFIG = {
  provider: "github",
  github: {
    token: "",
    owner: "",
    repo: "",
    branch: "main",
    path: "bookmarks/snapshot.json"
  },
  gitee: {
    token: "",
    owner: "",
    repo: "",
    branch: "master",
    path: "bookmarks/snapshot.json"
  },
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 60,
  syncAllProviders: false
};

function deepMerge(base, patch) {
  if (typeof patch !== "object" || patch === null) {
    return structuredClone(base);
  }

  const result = structuredClone(base);
  for (const key of Object.keys(patch)) {
    if (typeof patch[key] === "object" && patch[key] !== null && !Array.isArray(patch[key])) {
      result[key] = deepMerge(result[key] || {}, patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
}

async function getStorageValue(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result[key]);
    });
  });
}

async function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

export async function getConfig() {
  const raw = await getStorageValue(CONFIG_KEY);
  return deepMerge(DEFAULT_CONFIG, raw || {});
}

export async function saveConfig(nextConfig) {
  const merged = deepMerge(DEFAULT_CONFIG, nextConfig || {});
  await setStorageValue(CONFIG_KEY, merged);
  return merged;
}

export async function getLastSync() {
  return (await getStorageValue(LAST_SYNC_KEY)) || null;
}

export async function saveLastSync(lastSync) {
  await setStorageValue(LAST_SYNC_KEY, lastSync);
}

export async function getSyncState() {
  return (await getStorageValue(SYNC_STATE_KEY)) || null;
}

export async function saveSyncState(syncState) {
  await setStorageValue(SYNC_STATE_KEY, syncState);
}
