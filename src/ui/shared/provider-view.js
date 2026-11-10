import { isProviderEnabled } from "../../core/config.js";

// Keep stored history intact while displaying only currently enabled repositories.
export function getVisibleLastSync(config, lastSync) {
  if (!lastSync) return null;
  const providers = Array.isArray(lastSync.providers) && lastSync.providers.length > 0
    ? lastSync.providers
    : String(lastSync.provider || "").split(",");
  const visible = providers.filter((id) => isProviderEnabled(config, id));
  if (visible.length === 0) return null;
  const result = { ...lastSync, provider: visible.join(","), providers: visible };
  if (Array.isArray(lastSync.items)) {
    result.items = lastSync.items.filter((item) => visible.includes(item.provider));
    result.noop = result.items.length > 0 && result.items.every((item) => item.noop);
    result.needsPull = result.items.some((item) => item.needsPull);
  }
  if (Array.isArray(lastSync.failures)) {
    result.failures = lastSync.failures.filter((item) => isProviderEnabled(config, item.provider));
    result.partial = result.failures.length > 0;
  }
  return result;
}
