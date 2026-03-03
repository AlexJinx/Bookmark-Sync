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

let isRunning = false;

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
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "#1a1e24";
}

function setActionBusy(busy) {
  for (const id of ["pushBtn", "pullBtn", "exportBtn", "importBtn"]) {
    const element = $(id);
    if (element) {
      element.disabled = busy;
    }
  }

  const importInput = $("importInput");
  if (importInput) {
    importInput.disabled = busy;
  }
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

function downloadSnapshot(snapshot) {
  const fileName = `bookmarks-${new Date().toISOString().replace(/[.:]/g, "-")}.json`;
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isConflictError(error) {
  return error?.code === "SYNC_CONFLICT";
}

function buildConflictMessage(error, suffix) {
  const summary = error?.details?.summary || error?.message || "检测到冲突";
  return `${summary}\n\n已在下方显示差异预览。\n${suffix}`;
}

async function onPush() {
  clearConflictPreview();
  setStatus("正在推送...");
  try {
    const result = await sendMessage("pushToRemote");
    setStatus(result?.noop ? "已同步，无需推送" : "推送完成");
    await refreshLastSync();
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

    setStatus("正在强制推送...");
    const result = await sendMessage("pushToRemote", { force: true });
    clearConflictPreview();
    setStatus(result?.noop ? "已同步，无需推送" : "强制推送完成");
    await refreshLastSync();
  }
}

async function onPull() {
  clearConflictPreview();
  setStatus("正在拉取并导入...");
  try {
    const result = await sendMessage("pullFromRemote");
    setStatus(result?.noop ? "已是最新，无需覆盖" : "拉取并导入完成");
    await refreshLastSync();
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
    const result = await sendMessage("pullFromRemote", { force: true });
    clearConflictPreview();
    setStatus(result?.noop ? "已是最新，无需覆盖" : "强制拉取完成");
    await refreshLastSync();
  }
}

async function onExport() {
  clearConflictPreview();
  setStatus("正在导出...");
  const snapshot = await sendMessage("exportLocal");
  downloadSnapshot(snapshot);
  setStatus("导出完成");
}

function onImportClick() {
  if (isRunning) {
    return;
  }
  $("importInput").value = "";
  $("importInput").click();
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  clearConflictPreview();
  setStatus("正在导入...");
  const text = await file.text();
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new Error("JSON 文件格式错误");
  }

  await sendMessage("importLocal", { snapshot });
  setStatus("导入完成");
}

function bindEvents() {
  $("pushBtn").addEventListener("click", () => run(onPush));
  $("pullBtn").addEventListener("click", () => run(onPull));
  $("exportBtn").addEventListener("click", () => run(onExport));
  $("importBtn").addEventListener("click", onImportClick);
  $("importInput").addEventListener("change", (event) => run(() => onImportFile(event)));
  $("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
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
  await run(refreshLastSync);
}

init();
