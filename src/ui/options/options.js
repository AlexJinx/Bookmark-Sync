import { Actions } from "../../core/actions.js";
import { PROVIDERS, PROVIDER_IDS, getProviderLabel } from "../../providers/registry.js";
import { normalizeIntervalMinutes, normalizeDebounceSeconds } from "../../core/config.js";
import { normalizeAuthToken, toTrimmedString, toBoolean } from "../../core/text.js";
import { countSnapshotBookmarks } from "../../core/snapshot/count.js";
import { send } from "../shared/messaging.js";

const CONFIG_EXPORT_TYPE = "bookmark-sync-config";
const CONFIG_EXPORT_VERSION = 2;

// 各 scoped 字段的输入框 id 与字段名一致。
const fields = {
  provider: document.getElementById("provider"),
  token: document.getElementById("token"),
  tokenVisibilityBtn: document.getElementById("tokenVisibilityBtn"),
  owner: document.getElementById("owner"),
  repo: document.getElementById("repo"),
  branch: document.getElementById("branch"),
  path: document.getElementById("path"),
  gistId: document.getElementById("gistId"),
  fileName: document.getElementById("fileName"),
  changeSyncEnabled: document.getElementById("changeSyncEnabled"),
  changeSyncDebounceSeconds: document.getElementById("changeSyncDebounceSeconds"),
  autoSyncEnabled: document.getElementById("autoSyncEnabled"),
  autoSyncIntervalMinutes: document.getElementById("autoSyncIntervalMinutes"),
  checkRemoteOnStartup: document.getElementById("checkRemoteOnStartup"),
  notifyOnAutoSyncError: document.getElementById("notifyOnAutoSyncError"),
  notifyOnAutoSyncSuccess: document.getElementById("notifyOnAutoSyncSuccess"),
  notifyOnManualDone: document.getElementById("notifyOnManualDone")
};

const providerUi = {
  root: document.getElementById("providerSelect"),
  trigger: document.getElementById("providerTrigger"),
  label: document.getElementById("providerLabel"),
  menu: document.getElementById("providerMenu"),
  options: []
};

const TOKEN_NOTES = {
  github:
    "请直接粘贴原始 Token，不要包含 Bearer/token 前缀。推荐 Fine-grained Token：需添加 Metadata(只读) 与 Contents(读写) 权限。",
  gitee: "请直接粘贴原始私人令牌（PAT），确保具备仓库内容读写权限。",
  gist: "需要 classic Personal Access Token 并勾选 gist 权限（Fine-grained Token 不支持 Gist）。"
};

const scopedDrafts = {};
for (const id of PROVIDER_IDS) {
  scopedDrafts[id] = null;
}

let activeProvider = "github";
let hasUnsavedChanges = false;
let statusHideTimer = null;

// ---- 状态提示 ----

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

