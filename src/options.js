const fields = {
  provider: document.getElementById("provider"),
  token: document.getElementById("token"),
  tokenVisibilityBtn: document.getElementById("tokenVisibilityBtn"),
  owner: document.getElementById("owner"),
  repo: document.getElementById("repo"),
  branch: document.getElementById("branch"),
  path: document.getElementById("path"),
  autoSyncEnabled: document.getElementById("autoSyncEnabled"),
  autoSyncIntervalMinutes: document.getElementById("autoSyncIntervalMinutes")
};

const providerUi = {
  root: document.getElementById("providerSelect"),
  trigger: document.getElementById("providerTrigger"),
  label: document.getElementById("providerLabel"),
  menu: document.getElementById("providerMenu"),
  options: Array.from(document.querySelectorAll(".provider-option"))
};

const scopedDrafts = {
  github: null,
  gitee: null
};

const CONFIG_EXPORT_TYPE = "bookmark-sync-config";
const CONFIG_EXPORT_VERSION = 1;
const PROVIDER_KEYS = ["github", "gitee"];

let activeProvider = fields.provider.value || "github";
let hasUnsavedChanges = false;
let statusHideTimer = null;

function hideStatus() {
  const status = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  if (!status || !statusText) {
    return;
  }

  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }

  statusText.textContent = "";
  status.classList.add("hidden");
  status.removeAttribute("data-type");
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const text = typeof message === "string" ? message.trim() : String(message || "");
  if (!status || !statusText) {
    return;
  }

  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }

  if (!text) {
    hideStatus();
    return;
  }

  statusText.textContent = text;
  status.dataset.type = isError ? "error" : "success";
  status.setAttribute("aria-live", isError ? "assertive" : "polite");
  status.classList.remove("hidden");

  statusHideTimer = setTimeout(
    () => hideStatus(),
    isError ? 6000 : 3200
  );
}

function setDirtyState(isDirty) {
  hasUnsavedChanges = Boolean(isDirty);
  const hint = document.getElementById("dirtyHint");
  if (!hint) {
    return;
  }

  hint.textContent = hasUnsavedChanges ? "有未保存更改" : "所有更改已保存";
  hint.classList.toggle("is-dirty", hasUnsavedChanges);
}

function markDirty() {
  setDirtyState(true);
}

function markClean() {
  setDirtyState(false);
}

function formatTime(iso) {
  if (!iso) {
    return "无";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "无";
  }
  return d.toLocaleString();
}

function normalizeIntervalMinutes(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 60;
  }
  return Math.max(15, parsed);
}

function normalizeIntervalInput() {
  const before = fields.autoSyncIntervalMinutes.value;
  const normalized = String(normalizeIntervalMinutes(before));
  fields.autoSyncIntervalMinutes.value = normalized;
  if (before && before !== normalized) {
    setStatus("自动同步间隔最小为 15 分钟，已自动调整。");
  }
}

async function sendMessage(action, extra = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.ok) {
    if (typeof response?.error === "string") {
      throw new Error(response.error || "请求失败");
    }
    throw new Error(response?.error?.message || "请求失败");
  }
  return response.data;
}

function getProviderScopedConfig(config) {
  return config[config.provider] || {};
}

function getProviderLabel(value) {
  const option = Array.from(fields.provider.options).find((item) => item.value === value);
  return option?.textContent || value;
}

function toTrimmedString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim();
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1" || value === 1) {
    return true;
  }
  if (value === "false" || value === "0" || value === 0) {
    return false;
  }
  return fallback;
}

function readScopedInputs() {
  return {
    token: fields.token.value.trim(),
    owner: fields.owner.value.trim(),
    repo: fields.repo.value.trim(),
    branch: fields.branch.value.trim(),
    path: fields.path.value.trim()
  };
}

function buildNextConfig(currentConfig) {
  const provider = fields.provider.value;
  const scoped = readScopedInputs();

  return {
    ...currentConfig,
    provider,
    [provider]: {
      ...currentConfig[provider],
      ...scoped
    },
    autoSyncEnabled: fields.autoSyncEnabled.checked,
    autoSyncIntervalMinutes: normalizeIntervalMinutes(fields.autoSyncIntervalMinutes.value)
  };
}

function normalizeScopedConfig(rawScoped, fallbackScoped = {}) {
  const scoped = rawScoped && typeof rawScoped === "object" && !Array.isArray(rawScoped) ? rawScoped : {};
  return {
    token: toTrimmedString(scoped.token, fallbackScoped.token || ""),
    owner: toTrimmedString(scoped.owner, fallbackScoped.owner || ""),
    repo: toTrimmedString(scoped.repo, fallbackScoped.repo || ""),
    branch: toTrimmedString(scoped.branch, fallbackScoped.branch || ""),
    path: toTrimmedString(scoped.path, fallbackScoped.path || "")
  };
}

function extractImportedConfigPayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置文件格式错误：根节点必须是对象");
  }

  if (parsed.type === CONFIG_EXPORT_TYPE) {
    if (!parsed.config || typeof parsed.config !== "object" || Array.isArray(parsed.config)) {
      throw new Error("配置文件格式错误：缺少 config 对象");
    }
    return parsed.config;
  }

  return parsed;
}

function normalizeImportedConfig(rawConfig, baseConfig) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("配置文件格式错误：config 必须是对象");
  }

  const provider = PROVIDER_KEYS.includes(rawConfig.provider) ? rawConfig.provider : baseConfig.provider;
  return {
    ...baseConfig,
    provider,
    github: normalizeScopedConfig(rawConfig.github, baseConfig.github),
    gitee: normalizeScopedConfig(rawConfig.gitee, baseConfig.gitee),
    autoSyncEnabled: toBoolean(rawConfig.autoSyncEnabled, Boolean(baseConfig.autoSyncEnabled)),
    autoSyncIntervalMinutes: normalizeIntervalMinutes(rawConfig.autoSyncIntervalMinutes ?? baseConfig.autoSyncIntervalMinutes),
    syncAllProviders: toBoolean(rawConfig.syncAllProviders, Boolean(baseConfig.syncAllProviders))
  };
}

