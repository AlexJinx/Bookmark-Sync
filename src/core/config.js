import { PROVIDERS, PROVIDER_IDS } from "../providers/registry.js";

export const CONFIG_VERSION = 2;

function providerDefaults() {
  const result = {};
  for (const id of PROVIDER_IDS) {
    result[id] = { ...PROVIDERS[id].defaults };
  }
  return result;
}

export const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  provider: "github",
  ...providerDefaults(),
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 60,
  syncAllProviders: false,
  theme: "auto",
  skin: "default",
  changeSync: {
    enabled: false,
    debounceSeconds: 60
  },
  notify: {
    onAutoSyncError: true,
    onAutoSyncSuccess: false,
    onManualDone: false
  },
  checkRemoteOnStartup: false
};

export function deepMerge(base, patch) {
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

// 配置迁移管线：v1（无 configVersion）-> v2 结构上由 deepMerge 补齐默认值即可，
// 保留其他未知字段，但清除已停用的平台凭据。
export function migrateConfig(raw) {
  const merged = deepMerge(DEFAULT_CONFIG, raw || {});
  delete merged.gist;
  merged.configVersion = CONFIG_VERSION;
  if (!PROVIDER_IDS.includes(merged.provider)) {
    merged.provider = DEFAULT_CONFIG.provider;
    // Never redirect an old automatic sync target to a different repository.
    merged.autoSyncEnabled = false;
    merged.changeSync = { ...DEFAULT_CONFIG.changeSync, ...merged.changeSync, enabled: false };
    merged.syncAllProviders = false;
  }
  return merged;
}

export function isProviderConfigured(config, providerId) {
  const meta = PROVIDERS[providerId];
  const scoped = config?.[providerId];
  if (!meta || !scoped || typeof scoped !== "object") {
    return false;
  }

  return meta.requiredFields.every((field) => {
    const value = scoped[field];
    return typeof value === "string" && value.trim();
  });
}

export function getConfiguredProviders(config) {
  return PROVIDER_IDS.filter((providerId) => isProviderConfigured(config, providerId));
}

export function normalizeIntervalMinutes(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 60;
  }
  return Math.max(15, parsed);
}

export function normalizeDebounceSeconds(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 60;
  }
  return Math.min(300, Math.max(30, parsed));
}
