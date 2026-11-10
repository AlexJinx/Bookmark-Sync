import { PROVIDERS, PROVIDER_IDS } from "../providers/registry.js";

export const CONFIG_VERSION = 3;

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

// 配置迁移保留既有仓库和同步基线；旧配置缺少 enabled 时默认启用。
export function migrateConfig(raw) {
  const merged = deepMerge(DEFAULT_CONFIG, raw || {});
  delete merged.gist;
  merged.configVersion = CONFIG_VERSION;
  for (const id of PROVIDER_IDS) {
    const scoped = merged[id];
    merged[id] = {
      ...PROVIDERS[id].defaults,
      ...(scoped && typeof scoped === "object" && !Array.isArray(scoped) ? scoped : {})
    };
    merged[id].enabled = merged[id].enabled !== false;
  }
  if (!PROVIDER_IDS.includes(merged.provider)) {
    merged.provider = DEFAULT_CONFIG.provider;
    // Never redirect an old automatic sync target to a different repository.
    merged.autoSyncEnabled = false;
    merged.changeSync = { ...DEFAULT_CONFIG.changeSync, ...merged.changeSync, enabled: false };
    merged.syncAllProviders = false;
  }
  merged.provider = getDefaultSyncProvider(merged) || merged.provider;
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

export function isProviderEnabled(config, providerId) {
  return Boolean(PROVIDERS[providerId]) && config?.[providerId]?.enabled !== false;
}

export function getEnabledProviders(config) {
  return PROVIDER_IDS.filter((id) => isProviderEnabled(config, id));
}

export function getSyncProviders(config) {
  return getConfiguredProviders(config).filter((id) => isProviderEnabled(config, id));
}

export function getDefaultSyncProvider(config) {
  const providers = getSyncProviders(config);
  return providers.includes(config?.provider) ? config.provider : providers[0] || "";
}

export function getSyncTargets(config) {
  if (config?.syncAllProviders) return getSyncProviders(config);
  const provider = getDefaultSyncProvider(config);
  return provider ? [provider] : [];
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
