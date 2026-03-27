class ActionError extends Error {
  constructor(payload) {
    if (typeof payload === "string") {
      super(payload || "请求失败");
      this.code = "";
      this.details = null;
      return;
    }

    super(payload?.message || "请求失败");
    this.code = payload?.code || "";
    this.details = payload?.details || null;
  }
}

const PROVIDER_LABELS = {
  github: "GitHub",
  gitee: "Gitee"
};
const PROVIDER_REQUIRED_FIELDS = ["token", "owner", "repo", "branch", "path"];
const NO_PROVIDER_MESSAGE = "未检测到已配置平台，请先打开设置完成平台配置。";

let isRunning = false;
let availableProviders = [];
let currentConfig = null;
let refreshCountPending = 0;
let readyForEntryRefresh = false;
let lastEntryRefreshAt = 0;
const ENTRY_REFRESH_DEBOUNCE_MS = 500;

async function sendMessage(action, extra = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.ok) {
    throw new ActionError(response?.error || "请求失败");
  }
  return response.data;
}

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, isError = false) {
  const status = $("status");
  const text = typeof message === "string" ? message.trim() : String(message || "");
  if (!text) {
    status.textContent = "";
    status.classList.add("hidden");
    return;
  }

  status.textContent = text;
  status.style.color = isError ? "#b42318" : "#1a1e24";
  status.classList.remove("hidden");
}

function setCountRefreshUiLoading(isLoading) {
  const indicator = $("countRefreshIndicator");
  const counts = $("counts");
  if (!indicator || !counts) {
    return;
  }
  indicator.classList.toggle("hidden", !isLoading);
  counts.classList.toggle("hidden", isLoading);
}

function beginCountRefresh() {
  refreshCountPending += 1;
  setCountRefreshUiLoading(true);
}

function endCountRefresh() {
  refreshCountPending = Math.max(0, refreshCountPending - 1);
  if (refreshCountPending === 0) {
    setCountRefreshUiLoading(false);
  }
}

async function withCountRefresh(task) {
  beginCountRefresh();
  try {
    return await task();
  } finally {
    endCountRefresh();
  }
}

function shouldRunEntryRefresh() {
  const now = Date.now();
  if (now - lastEntryRefreshAt < ENTRY_REFRESH_DEBOUNCE_MS) {
    return false;
  }
  lastEntryRefreshAt = now;
  return true;
}

function triggerEntryRefresh() {
  if (!readyForEntryRefresh) {
    return;
  }
  if (document.visibilityState !== "visible") {
    return;
  }
  if (!shouldRunEntryRefresh()) {
    return;
  }
  run(async () => {
    await refreshSyncSummary();
  });
}

function isPushAllMode() {
  return Boolean($("pushTargetAll")?.checked);
}

function setActionBusy(busy) {
  const pushBtn = $("pushBtn");
  if (pushBtn) {
    pushBtn.disabled = busy || availableProviders.length === 0;
  }

  const pullBtn = $("pullBtn");
  if (pullBtn) {
    pullBtn.disabled = busy || availableProviders.length === 0;
  }

  const pullProvider = $("pullProvider");
  if (pullProvider) {
    pullProvider.disabled = busy || availableProviders.length <= 1;
  }

  const pushProvider = $("pushProvider");
  if (pushProvider) {
    pushProvider.disabled = busy || availableProviders.length <= 1 || isPushAllMode();
  }

  for (const id of ["pushTargetCurrent", "pushTargetAll"]) {
    const radio = $(id);
    if (radio) {
      radio.disabled = busy || availableProviders.length <= 1;
    }
  }
}

function isProviderConfigured(config, provider) {
  const scoped = config?.[provider];
  if (!scoped || typeof scoped !== "object") {
    return false;
  }

  return PROVIDER_REQUIRED_FIELDS.every((field) => {
    const value = scoped[field];
    return typeof value === "string" && value.trim();
  });
}

function getConfiguredProviders(config) {
  return Object.keys(PROVIDER_LABELS).filter((provider) => isProviderConfigured(config, provider));
}

function renderProviderOptions({ selectId, preferredProvider = "", emptyLabel = "无已配置平台" }) {
  const select = $(selectId);
  if (!select) {
    return "";
  }

  select.textContent = "";

  if (availableProviders.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.appendChild(option);
    return "";
  }

  for (const provider of availableProviders) {
    const option = document.createElement("option");
    option.value = provider;
    option.textContent = PROVIDER_LABELS[provider] || provider;
    select.appendChild(option);
  }

  const defaultProvider = availableProviders.includes(preferredProvider) ? preferredProvider : availableProviders[0];
  select.value = defaultProvider;
  return defaultProvider;
}

