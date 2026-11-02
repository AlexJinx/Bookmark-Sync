import { migrateConfig } from "./core/config.js";

export const CONFIG_EXPORT_TYPE = "bookmark-sync-config";
export const CONFIG_EXPORT_VERSION = 1;

function withoutTokens(config) {
  const cloned = structuredClone(config || {});
  for (const provider of ["github", "gitee"]) {
    if (!cloned[provider] || typeof cloned[provider] !== "object") {
      continue;
    }
    delete cloned[provider].token;
  }
  return cloned;
}

export function createConfigExportPayload(
  config,
  { includeTokens = true, extensionVersion = "unknown", exportedAt = new Date().toISOString() } = {}
) {
  return {
    type: CONFIG_EXPORT_TYPE,
    version: CONFIG_EXPORT_VERSION,
    extensionVersion,
    exportedAt,
    containsTokens: Boolean(includeTokens),
    config: includeTokens ? migrateConfig(config) : withoutTokens(migrateConfig(config))
  };
}