function buildTimestampedName(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[.:]/g, "-")}.json`;
}

function downloadJsonFile(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildTimestampedName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadConfig(config) {
  const manifestVersion = chrome.runtime.getManifest().version || "unknown";
  const payload = {
    type: CONFIG_EXPORT_TYPE,
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config
  };
  downloadJsonFile(`bookmark-sync-config-v${manifestVersion}`, payload);
}

function syncProviderUi() {
  if (!providerUi.root) {
    return;
  }

  const current = fields.provider.value;
  providerUi.label.textContent = getProviderLabel(current);
  for (const option of providerUi.options) {
    option.setAttribute("aria-selected", String(option.dataset.value === current));
  }
}

function openProviderMenu() {
  if (!providerUi.root) {
    return;
  }
  providerUi.root.dataset.open = "true";
  providerUi.trigger.setAttribute("aria-expanded", "true");
}

function closeProviderMenu() {
  if (!providerUi.root) {
    return;
  }
  providerUi.root.dataset.open = "false";
  providerUi.trigger.setAttribute("aria-expanded", "false");
}

function isProviderMenuOpen() {
  return providerUi.root?.dataset.open === "true";
}

function setProviderValue(nextValue, { emitChange = false } = {}) {
  if (!nextValue) {
    return;
  }

  const changed = fields.provider.value !== nextValue;
  fields.provider.value = nextValue;
  syncProviderUi();

  if (changed && emitChange) {
    fields.provider.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function bindProviderSelect() {
  if (!providerUi.root) {
    return;
  }

  syncProviderUi();

  providerUi.trigger.addEventListener("click", () => {
    if (isProviderMenuOpen()) {
      closeProviderMenu();
      return;
    }
    openProviderMenu();
  });

  providerUi.trigger.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openProviderMenu();
    }
  });

  for (const option of providerUi.options) {
    option.addEventListener("click", () => {
      setProviderValue(option.dataset.value || "", { emitChange: true });
      closeProviderMenu();
      providerUi.trigger.focus();
    });
  }

  document.addEventListener("click", (event) => {
    if (!isProviderMenuOpen()) {
      return;
    }
    if (providerUi.root.contains(event.target)) {
      return;
    }
    closeProviderMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!isProviderMenuOpen()) {
      return;
    }
    closeProviderMenu();
    providerUi.trigger.focus();
  });
}

function setTokenVisibility(visible) {
  const isVisible = Boolean(visible);
  fields.token.type = isVisible ? "text" : "password";
  fields.tokenVisibilityBtn.classList.toggle("is-visible", isVisible);
  const hiddenLabel = fields.tokenVisibilityBtn.querySelector(".visually-hidden");
  if (hiddenLabel) {
    hiddenLabel.textContent = isVisible ? "隐藏令牌" : "显示令牌";
  }
  fields.tokenVisibilityBtn.setAttribute("aria-label", isVisible ? "隐藏令牌" : "显示令牌");
  fields.tokenVisibilityBtn.setAttribute("aria-pressed", String(isVisible));
}

function toggleTokenVisibility() {
  setTokenVisibility(fields.token.type === "password");
}

function render(config) {
  const provider = config.provider || "github";
  setProviderValue(provider);

  const persisted = getProviderScopedConfig(config);
  const draft = scopedDrafts[provider] || {};
  const scoped = {
    ...persisted,
    ...draft
  };

  fields.token.value = scoped.token || "";
  fields.owner.value = scoped.owner || "";
  fields.repo.value = scoped.repo || "";
  fields.branch.value = scoped.branch || "";
  fields.path.value = scoped.path || "";
  fields.autoSyncEnabled.checked = Boolean(config.autoSyncEnabled);
  fields.autoSyncIntervalMinutes.value = String(normalizeIntervalMinutes(config.autoSyncIntervalMinutes));
  setTokenVisibility(false);

  activeProvider = provider;
}

async function load() {
  const [config, lastSync] = await Promise.all([sendMessage("getConfig"), sendMessage("getLastSync")]);
  scopedDrafts.github = null;
  scopedDrafts.gitee = null;
  render(config);
  document.getElementById("lastSync").textContent = lastSync
    ? `最近同步: ${formatTime(lastSync.at)} (${lastSync.direction || "manual"}, ${lastSync.provider || "-"})`
    : "最近同步: 无";
  markClean();
}

async function save() {
  const current = await sendMessage("getConfig");
  const nextConfig = buildNextConfig(current);
  await sendMessage("saveConfig", { config: nextConfig });

  scopedDrafts[nextConfig.provider] = null;
  setStatus("设置已保存");
  markClean();
}

async function testConnection() {
  const current = await sendMessage("getConfig");
  const nextConfig = buildNextConfig(current);
  const result = await sendMessage("testConnection", { config: nextConfig });
  setStatus(`连接成功: ${result.fullName} (默认分支: ${result.defaultBranch})`);
}

async function exportConfig() {
  const config = await sendMessage("getConfig");
  downloadConfig(config);
  setStatus("配置导出完成，请妥善保管文件。");
}

async function exportBookmarks() {
  const snapshot = await sendMessage("exportLocal");
  downloadJsonFile("bookmark-sync-snapshot", snapshot);
  setStatus("书签快照导出完成。");
}

function importBookmarksClick() {
  const input = document.getElementById("importBookmarksInput");
  input.value = "";
  input.click();
}

async function importBookmarksFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  setStatus("正在导入书签快照...");
  const text = await file.text();

  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new Error("书签文件不是有效的 JSON");
  }

  const ok = window.confirm("导入会覆盖当前本地书签结构，是否继续？");
  if (!ok) {
    setStatus("已取消导入书签。");
    return;
  }

  await sendMessage("importLocal", { snapshot });
  setStatus("书签快照导入完成。");
}

function importConfigClick() {
  const input = document.getElementById("importConfigInput");
  input.value = "";
  input.click();
}

async function importConfigFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  setStatus("正在导入配置...");
  const text = await file.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("配置文件不是有效的 JSON");
  }

  const importedConfig = extractImportedConfigPayload(parsed);
  const current = await sendMessage("getConfig");
  const nextConfig = normalizeImportedConfig(importedConfig, current);
  const saved = await sendMessage("saveConfig", { config: nextConfig });

  scopedDrafts.github = null;
  scopedDrafts.gitee = null;
  render(saved);
  setStatus("配置导入并保存完成。");
  markClean();
}

async function switchProvider() {
  scopedDrafts[activeProvider] = readScopedInputs();

  const config = await sendMessage("getConfig");
  config.provider = fields.provider.value;
  render(config);
}

function bindEvents() {
  bindProviderSelect();
  fields.tokenVisibilityBtn.addEventListener("click", toggleTokenVisibility);
  fields.autoSyncIntervalMinutes.addEventListener("change", normalizeIntervalInput);
  fields.autoSyncIntervalMinutes.addEventListener("blur", normalizeIntervalInput);
  document.getElementById("saveBtn").addEventListener("click", () => run(save));
  document.getElementById("testBtn").addEventListener("click", () => run(testConnection));
  document.getElementById("exportBookmarksBtn").addEventListener("click", () => run(exportBookmarks));
  document.getElementById("importBookmarksBtn").addEventListener("click", importBookmarksClick);
  document.getElementById("importBookmarksInput").addEventListener("change", (event) => run(() => importBookmarksFile(event)));
  document.getElementById("exportConfigBtn").addEventListener("click", () => run(exportConfig));
  document.getElementById("importConfigBtn").addEventListener("click", importConfigClick);
  document.getElementById("importConfigInput").addEventListener("change", (event) => run(() => importConfigFile(event)));
  fields.provider.addEventListener("change", () => run(switchProvider));

  const dirtyInputs = [fields.token, fields.owner, fields.repo, fields.branch, fields.path];
  for (const input of dirtyInputs) {
    input.addEventListener("input", markDirty);
  }
  fields.autoSyncEnabled.addEventListener("change", markDirty);
  fields.autoSyncIntervalMinutes.addEventListener("input", markDirty);
  fields.autoSyncIntervalMinutes.addEventListener("change", markDirty);
  document.getElementById("statusCloseBtn").addEventListener("click", hideStatus);
}

async function run(fn) {
  try {
    await fn();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

async function init() {
  bindEvents();
  await run(load);
}

init();