function setPushTargetFromConfig(syncAllProviders) {
  const syncAll = Boolean(syncAllProviders);
  $("pushTargetAll").checked = syncAll;
  $("pushTargetCurrent").checked = !syncAll;
}

function syncPushModeUi() {
  const pushAll = isPushAllMode();
  $("pushProviderField")?.classList.toggle("hidden", pushAll);

  const pushBtn = $("pushBtn");
  if (pushBtn) {
    pushBtn.textContent = pushAll ? "推送到全部平台" : "推送本地到云端";
  }

  setActionBusy(isRunning);
}

function renderSyncControls(config) {
  currentConfig = config;
  availableProviders = getConfiguredProviders(config);

  const preferredPull = $("pullProvider")?.value || config.provider || "";
  const preferredPush = $("pushProvider")?.value || config.provider || "";

  renderProviderOptions({ selectId: "pullProvider", preferredProvider: preferredPull });
  renderProviderOptions({ selectId: "pushProvider", preferredProvider: preferredPush });

  setPushTargetFromConfig(config.syncAllProviders);
  syncPushModeUi();

  if (availableProviders.length === 0) {
    setStatus(NO_PROVIDER_MESSAGE, true);
    return;
  }

  const currentStatus = $("status")?.textContent?.trim() || "";
  if (currentStatus === NO_PROVIDER_MESSAGE) {
    setStatus("");
  }
}

async function loadSyncControls() {
  const config = await sendMessage("getConfig");
  renderSyncControls(config);
}

function getSelectedProvider(selectId) {
  const selected = $(selectId)?.value || "";
  if (availableProviders.includes(selected)) {
    return selected;
  }
  return availableProviders[0] || "";
}

async function persistPushTargetMode() {
  const nextSyncAll = isPushAllMode();
  const latestConfig = await sendMessage("getConfig");
  currentConfig = latestConfig;

  if (Boolean(latestConfig.syncAllProviders) === nextSyncAll) {
    return;
  }

  const nextConfig = {
    ...latestConfig,
    syncAllProviders: nextSyncAll
  };
  const saved = await sendMessage("saveConfig", { config: nextConfig });
  currentConfig = saved;
}

function clearConflictPreview() {
  const box = $("conflictPreview");
  box.textContent = "";
  box.classList.add("hidden");
}

function formatTypeName(type) {
  if (type === "both_changed") {
    return "本地和远端均有变更";
  }
  if (type === "remote_changed") {
    return "远端已更新";
  }
  if (type === "local_changed") {
    return "本地有未同步改动";
  }
  if (type === "no_base_diverged") {
    return "首次同步且内容不一致";
  }
  if (type === "remote_deleted") {
    return "远端文件被删除";
  }
  if (type === "remote_deleted_and_local_changed") {
    return "远端被删除且本地有新改动";
  }
  return "检测到冲突";
}

