import { Actions, RemoteStatus } from "../../core/actions.js";
import { getConfiguredProviders } from "../../core/config.js";
import { PROVIDERS, getProviderLabel } from "../../providers/registry.js";
import { send, isConflictError } from "../shared/messaging.js";

const NO_PROVIDER_MESSAGE = "未检测到已配置平台，请先打开设置完成平台配置。";

let isRunning = false;
let availableProviders = [];
let currentConfig = null;
let refreshCountPending = 0;
let readyForEntryRefresh = false;
let lastEntryRefreshAt = 0;
const ENTRY_REFRESH_DEBOUNCE_MS = 500;

function $(id) {
  return document.getElementById(id);
}

// ---- 状态提示 ----

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

function setSyncDot(state) {
  const dot = $("syncDot");
  if (dot) {
    dot.dataset.state = state || "idle";
  }
}

// ---- 数量刷新 ----

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

// ---- 控件渲染（registry 驱动） ----

function renderCountChips() {
  const counts = $("counts");
  counts.textContent = "";

  const makeChip = (tag, valueId, tooltip) => {
    const chip = document.createElement("p");
    chip.className = "count-chip";
    chip.title = tooltip;

    const tagNode = document.createElement("span");
    tagNode.className = "count-tag";
    tagNode.textContent = tag;

    const valueNode = document.createElement("span");
    valueNode.id = valueId;
    valueNode.className = "count-value";
    valueNode.textContent = "--";

    chip.append(tagNode, valueNode);
    return chip;
  };

  counts.appendChild(makeChip("本地", "localBookmarkCount", "本地书签数量"));
  for (const provider of availableProviders) {
    const label = getProviderLabel(provider);
    counts.appendChild(makeChip(label, `${provider}BookmarkCount`, `${label} 云端书签数量`));
  }
}

function getDefaultProvider() {
  const selected = $("defaultProvider")?.value || "";
  if (availableProviders.includes(selected)) {
    return selected;
  }
  if (availableProviders.includes(currentConfig?.provider)) {
    return currentConfig.provider;
  }
  return availableProviders[0] || "";
}

function isPushAllMode() {
  return Boolean($("pushAllChk")?.checked);
}

function updateTargetHints() {
  const provider = getDefaultProvider();
  const label = getProviderLabel(provider);
  const pushHint = $("pushTargetHint");
  const pullHint = $("pullTargetHint");

  if (pushHint) {
    pushHint.textContent = isPushAllMode() ? "推送目标：全部已配置平台" : `推送目标：${label}`;
  }
  if (pullHint) {
    pullHint.textContent = `拉取来源：${label}`;
  }
}

function updateHistoryLink() {
  const link = $("historyLink");
  if (!link) {
    return;
  }

  const provider = getDefaultProvider();
  const meta = PROVIDERS[provider];
  const scoped = currentConfig?.[provider] || {};
  const url = meta?.historyUrl?.(scoped) || "";

  link.classList.toggle("hidden", !url);
  if (url) {
    link.href = url;
  }
}

function renderProviderSelect() {
  const select = $("defaultProvider");
  if (!select) {
    return;
  }

  const preferred = select.value || currentConfig?.provider || "";
  select.textContent = "";

  for (const provider of availableProviders) {
    const option = document.createElement("option");
    option.value = provider;
    option.textContent = getProviderLabel(provider);
    select.appendChild(option);
  }

  select.value = availableProviders.includes(preferred) ? preferred : availableProviders[0] || "";
}

function setActionBusy(busy) {
  const disabled = busy || availableProviders.length === 0;
  for (const id of ["pushBtn", "pullBtn"]) {
    const btn = $(id);
    if (btn) {
      btn.disabled = disabled;
    }
  }

  const select = $("defaultProvider");
  if (select) {
    select.disabled = busy;
  }
  const chk = $("pushAllChk");
  if (chk) {
    chk.disabled = busy;
  }
}

function renderSyncControls(config) {
  currentConfig = config;
  availableProviders = getConfiguredProviders(config);

  renderCountChips();
  renderProviderSelect();

  $("pushAllChk").checked = Boolean(config.syncAllProviders);

  // BookmarkHub 式零配置体验：只有一个平台时隐藏全部高级选项。
  $("advanced").classList.toggle("hidden", availableProviders.length <= 1);

  updateTargetHints();
  updateHistoryLink();
  setActionBusy(isRunning);

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
  const config = await send(Actions.GET_CONFIG);
  renderSyncControls(config);
}