function setStatus(message, isError = false, { autoHide = true } = {}) {
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

  // 进行中的提示（autoHide=false）保持常显，直到被完成/失败提示替换。
  if (autoHide) {
    statusHideTimer = setTimeout(() => hideStatus(), isError ? 6000 : 3200);
  }
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

// ---- 数值规范化 ----

function normalizeIntervalInput() {
  const before = fields.autoSyncIntervalMinutes.value;
  const normalized = String(normalizeIntervalMinutes(before));
  fields.autoSyncIntervalMinutes.value = normalized;
  if (before && before !== normalized) {
    setStatus("定时推送间隔最小为 15 分钟，已自动调整。");
  }
}

function normalizeDebounceInput() {
  const before = fields.changeSyncDebounceSeconds.value;
  const normalized = String(normalizeDebounceSeconds(before));
  fields.changeSyncDebounceSeconds.value = normalized;
  if (before && before !== normalized) {
    setStatus("变更推送延迟范围为 30 ~ 300 秒，已自动调整。");
  }
}

// ---- scoped 配置读写 ----

function getScopedFieldNames(providerId) {
  return Object.keys(PROVIDERS[providerId]?.defaults || {});
}

function isRepoTypeProvider(providerId) {
  return "owner" in (PROVIDERS[providerId]?.defaults || {});
}

function readScopedInputs(providerId = fields.provider.value) {
  const result = {};
  for (const key of getScopedFieldNames(providerId)) {
    const input = fields[key];
    if (!input) {
      continue;
    }
    result[key] = key === "token" ? normalizeAuthToken(input.value) : input.value.trim();
  }
  return result;
}

function normalizeScopedConfig(providerId, rawScoped, fallbackScoped = {}) {
  const scoped = rawScoped && typeof rawScoped === "object" && !Array.isArray(rawScoped) ? rawScoped : {};
  const result = {};
  for (const key of getScopedFieldNames(providerId)) {
    result[key] = toTrimmedString(scoped[key], fallbackScoped[key] || "");
  }
  return result;
}

function buildNextConfig(currentConfig) {
  const provider = fields.provider.value;
  const scoped = readScopedInputs(provider);

  // 本次会话切换平台时暂存的其他平台草稿一并写入，
  // 否则"保存设置"后仍有未落盘的编辑，与"所有更改已保存"提示不符。
  const draftSections = {};
  for (const id of PROVIDER_IDS) {
    if (id !== provider && scopedDrafts[id]) {
      draftSections[id] = {
        ...currentConfig[id],
        ...scopedDrafts[id]
      };
    }
  }

  return {
    ...currentConfig,
    ...draftSections,
    provider,
    [provider]: {
      ...currentConfig[provider],
      ...scoped
    },
    autoSyncEnabled: fields.autoSyncEnabled.checked,
    autoSyncIntervalMinutes: normalizeIntervalMinutes(fields.autoSyncIntervalMinutes.value),
    changeSync: {
      ...(currentConfig.changeSync || {}),
      enabled: fields.changeSyncEnabled.checked,
      debounceSeconds: normalizeDebounceSeconds(fields.changeSyncDebounceSeconds.value)
    },
    checkRemoteOnStartup: fields.checkRemoteOnStartup.checked,
    notify: {
      ...(currentConfig.notify || {}),
      onAutoSyncError: fields.notifyOnAutoSyncError.checked,
      onAutoSyncSuccess: fields.notifyOnAutoSyncSuccess.checked,
      onManualDone: fields.notifyOnManualDone.checked
    }
  };
}

// ---- 配置导入/导出 ----

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

  // 裸配置对象（无导出信封）至少要带一个可识别的配置字段，
  // 否则选错文件（如书签快照）会被静默"成功导入"成一次空操作。
  const knownKeys = [
    "configVersion",
    "provider",
    "autoSyncEnabled",
    "autoSyncIntervalMinutes",
    "syncAllProviders",
    "changeSync",
    "notify",
    "checkRemoteOnStartup",
    ...PROVIDER_IDS
  ];
  if (knownKeys.some((key) => Object.prototype.hasOwnProperty.call(parsed, key))) {
    return parsed;
  }
  throw new Error("配置文件格式错误：未识别到任何配置字段，请确认选择的是配置导出文件");
}