function renderConflictPreview(error) {
  const box = $("conflictPreview");
  const details = error?.details || {};
  const preview = details.preview;

  const lines = ["冲突详情预览", `类型: ${formatTypeName(details.type)}`];
  if (preview) {
    lines.push(`本地: 书签 ${preview.local.bookmarks} / 文件夹 ${preview.local.folders} / 总计 ${preview.local.total}`);
    lines.push(`远端: 书签 ${preview.remote.bookmarks} / 文件夹 ${preview.remote.folders} / 总计 ${preview.remote.total}`);
    lines.push(`仅本地: ${preview.onlyLocalTotal} 条`);
    lines.push(`仅远端: ${preview.onlyRemoteTotal} 条`);

    const localSamples = preview.samples?.onlyLocal || [];
    const remoteSamples = preview.samples?.onlyRemote || [];

    if (localSamples.length > 0) {
      lines.push("\n仅本地样例:");
      for (const item of localSamples) {
        lines.push(`+ ${item}`);
      }
    }

    if (remoteSamples.length > 0) {
      lines.push("\n仅远端样例:");
      for (const item of remoteSamples) {
        lines.push(`- ${item}`);
      }
    }
  }

  box.textContent = lines.join("\n");
  box.classList.remove("hidden");
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

function formatLastSync(lastSync) {
  if (!lastSync) {
    return "无";
  }
  const base = `${formatTime(lastSync.at)} (${lastSync.direction || "manual"}, ${lastSync.provider || "-"})`;
  if (lastSync.noop) {
    return `${base} [无变化]`;
  }
  if (lastSync.force) {
    return `${base} [强制]`;
  }
  return base;
}

async function refreshLastSync() {
  const lastSync = await sendMessage("getLastSync");
  $("lastSync").textContent = `最近同步: ${formatLastSync(lastSync)}`;
}

function formatCount(value) {
  return Number.isFinite(value) ? String(value) : "--";
}

function setCountNodeValue(node, valueText, tooltip = "") {
  if (!node) {
    return;
  }

  node.textContent = valueText;
  const titleText = typeof tooltip === "string" ? tooltip.trim() : "";
  if (titleText) {
    node.title = titleText;
  } else {
    node.removeAttribute("title");
  }

  const chip = node.closest(".count-chip");
  if (!chip) {
    return;
  }
  if (titleText) {
    chip.title = titleText;
  } else {
    chip.removeAttribute("title");
  }
}

function toCompactRemoteStatus(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    return "--";
  }

  if (text.includes("未配置")) {
    return "未配";
  }
  if (text.includes("暂无快照")) {
    return "暂无";
  }
  if (text.includes("超时")) {
    return "超时";
  }
  return "异常";
}

function renderProviderBookmarkCount(provider, remoteData) {
  const node = $(`${provider}BookmarkCount`);
  if (!node) {
    return;
  }

  const label = PROVIDER_LABELS[provider] || provider;

  if (Number.isFinite(remoteData?.bookmarks)) {
    setCountNodeValue(node, String(remoteData.bookmarks), `${label} 云端书签: ${remoteData.bookmarks} 条`);
    return;
  }

  const shortStatus = toCompactRemoteStatus(remoteData?.message);
  const tooltip = typeof remoteData?.message === "string" ? `${label}: ${remoteData.message}` : `${label}: 未知状态`;
  setCountNodeValue(node, shortStatus, tooltip);
}

function renderBookmarkCounts(counts) {
  const localNode = $("localBookmarkCount");
  const localValue = formatCount(counts?.localBookmarks);
  setCountNodeValue(localNode, localValue, Number.isFinite(counts?.localBookmarks) ? `本地书签: ${counts.localBookmarks} 条` : "");

  const remotes = counts?.remotes || {};
  for (const provider of Object.keys(PROVIDER_LABELS)) {
    renderProviderBookmarkCount(provider, remotes[provider] || null);
  }
}

async function refreshBookmarkCounts() {
  return withCountRefresh(async () => {
    const counts = await sendMessage("getBookmarkCounts");
    renderBookmarkCounts(counts);
    return counts;
  });
}

async function refreshSyncSummary() {
  return withCountRefresh(async () => {
    const [lastSync, counts] = await Promise.all([sendMessage("getLastSync"), sendMessage("getBookmarkCounts")]);
    $("lastSync").textContent = `最近同步: ${formatLastSync(lastSync)}`;
    renderBookmarkCounts(counts);
    return { lastSync, counts };
  });
}

function isConflictError(error) {
  return error?.code === "SYNC_CONFLICT";
}

function buildConflictMessage(error, suffix) {
  const summary = error?.details?.summary || error?.message || "检测到冲突";
  return `${summary}\n\n已在下方显示差异预览。\n${suffix}`;
}

function formatProviderCountDelta(provider, beforeCounts, afterCounts) {
  const label = PROVIDER_LABELS[provider] || provider;
  const before = beforeCounts?.remotes?.[provider]?.bookmarks;
  const after = afterCounts?.remotes?.[provider]?.bookmarks;
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return `${label} 书签数已刷新`;
  }
  return `${label} 书签数 ${before} -> ${after}`;
}

function buildPushSuccessMessage({ pushAll, provider, force, result, beforeCounts, afterCounts }) {
  if (pushAll) {
    if (result?.noop) {
      return "所有平台均已同步，无需推送";
    }

    const parts = availableProviders.map((item) => formatProviderCountDelta(item, beforeCounts, afterCounts));
    return force ? `强制推送到所有平台完成（${parts.join("；")}）` : `已推送到所有平台（${parts.join("；")}）`;
  }

  const label = PROVIDER_LABELS[provider] || provider;
  if (result?.noop) {
    return `${label} 已同步，无需推送`;
  }

  const delta = formatProviderCountDelta(provider, beforeCounts, afterCounts);
  return force ? `${label} 强制推送完成（${delta}）` : `${label} 推送完成（${delta}）`;
}