// ---- 冲突预览 ----

function clearConflictPreview() {
  const box = $("conflictPreview");
  box.textContent = "";
  box.classList.add("hidden");
}

const CONFLICT_TYPE_NAMES = {
  both_changed: "本地和远端均有变更",
  remote_changed: "远端已更新",
  local_changed: "本地有未同步改动",
  no_base_diverged: "首次同步且内容不一致",
  remote_deleted: "远端文件被删除",
  remote_deleted_and_local_changed: "远端被删除且本地有新改动",
  remote_deleted_during_update: "远端文件在推送过程中被删除"
};

function formatTypeName(type) {
  return CONFLICT_TYPE_NAMES[type] || "检测到冲突";
}

function formatDiffSample(sample) {
  if (!sample || typeof sample !== "object") {
    return String(sample || "");
  }
  if (sample.kind === "bookmark") {
    return `[书签] ${sample.path} -> ${sample.url}`;
  }
  return `[文件夹] ${sample.path}`;
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
        lines.push(`+ ${formatDiffSample(item)}`);
      }
    }

    if (remoteSamples.length > 0) {
      lines.push("\n仅远端样例:");
      for (const item of remoteSamples) {
        lines.push(`- ${formatDiffSample(item)}`);
      }
    }
  }

  box.textContent = lines.join("\n");
  box.classList.remove("hidden");
}

// ---- 摘要刷新 ----

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

function formatLastSyncProvider(lastSync) {
  if (Array.isArray(lastSync.providers) && lastSync.providers.length > 0) {
    return lastSync.providers.map((id) => getProviderLabel(id)).join("、");
  }
  return getProviderLabel(lastSync.provider || "-");
}

function formatLastSync(lastSync) {
  if (!lastSync) {
    return "无";
  }
  const base = `${formatTime(lastSync.at)} (${lastSync.direction || "manual"}, ${formatLastSyncProvider(lastSync)})`;
  if (lastSync.noop) {
    return `${base} [无变化]`;
  }
  if (lastSync.force) {
    return `${base} [强制]`;
  }
  return base;
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
  const chip = node.closest(".count-chip");

  if (titleText) {
    node.title = titleText;
    if (chip) {
      chip.title = titleText;
    }
  } else {
    node.removeAttribute("title");
  }
}

const REMOTE_STATUS_SHORT = {
  [RemoteStatus.NOT_CONFIGURED]: "未配",
  [RemoteStatus.NO_SNAPSHOT]: "暂无",
  [RemoteStatus.ERROR]: "异常"
};

const REMOTE_STATUS_TOOLTIP = {
  [RemoteStatus.NOT_CONFIGURED]: "未配置",
  [RemoteStatus.NO_SNAPSHOT]: "远端暂无快照",
  [RemoteStatus.ERROR]: "获取失败"
};

function renderProviderBookmarkCount(provider, remoteData) {
  const node = $(`${provider}BookmarkCount`);
  if (!node) {
    return;
  }

  const label = getProviderLabel(provider);

  if (remoteData?.status === RemoteStatus.OK && Number.isFinite(remoteData?.bookmarks)) {
    setCountNodeValue(node, String(remoteData.bookmarks), `${label} 云端书签: ${remoteData.bookmarks} 条`);
    return;
  }

  const status = remoteData?.status || RemoteStatus.ERROR;
  const short = REMOTE_STATUS_SHORT[status] || "异常";
  const detail = remoteData?.message ? `：${remoteData.message}` : "";
  setCountNodeValue(node, short, `${label}: ${REMOTE_STATUS_TOOLTIP[status] || "未知状态"}${detail}`);
}

function renderBookmarkCounts(counts) {
  const localNode = $("localBookmarkCount");
  const localValue = formatCount(counts?.localBookmarks);
  setCountNodeValue(localNode, localValue, Number.isFinite(counts?.localBookmarks) ? `本地书签: ${counts.localBookmarks} 条` : "");

  const remotes = counts?.remotes || {};
  for (const provider of availableProviders) {
    renderProviderBookmarkCount(provider, remotes[provider] || null);
  }
}

async function refreshSyncSummary() {
  return withCountRefresh(async () => {
    const [lastSync, counts] = await Promise.all([send(Actions.GET_LAST_SYNC), send(Actions.GET_BOOKMARK_COUNTS)]);
    $("lastSync").textContent = `最近同步: ${formatLastSync(lastSync)}`;
    renderBookmarkCounts(counts);
    return { lastSync, counts };
  });
}