function normalizeImportedConfig(rawConfig, baseConfig) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("配置文件格式错误：config 必须是对象");
  }

  const provider = PROVIDER_IDS.includes(rawConfig.provider) ? rawConfig.provider : baseConfig.provider;

  const providerSections = {};
  for (const id of PROVIDER_IDS) {
    providerSections[id] = normalizeScopedConfig(id, rawConfig[id], baseConfig[id]);
  }

  const rawChangeSync = rawConfig.changeSync && typeof rawConfig.changeSync === "object" ? rawConfig.changeSync : {};
  const rawNotify = rawConfig.notify && typeof rawConfig.notify === "object" ? rawConfig.notify : {};
  const baseChangeSync = baseConfig.changeSync || {};
  const baseNotify = baseConfig.notify || {};

  return {
    ...baseConfig,
    provider,
    ...providerSections,
    autoSyncEnabled: toBoolean(rawConfig.autoSyncEnabled, Boolean(baseConfig.autoSyncEnabled)),
    autoSyncIntervalMinutes: normalizeIntervalMinutes(rawConfig.autoSyncIntervalMinutes ?? baseConfig.autoSyncIntervalMinutes),
    syncAllProviders: toBoolean(rawConfig.syncAllProviders, Boolean(baseConfig.syncAllProviders)),
    changeSync: {
      enabled: toBoolean(rawChangeSync.enabled, Boolean(baseChangeSync.enabled)),
      debounceSeconds: normalizeDebounceSeconds(rawChangeSync.debounceSeconds ?? baseChangeSync.debounceSeconds)
    },
    checkRemoteOnStartup: toBoolean(rawConfig.checkRemoteOnStartup, Boolean(baseConfig.checkRemoteOnStartup)),
    notify: {
      onAutoSyncError: toBoolean(rawNotify.onAutoSyncError, baseNotify.onAutoSyncError !== false),
      onAutoSyncSuccess: toBoolean(rawNotify.onAutoSyncSuccess, Boolean(baseNotify.onAutoSyncSuccess)),
      onManualDone: toBoolean(rawNotify.onManualDone, Boolean(baseNotify.onManualDone))
    }
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

// ---- 提供方选择器（registry 驱动） ----

function populateProviderControls() {
  fields.provider.textContent = "";
  providerUi.menu.textContent = "";

  for (const id of PROVIDER_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = getProviderLabel(id);
    fields.provider.appendChild(option);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "provider-option";
    menuBtn.dataset.value = id;
    menuBtn.setAttribute("role", "option");
    menuBtn.textContent = getProviderLabel(id);
    providerUi.menu.appendChild(menuBtn);
  }

  providerUi.options = Array.from(providerUi.menu.querySelectorAll(".provider-option"));
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
  providerUi.root.dataset.open = "true";
  providerUi.trigger.setAttribute("aria-expanded", "true");
}

function closeProviderMenu() {
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

// ---- 渲染 ----

function updateHistoryLink(config, provider) {
  const link = document.getElementById("historyLink");
  if (!link) {
    return;
  }

  const meta = PROVIDERS[provider];
  const scoped = config?.[provider] || {};
  const url = meta?.historyUrl?.(scoped) || "";
  link.classList.toggle("hidden", !url);
  if (url) {
    link.href = url;
  }
}

function render(config) {
  const provider = PROVIDER_IDS.includes(config.provider) ? config.provider : "github";
  setProviderValue(provider);

  const persisted = config[provider] || {};
  const draft = scopedDrafts[provider] || {};
  const scoped = {
    ...persisted,
    ...draft
  };

  for (const key of getScopedFieldNames(provider)) {
    const input = fields[key];
    if (input) {
      input.value = scoped[key] || "";
    }
  }

  const repoType = isRepoTypeProvider(provider);
  document.getElementById("repoFields").classList.toggle("hidden", !repoType);
  document.getElementById("gistFields").classList.toggle("hidden", repoType);
  document.getElementById("tokenNote").textContent = TOKEN_NOTES[provider] || "";
  updateHistoryLink(config, provider);

  fields.autoSyncEnabled.checked = Boolean(config.autoSyncEnabled);
  fields.autoSyncIntervalMinutes.value = String(normalizeIntervalMinutes(config.autoSyncIntervalMinutes));
  fields.changeSyncEnabled.checked = Boolean(config.changeSync?.enabled);
  fields.changeSyncDebounceSeconds.value = String(normalizeDebounceSeconds(config.changeSync?.debounceSeconds));
  fields.checkRemoteOnStartup.checked = Boolean(config.checkRemoteOnStartup);
  fields.notifyOnAutoSyncError.checked = config.notify?.onAutoSyncError !== false;
  fields.notifyOnAutoSyncSuccess.checked = Boolean(config.notify?.onAutoSyncSuccess);
  fields.notifyOnManualDone.checked = Boolean(config.notify?.onManualDone);
  setTokenVisibility(false);

  activeProvider = provider;
}

function resetDrafts() {
  for (const id of PROVIDER_IDS) {
    scopedDrafts[id] = null;
  }
}

// ---- 动作 ----

async function load() {
  const config = await send(Actions.GET_CONFIG);
  resetDrafts();
  render(config);
  markClean();
}

async function save() {
  const current = await send(Actions.GET_CONFIG);
  const nextConfig = buildNextConfig(current);
  const saved = await send(Actions.SAVE_CONFIG, { config: nextConfig });

  // buildNextConfig 已把所有平台草稿一并写入，全部清空。
  resetDrafts();
  updateHistoryLink(saved, nextConfig.provider);
  setStatus("设置已保存");
  markClean();
}

async function testConnection() {
  const current = await send(Actions.GET_CONFIG);
  const nextConfig = buildNextConfig(current);
  const result = await send(Actions.TEST_CONNECTION, { config: nextConfig });
  setStatus(`连接成功: ${result.summary || result.fullName || ""}`);
}

async function exportConfig() {
  const config = await send(Actions.GET_CONFIG);
  downloadConfig(config);
  setStatus("配置导出完成，请妥善保管文件。");
}

async function exportBookmarks() {
  const snapshot = await send(Actions.EXPORT_LOCAL);
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

  setStatus("正在导入书签快照...", false, { autoHide: false });
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

  await send(Actions.IMPORT_LOCAL, { snapshot });
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

  setStatus("正在导入配置...", false, { autoHide: false });
  const text = await file.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("配置文件不是有效的 JSON");
  }

  const importedConfig = extractImportedConfigPayload(parsed);
  const current = await send(Actions.GET_CONFIG);
  const nextConfig = normalizeImportedConfig(importedConfig, current);
  const saved = await send(Actions.SAVE_CONFIG, { config: nextConfig });

  resetDrafts();
  render(saved);
  setStatus("配置导入并保存完成。");
  markClean();
}

async function clearLocalBookmarks() {
  const snapshot = await send(Actions.EXPORT_LOCAL);
  const count = countSnapshotBookmarks(snapshot);

  if (count === 0) {
    setStatus("本地没有可清空的书签。");
    return;
  }

  // 先落地一份下载备份，再确认执行。
  downloadJsonFile("bookmark-sync-pre-clear-backup", snapshot);

  const ok = window.confirm(
    `将删除本地 ${count} 条书签（仅标准书签目录）。\n\n已自动下载备份 JSON，扩展内也会保留最近一次清空备份。\n是否继续？`
  );
  if (!ok) {
    setStatus("已取消清空。备份文件已下载，可自行删除。");
    return;
  }

  setStatus("正在清空本地书签...", false, { autoHide: false });
  const result = await send(Actions.CLEAR_LOCAL_BOOKMARKS);
  setStatus(`已清空本地 ${result.clearedBookmarks} 条书签。如需恢复，请使用"恢复最近清空备份"。`);
}

async function restoreClearBackup() {
  const ok = window.confirm("将用最近一次清空前的备份覆盖当前本地书签，是否继续？");
  if (!ok) {
    setStatus("已取消恢复。");
    return;
  }

  setStatus("正在恢复清空备份...", false, { autoHide: false });
  const result = await send(Actions.RESTORE_CLEAR_BACKUP);
  setStatus(`已恢复清空备份（备份时间: ${new Date(result.backupAt).toLocaleString()}）。`);
}

// 全局开关不属于任何平台，切换平台时不得回滚用户未保存的修改。
const GLOBAL_TOGGLE_KEYS = [
  "autoSyncEnabled",
  "changeSyncEnabled",
  "checkRemoteOnStartup",
  "notifyOnAutoSyncError",
  "notifyOnAutoSyncSuccess",
  "notifyOnManualDone"
];
const GLOBAL_VALUE_KEYS = ["autoSyncIntervalMinutes", "changeSyncDebounceSeconds"];

function captureGlobalFields() {
  const state = {};
  for (const key of GLOBAL_TOGGLE_KEYS) {
    state[key] = fields[key].checked;
  }
  for (const key of GLOBAL_VALUE_KEYS) {
    state[key] = fields[key].value;
  }
  return state;
}

function restoreGlobalFields(state) {
  for (const key of GLOBAL_TOGGLE_KEYS) {
    fields[key].checked = state[key];
  }
  for (const key of GLOBAL_VALUE_KEYS) {
    fields[key].value = state[key];
  }
}

async function switchProvider() {
  scopedDrafts[activeProvider] = readScopedInputs(activeProvider);
  const globals = captureGlobalFields();

  const config = await send(Actions.GET_CONFIG);
  config.provider = fields.provider.value;
  render(config);
  restoreGlobalFields(globals);
}

// ---- 绑定与启动 ----

function bindEvents() {
  bindProviderSelect();
  fields.tokenVisibilityBtn.addEventListener("click", toggleTokenVisibility);
  fields.autoSyncIntervalMinutes.addEventListener("change", normalizeIntervalInput);
  fields.autoSyncIntervalMinutes.addEventListener("blur", normalizeIntervalInput);
  fields.changeSyncDebounceSeconds.addEventListener("change", normalizeDebounceInput);
  fields.changeSyncDebounceSeconds.addEventListener("blur", normalizeDebounceInput);
  document.getElementById("saveBtn").addEventListener("click", () => run(save));
  document.getElementById("testBtn").addEventListener("click", () => run(testConnection));
  document.getElementById("exportBookmarksBtn").addEventListener("click", () => run(exportBookmarks));
  document.getElementById("importBookmarksBtn").addEventListener("click", importBookmarksClick);
  document.getElementById("importBookmarksInput").addEventListener("change", (event) => run(() => importBookmarksFile(event)));
  document.getElementById("exportConfigBtn").addEventListener("click", () => run(exportConfig));
  document.getElementById("importConfigBtn").addEventListener("click", importConfigClick);
  document.getElementById("importConfigInput").addEventListener("change", (event) => run(() => importConfigFile(event)));
  document.getElementById("clearBookmarksBtn").addEventListener("click", () => run(clearLocalBookmarks));
  document.getElementById("restoreClearBtn").addEventListener("click", () => run(restoreClearBackup));
  // 平台切换不走 run() 重入门闩：若被门闩拦下，下拉框的值已变而表单
  // 未跟随，会造成"gist 界面显示 github 字段"的错位保存。切换本身只读。
  fields.provider.addEventListener("change", () => {
    switchProvider().catch((error) => {
      setStatus(error.message || String(error), true);
    });
  });

  // Gist 首推自动创建后，引擎会把新 gistId 写回存储；若设置页仍开着，
  // 表单里还是空值，下一次保存会把它抹掉——监听存储变化实时回填。
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.syncConfig) {
      return;
    }
    const nextConfig = changes.syncConfig.newValue;
    const createdGistId = nextConfig?.gist?.gistId;
    if (!createdGistId || !fields.gistId || fields.gistId.value.trim()) {
      return;
    }
    fields.gistId.value = createdGistId;
    if (scopedDrafts.gist && !scopedDrafts.gist.gistId) {
      scopedDrafts.gist.gistId = createdGistId;
    }
    if (fields.provider.value === "gist") {
      updateHistoryLink(nextConfig, "gist");
    }
  });

  const dirtyInputs = [fields.token, fields.owner, fields.repo, fields.branch, fields.path, fields.gistId, fields.fileName];
  for (const input of dirtyInputs) {
    input.addEventListener("input", markDirty);
  }
  const dirtyToggles = [
    fields.autoSyncEnabled,
    fields.changeSyncEnabled,
    fields.checkRemoteOnStartup,
    fields.notifyOnAutoSyncError,
    fields.notifyOnAutoSyncSuccess,
    fields.notifyOnManualDone
  ];
  for (const toggle of dirtyToggles) {
    toggle.addEventListener("change", markDirty);
  }
  fields.autoSyncIntervalMinutes.addEventListener("input", markDirty);
  fields.autoSyncIntervalMinutes.addEventListener("change", markDirty);
  fields.changeSyncDebounceSeconds.addEventListener("input", markDirty);
  fields.changeSyncDebounceSeconds.addEventListener("change", markDirty);
  document.getElementById("statusCloseBtn").addEventListener("click", hideStatus);
}

let actionRunning = false;

async function run(fn) {
  // 动作执行期间禁止重入：清空/导入等破坏性操作被双击二次触发时，
  // 第二次会用已清空的书签树覆盖掉扩展内备份。
  if (actionRunning) {
    return;
  }
  actionRunning = true;
  try {
    await fn();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    actionRunning = false;
  }
}

async function init() {
  populateProviderControls();
  bindEvents();
  await run(load);
}

init();