async function onPush() {
  if (availableProviders.length === 0) {
    throw new Error(NO_PROVIDER_MESSAGE);
  }

  const pushAll = isPushAllMode();
  const provider = getSelectedProvider("pushProvider");
  if (!pushAll && !provider) {
    throw new Error("未找到可用推送平台，请先在设置完成至少一个平台配置");
  }

  await persistPushTargetMode();

  clearConflictPreview();
  const beforeCounts = await sendMessage("getBookmarkCounts");
  if (pushAll) {
    setStatus("正在推送到所有已配置平台...");
  } else {
    setStatus(`正在推送到 ${PROVIDER_LABELS[provider] || provider}...`);
  }

  const payload = pushAll ? { syncAllProviders: true } : { provider, syncAllProviders: false };

  try {
    const result = await sendMessage("pushToRemote", payload);
    const { counts: afterCounts } = await refreshSyncSummary();
    setStatus(
      buildPushSuccessMessage({
        pushAll,
        provider,
        force: false,
        result,
        beforeCounts,
        afterCounts
      })
    );
  } catch (error) {
    if (!isConflictError(error)) {
      throw error;
    }

    renderConflictPreview(error);
    const ok = window.confirm(buildConflictMessage(error, "是否强制推送并覆盖远端内容？"));
    if (!ok) {
      setStatus("检测到冲突，已取消推送", true);
      return;
    }

    setStatus(pushAll ? "正在强制推送到所有平台..." : "正在强制推送...");
    const result = await sendMessage("pushToRemote", {
      ...payload,
      force: true
    });
    clearConflictPreview();

    const { counts: afterCounts } = await refreshSyncSummary();
    setStatus(
      buildPushSuccessMessage({
        pushAll,
        provider,
        force: true,
        result,
        beforeCounts,
        afterCounts
      })
    );
  }
}

async function onPull() {
  if (availableProviders.length === 0) {
    throw new Error(NO_PROVIDER_MESSAGE);
  }

  const provider = getSelectedProvider("pullProvider");
  if (!provider) {
    throw new Error("未找到可用拉取平台，请先在设置完成至少一个平台配置");
  }

  clearConflictPreview();
  setStatus(`正在从 ${PROVIDER_LABELS[provider] || provider} 拉取并导入...`);
  try {
    const result = await sendMessage("pullFromRemote", { provider });
    setStatus(result?.noop ? "已是最新，无需覆盖" : "拉取并导入完成");
    await refreshSyncSummary();
  } catch (error) {
    if (!isConflictError(error)) {
      throw error;
    }

    renderConflictPreview(error);
    const ok = window.confirm(buildConflictMessage(error, "是否强制拉取并覆盖本地书签？"));
    if (!ok) {
      setStatus("检测到冲突，已取消拉取", true);
      return;
    }

    setStatus("正在强制拉取...");
    const result = await sendMessage("pullFromRemote", { force: true, provider });
    clearConflictPreview();
    setStatus(result?.noop ? "已是最新，无需覆盖" : "强制拉取完成");
    await refreshSyncSummary();
  }
}

function onPushTargetChanged() {
  syncPushModeUi();
  run(async () => {
    await persistPushTargetMode();
    setStatus("推送目标已保存");
  });
}

function bindEvents() {
  $("pushBtn").addEventListener("click", () => run(onPush));
  $("pullBtn").addEventListener("click", () => run(onPull));
  $("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("pushTargetCurrent").addEventListener("change", onPushTargetChanged);
  $("pushTargetAll").addEventListener("change", onPushTargetChanged);
  window.addEventListener("focus", triggerEntryRefresh);
  window.addEventListener("pageshow", triggerEntryRefresh);
  document.addEventListener("visibilitychange", triggerEntryRefresh);
}

async function run(fn) {
  if (isRunning) {
    setStatus("已有操作进行中，请稍候");
    return;
  }

  isRunning = true;
  setActionBusy(true);
  try {
    await fn();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    isRunning = false;
    setActionBusy(false);
  }
}

async function init() {
  bindEvents();
  clearConflictPreview();
  await run(async () => {
    await loadSyncControls();
  });
  await run(async () => {
    await refreshSyncSummary();
  });
  readyForEntryRefresh = true;
}

init();