async function refreshUiState() {
  try {
    const state = await send(Actions.GET_SYNC_UI_STATE);
    setSyncDot(state?.pendingChangePush ? "pending" : "idle");
  } catch {
    setSyncDot("idle");
  }
}

// ---- 推送 / 拉取 ----

function buildConflictMessage(error, suffix) {
  const summary = error?.details?.summary || error?.message || "检测到冲突";
  return `${summary}\n\n已在下方显示差异预览。\n${suffix}`;
}

function formatProviderCountDelta(provider, beforeCounts, afterCounts) {
  const label = getProviderLabel(provider);
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

  const label = getProviderLabel(provider);
  if (result?.noop) {
    return `${label} 已同步，无需推送`;
  }

  const delta = formatProviderCountDelta(provider, beforeCounts, afterCounts);
  return force ? `${label} 强制推送完成（${delta}）` : `${label} 推送完成（${delta}）`;
}

async function persistTargetSettings() {
  const provider = getDefaultProvider();
  const pushAll = isPushAllMode();
  const latestConfig = await send(Actions.GET_CONFIG);

  const changed = latestConfig.provider !== provider || Boolean(latestConfig.syncAllProviders) !== pushAll;
  if (!changed) {
    currentConfig = latestConfig;
    return;
  }

  const nextConfig = {
    ...latestConfig,
    provider: provider || latestConfig.provider,
    syncAllProviders: pushAll
  };
  currentConfig = await send(Actions.SAVE_CONFIG, { config: nextConfig });
}

async function onPush() {
  if (availableProviders.length === 0) {
    throw new Error(NO_PROVIDER_MESSAGE);
  }

  const pushAll = isPushAllMode();
  const provider = getDefaultProvider();
  if (!pushAll && !provider) {
    throw new Error("未找到可用推送平台，请先在设置完成至少一个平台配置");
  }

  await persistTargetSettings();

  clearConflictPreview();
  const beforeCounts = await send(Actions.GET_BOOKMARK_COUNTS);
  setStatus(pushAll ? "正在推送到所有已配置平台..." : `正在推送到 ${getProviderLabel(provider)}...`);

  const payload = pushAll ? { syncAllProviders: true } : { provider, syncAllProviders: false };

  try {
    const result = await send(Actions.PUSH_TO_REMOTE, payload);
    const { counts: afterCounts } = await refreshSyncSummary();
    setStatus(buildPushSuccessMessage({ pushAll, provider, force: false, result, beforeCounts, afterCounts }));
    setSyncDot("idle");
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
    const result = await send(Actions.PUSH_TO_REMOTE, { ...payload, force: true });
    clearConflictPreview();

    const { counts: afterCounts } = await refreshSyncSummary();
    setStatus(buildPushSuccessMessage({ pushAll, provider, force: true, result, beforeCounts, afterCounts }));
    setSyncDot("idle");
  }
}

async function onPull() {
  if (availableProviders.length === 0) {
    throw new Error(NO_PROVIDER_MESSAGE);
  }

  const provider = getDefaultProvider();
  if (!provider) {
    throw new Error("未找到可用拉取平台，请先在设置完成至少一个平台配置");
  }

  await persistTargetSettings();

  clearConflictPreview();
  setStatus(`正在从 ${getProviderLabel(provider)} 拉取并导入...`);
  try {
    const result = await send(Actions.PULL_FROM_REMOTE, { provider });
    setStatus(result?.noop ? "已是最新，无需覆盖" : "拉取并导入完成");
    await refreshSyncSummary();
    setSyncDot("idle");
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
    const result = await send(Actions.PULL_FROM_REMOTE, { force: true, provider });
    clearConflictPreview();
    setStatus(result?.noop ? "已是最新，无需覆盖" : "强制拉取完成");
    await refreshSyncSummary();
    setSyncDot("idle");
  }
}

function onTargetChanged() {
  updateTargetHints();
  updateHistoryLink();
  run(async () => {
    await persistTargetSettings();
    setStatus("同步目标已保存");
  });
}

// ---- 事件绑定与启动 ----

function bindEvents() {
  $("pushBtn").addEventListener("click", () => run(onPush));
  $("pullBtn").addEventListener("click", () => run(onPull));
  $("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("defaultProvider").addEventListener("change", onTargetChanged);
  $("pushAllChk").addEventListener("change", onTargetChanged);
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
  await refreshUiState();
  await run(async () => {
    await refreshSyncSummary();
  });
  readyForEntryRefresh = true;
}

init();
