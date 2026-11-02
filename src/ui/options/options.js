const fields = {
  provider: document.getElementById("provider"),
  theme: document.getElementById("theme"),
  skin: document.getElementById("skin"),
  token: document.getElementById("token"),
  tokenVisibilityBtn: document.getElementById("tokenVisibilityBtn"),
  owner: document.getElementById("owner"),
  repo: document.getElementById("repo"),
  branch: document.getElementById("branch"),
  path: document.getElementById("path"),
  autoSyncEnabled: document.getElementById("autoSyncEnabled"),
  autoSyncIntervalMinutes: document.getElementById("autoSyncIntervalMinutes")
};

import { CONFIG_EXPORT_TYPE, createConfigExportPayload } from "../../config-export.js";
import { applyProviderDrafts } from "../../config-drafts.js";
import { createAppearanceSaver } from "../shared/appearance-save.js";
import { APPEARANCE_SETTINGS_ENABLED, effectiveAppearance } from "../shared/appearance-policy.js";

const appearanceSaver = createAppearanceSaver(sendMessage);
let appearanceSaveRevision = 0;

async function autoSaveAppearance() {
  if (!APPEARANCE_SETTINGS_ENABLED) return;
  const revision = ++appearanceSaveRevision;
  try {
    await appearanceSaver.save({ theme: fields.theme.value || "auto", skin: currentSkin() });
  } catch (error) {
    if (revision === appearanceSaveRevision) {
      markDirty();
      setStatus(`界面风格自动保存失败：${error.message}，请点击保存设置重试。`, true);
    }
  }
}

const providerUi = {
  tabs: Array.from(document.querySelectorAll(".platform-tab"))
};

const THEME_CHOICES = ["light", "dark", "auto"];
const THEME_LABELS = {
  light: "浅色",
  dark: "深色",
  auto: "跟随系统"
};

const themeUi = {
  switchBtn: document.getElementById("themeSwitch"),
  autoBtn: document.getElementById("themeAutoBtn"),
  hint: document.getElementById("themeHint"),
  media: window.matchMedia("(prefers-color-scheme: dark)")
};

function resolveTheme(choice) {
  if (choice === "auto") {
    return themeUi.media.matches ? "dark" : "light";
  }
  return choice === "dark" ? "dark" : "light";
}

function applyTheme(choice) {
  document.documentElement.dataset.theme = resolveTheme(effectiveAppearance({ theme: choice }).theme);
}

function syncThemeUi(choice) {
  const isDark = resolveTheme(choice) === "dark";
  if (themeUi.switchBtn) {
    themeUi.switchBtn.classList.toggle("is-dark", isDark);
    themeUi.switchBtn.classList.toggle("is-auto", choice === "auto");
    themeUi.switchBtn.setAttribute("aria-label", isDark ? "切换到浅色模式" : "切换到深色模式");
    themeUi.switchBtn.title = isDark ? "切换到浅色模式" : "切换到深色模式";
  }
  if (themeUi.autoBtn) {
    themeUi.autoBtn.setAttribute("aria-pressed", String(choice === "auto"));
  }
  if (themeUi.hint) {
    themeUi.hint.textContent =
      choice === "auto"
        ? `当前跟随系统：${isDark ? "深色" : "浅色"}`
        : `当前主题：${THEME_LABELS[choice] || THEME_LABELS.auto}`;
  }
}

function setThemeValue(choice, { emitChange = false } = {}) {
  if (SKIN_BASE_THEME[currentSkin()]) {
    return;
  }

  const next = THEME_CHOICES.includes(choice) ? choice : "auto";
  const changed = fields.theme.value !== next;
  fields.theme.value = next;
  applyTheme(next);
  syncThemeUi(next);
  if (changed && emitChange) {
    fields.theme.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function bindThemeOptions() {
  const initial = fields.theme.value || "auto";
  applyTheme(initial);
  syncThemeUi(initial);

  themeUi.switchBtn?.addEventListener("click", () => {
    const next = resolveTheme(fields.theme.value) === "dark" ? "light" : "dark";
    setThemeValue(next, { emitChange: true });
  });

  themeUi.autoBtn?.addEventListener("click", () => {
    if (fields.theme.value === "auto") {
      setThemeValue(resolveTheme("auto"), { emitChange: true });
      return;
    }
    setThemeValue("auto", { emitChange: true });
  });

  themeUi.media.addEventListener("change", () => {
    if (fields.theme.value !== "auto" || SKIN_BASE_THEME[currentSkin()]) {
      return;
    }
    applyTheme("auto");
    syncThemeUi("auto");
  });
}

const SKIN_CHOICES = ["default", "aurora", "neon", "brutal"];
const SKIN_LABELS = {
  default: "默认",
  aurora: "极光玻璃",
  neon: "霓虹终端",
  brutal: "纸感硬边"
};
const SKIN_BASE_THEME = {
  default: "",
  aurora: "dark",
  neon: "dark",
  brutal: "light"
};

const skinUi = {
  options: Array.from(document.querySelectorAll("[data-skin-choice]")),
  note: document.getElementById("skinNote")
};

function currentSkin() {
  return SKIN_CHOICES.includes(fields.skin.value) ? fields.skin.value : "default";
}

function syncThemeAvailability(skin) {
  const locked = Boolean(SKIN_BASE_THEME[skin]);
  const tip = locked ? `${SKIN_LABELS[skin]}风格自带明暗，明暗开关已锁定` : "";

  for (const element of [themeUi.switchBtn, themeUi.autoBtn]) {
    if (!element) {
      continue;
    }
    element.disabled = locked;
    if (locked) {
      element.title = tip;
    } else {
      element.title = element.getAttribute("aria-label") || "";
    }
  }

  if (themeUi.autoBtn && !locked) {
    themeUi.autoBtn.title = "跟随系统外观";
  }

  if (skinUi.note) {
    skinUi.note.textContent = locked
      ? `已启用${SKIN_LABELS[skin]}风格，明暗由该风格自带（${
          SKIN_BASE_THEME[skin] === "dark" ? "深色" : "浅色"
        }）。`
      : "当前为默认风格，可使用右上角的明暗开关。";
  }
}

function syncSkinUi(skin) {
  for (const option of skinUi.options) {
    option.setAttribute("aria-checked", String(option.dataset.skinChoice === skin));
  }
}

function applySkinChoice(skin) {
  const saved = SKIN_CHOICES.includes(skin) ? skin : "default";
  const next = effectiveAppearance({ skin: saved }).skin;
  const locked = SKIN_BASE_THEME[next];
  fields.skin.value = saved;
  document.documentElement.dataset.skin = next;

  if (locked) {
    document.documentElement.dataset.theme = locked;
    syncThemeUi(locked);
  } else {
    applyTheme(fields.theme.value || "auto");
    syncThemeUi(fields.theme.value || "auto");
  }

  syncSkinUi(next);
  syncThemeAvailability(next);
}

function bindSkinOptions() {
  if (skinUi.options.length === 0) {
    return;
  }

  applySkinChoice(fields.skin.value || "default");

  for (const option of skinUi.options) {
    option.addEventListener("click", () => {
      const next = option.dataset.skinChoice || "default";
      if (fields.skin.value === next) {
        return;
      }
      applySkinChoice(next);
      fields.skin.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

applyTheme("auto");

const scopedDrafts = {
  github: null,
  gitee: null
};

const PROVIDER_KEYS = ["github", "gitee"];
const PROVIDER_LABELS = {
  github: "GitHub",
  gitee: "Gitee"
};

let activeProvider = fields.provider.value || "github";
let hasUnsavedChanges = false;
let statusHideTimer = null;
let isRunning = false;

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

function setActionBusy(busy) {
  for (const id of [
    "saveBtn",
    "testBtn",
    "exportBookmarksBtn",
    "importBookmarksBtn",
    "exportConfigBtn",
    "importConfigBtn",
    "providerTrigger"
  ]) {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = Boolean(busy);
    }
  }
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
  return PROVIDER_LABELS[value] || value;
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

function normalizeTokenInput(value) {
  return toTrimmedString(value)
    .replace(/^(?:bearer|token)\s+/i, "")
    .replace(/\s+/g, "");
}

function readScopedInputs() {
  return {
    token: normalizeTokenInput(fields.token.value),
    owner: fields.owner.value.trim(),
    repo: fields.repo.value.trim(),
    branch: fields.branch.value.trim(),
    path: fields.path.value.trim()
  };
}

function buildNextConfig(currentConfig) {
  const provider = fields.provider.value;
  const scoped = readScopedInputs();
  return applyProviderDrafts(currentConfig, {
    activeProvider: provider,
    activeDraft: scoped,
    drafts: scopedDrafts,
    providerKeys: PROVIDER_KEYS,
    settings: {
      autoSyncEnabled: fields.autoSyncEnabled.checked,
      autoSyncIntervalMinutes: normalizeIntervalMinutes(fields.autoSyncIntervalMinutes.value),
      theme: fields.theme.value || "auto",
      skin: fields.skin.value || "default"
    }
  });
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
    syncAllProviders: toBoolean(rawConfig.syncAllProviders, Boolean(baseConfig.syncAllProviders)),
    theme: THEME_CHOICES.includes(rawConfig.theme) ? rawConfig.theme : baseConfig.theme,
    skin: SKIN_CHOICES.includes(rawConfig.skin) ? rawConfig.skin : baseConfig.skin
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

function downloadConfig(config, { includeTokens = true } = {}) {
  const manifestVersion = chrome.runtime.getManifest().version || "unknown";
  const payload = createConfigExportPayload(config, {
    includeTokens,
    extensionVersion: manifestVersion
  });
  downloadJsonFile(`bookmark-sync-config-v${manifestVersion}`, payload);
}

function syncProviderUi() {
  const current = fields.provider.value;
  for (const tab of providerUi.tabs) {
    const selected = tab.dataset.provider === current;
    tab.setAttribute("aria-pressed", String(selected));
    tab.classList.toggle("active", selected);
  }
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

function bindProviderTabs() {
  if (providerUi.tabs.length === 0) {
    return;
  }

  syncProviderUi();

  for (const tab of providerUi.tabs) {
    tab.addEventListener("click", () => {
      setProviderValue(tab.dataset.provider || "", { emitChange: true });
    });
  }
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
  fields.theme.value = config.theme || "auto";
  applySkinChoice(config.skin || "default");

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

const PAGE_LABELS = {
  dashboard: "仪表盘",
  timeline: "时光胶囊",
  settings: "基本设置",
  appearance: "外观设置"
};

const overviewState = {
  config: null,
  lastSync: null,
  counts: null
};

const timelineState = {
  page: 1,
  hasNext: false,
  commits: [],
  provider: "",
  selectedSha: "",
  loading: false
};
let timelineRequest = 0;
let detailRequest = 0;

function showPage(page) {
  if (page === "appearance" && !APPEARANCE_SETTINGS_ENABLED) page = "settings";
  if (!PAGE_LABELS[page]) {
    return;
  }

  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.toggle("active", item.dataset.page === page);
  }
  for (const section of document.querySelectorAll(".page")) {
    section.classList.toggle("active", section.id === `page-${page}`);
  }

  if (page === "timeline" && timelineState.commits.length === 0 && !timelineState.loading) {
    void loadTimeline();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindNavigation() {
  window.addEventListener("hashchange", () => {
    showPage(location.hash.slice(1) || "dashboard");
  });
  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target.closest(".nav-item[data-page]") : null;
    if (!element) {
      return;
    }
    showPage(element.dataset.page);
  });
}

function isProviderConfigured(config, provider) {
  const scoped = (config && config[provider]) || {};
  return Boolean(scoped.token && scoped.owner && scoped.repo);
}

function describeRepo(scoped) {
  if (!scoped.owner || !scoped.repo) {
    return "尚未配置";
  }
  return `${scoped.owner}/${scoped.repo} · ${scoped.branch || "main"} · ${scoped.path || "bookmarks/snapshot.json"}`;
}

function setPill(element, text, tone) {
  if (!element) {
    return;
  }
  element.className = `pill ${tone}`;
  element.textContent = text;
}

function setHeroPill(text, tone) {
  const pill = document.getElementById("heroPill");
  if (!pill) {
    return;
  }
  pill.className = `pill ${tone}`;
  pill.innerHTML = `<i class="status-dot"></i>${text}`;
}

function renderLastSync() {
  const lastSync = overviewState.lastSync;
  const label = document.getElementById("lastSync");
  const note = document.getElementById("lastSyncNote");
  const meta = document.getElementById("lastSyncMeta");

  if (!lastSync) {
    if (label) label.textContent = "最近同步: 无";
    if (note) note.textContent = "还没有同步记录，先在弹窗里执行一次推送。";
    if (meta) meta.textContent = "—";
    return;
  }

  const directionLabel = lastSync.direction === "pull" ? "拉取" : "推送";
  const providerLabel = lastSync.provider ? getProviderLabel(lastSync.provider) : "全部平台";

  if (label) label.textContent = `最近同步: ${formatTime(lastSync.at)}`;
  if (note) {
    note.textContent = lastSync.noop
      ? `${directionLabel}完成，远端与本地内容一致，未产生变更。`
      : `${directionLabel}完成，平台 ${providerLabel}。${lastSync.partial ? "部分平台未完成。" : ""}`;
  }
  if (meta) {
    meta.textContent = `${directionLabel} · ${providerLabel}${lastSync.force ? " · 强制模式" : ""}`;
  }
}

function renderOverview() {
  const config = overviewState.config;
  if (!config) {
    return;
  }

  const github = config.github || {};
  const gitee = config.gitee || {};
  const githubReady = isProviderConfigured(config, "github");
  const giteeReady = isProviderConfigured(config, "gitee");
  const readyCount = Number(githubReady) + Number(giteeReady);

  const badge = document.getElementById("connectionBadge");
  if (badge) {
    badge.textContent = readyCount ? `${readyCount} 个平台已配置` : "尚未配置仓库";
  }

  setHeroPill(readyCount ? "同步就绪" : "等待配置", readyCount ? "green" : "warn");
  const heroNote = document.getElementById("heroNote");
  if (heroNote) {
    heroNote.textContent = readyCount
      ? `默认平台为 ${getProviderLabel(config.provider || "github")}，当前 ${readyCount} 个平台已完成配置。`
      : "先在连接配置里填写仓库信息，之后在弹窗中执行推送与拉取。";
  }

  const githubLine = document.getElementById("githubRepoLine");
  if (githubLine) githubLine.textContent = describeRepo(github);
  const giteeLine = document.getElementById("giteeRepoLine");
  if (giteeLine) giteeLine.textContent = describeRepo(gitee);
  setPill(document.getElementById("githubStatusPill"), githubReady ? "已配置" : "未配置", githubReady ? "green" : "neutral");
  setPill(document.getElementById("giteeStatusPill"), giteeReady ? "已配置" : "未配置", giteeReady ? "green" : "neutral");

  const autoMetric = document.getElementById("metricAuto");
  if (autoMetric) {
    autoMetric.textContent = config.autoSyncEnabled
      ? `${normalizeIntervalMinutes(config.autoSyncIntervalMinutes)} 分钟`
      : "已关闭";
    autoMetric.classList.toggle("is-empty", !config.autoSyncEnabled);
  }

  const autoNote = document.getElementById("autoNote");
  if (autoNote) {
    autoNote.textContent = config.autoSyncEnabled
      ? `自动推送已开启，每 ${normalizeIntervalMinutes(config.autoSyncIntervalMinutes)} 分钟一次。`
      : "自动推送尚未开启，只在你手动操作时同步。";
  }

  renderLastSync();
  renderCounts();
}

function renderRemoteMetric(key, item, configured) {
  const cap = key === "github" ? "Github" : "Gitee";
  const value = document.getElementById(`metric${cap}`);
  const note = document.getElementById(`metric${cap}Note`);
  if (!value) {
    return;
  }

  if (!configured) {
    value.textContent = "未配置";
    value.classList.add("is-empty");
    if (note) note.textContent = "尚未填写仓库信息";
    return;
  }

  value.classList.remove("is-empty");
  if (!item || item.bookmarks === null || item.bookmarks === undefined) {
    value.textContent = "--";
    if (note) note.textContent = item?.message || "暂时无法读取云端快照";
    return;
  }

  value.textContent = String(item.bookmarks);
  if (note) note.textContent = "云端快照中的书签数";
}

function renderCounts() {
  const counts = overviewState.counts;
  const local = document.getElementById("metricLocal");
  if (local) {
    if (!counts) {
      local.textContent = "--";
    } else {
      local.textContent = String(counts.localBookmarks ?? 0);
    }
  }

  const config = overviewState.config;
  if (!config) {
    return;
  }

  const remotes = (counts && counts.remotes) || {};
  renderRemoteMetric("github", remotes.github, isProviderConfigured(config, "github"));
  renderRemoteMetric("gitee", remotes.gitee, isProviderConfigured(config, "gitee"));
}

async function loadCounts() {
  try {
    overviewState.counts = await sendMessage("getBookmarkCounts");
  } catch {
    overviewState.counts = null;
  }
  renderCounts();
}

async function load() {
  const [config, lastSync] = await Promise.all([sendMessage("getConfig"), sendMessage("getLastSync")]);
  scopedDrafts.github = null;
  scopedDrafts.gitee = null;
  render(config);
  overviewState.config = config;
  overviewState.lastSync = lastSync || null;
  renderOverview();
  markClean();
}

async function save() {
  await appearanceSaver.flush();
  const current = await sendMessage("getConfig");
  const nextConfig = buildNextConfig(current);
  await sendMessage("saveConfig", { config: nextConfig });

  for (const key of PROVIDER_KEYS) {
    scopedDrafts[key] = null;
  }
  overviewState.config = nextConfig;
  renderOverview();
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
  setStatus("配置已导出，请妥善保管。");
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
  overviewState.config = saved;
  renderOverview();
  void loadCounts();
  setStatus("配置导入并保存完成。");
  markClean();
}

async function switchProvider() {
  scopedDrafts[activeProvider] = readScopedInputs();

  const current = await sendMessage("getConfig");
  if (current.provider !== fields.provider.value) {
    const saved = await sendMessage("saveConfig", { config: { ...current, provider: fields.provider.value } });
    overviewState.config = saved;
    render(saved);
    renderOverview();
  } else {
    render(current);
  }

  resetTimeline();
  if (document.getElementById("page-timeline")?.classList.contains("active")) {
    void loadTimeline();
  }
}

function bindEvents() {
  bindProviderTabs();
  bindThemeOptions();
  bindSkinOptions();
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
  fields.theme.addEventListener("change", autoSaveAppearance);
  fields.skin.addEventListener("change", autoSaveAppearance);
  document.getElementById("statusCloseBtn").addEventListener("click", hideStatus);
}

async function run(fn) {
  if (isRunning) {
    setStatus("已有操作进行中，请稍候。", true);
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

function formatCommitTime(iso) {
  if (!iso) {
    return "未知时间";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }
  return date.toLocaleString();
}

function firstLine(text) {
  const value = typeof text === "string" ? text.trim() : "";
  return value.split("\n")[0] || "(无提交信息)";
}

function shortSha(sha) {
  return String(sha || "").slice(0, 7);
}

function setTimelineState(kind, title, description) {
  const box = document.getElementById("timelineState");
  const list = document.getElementById("timelineList");
  if (!box) {
    return;
  }

  if (!kind) {
    box.classList.add("hidden");
    return;
  }

  box.className = `empty-state${kind === "error" ? " is-error" : ""}`;
  box.innerHTML = "";

  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.textContent = kind === "error" ? "!" : "◷";

  const heading = document.createElement("h4");
  heading.textContent = title;

  box.append(icon, heading);

  if (description) {
    const note = document.createElement("p");
    note.textContent = description;
    box.append(note);
  }

  if (list) {
    list.innerHTML = "";
  }
}

function renderTimeline(result) {
  const list = document.getElementById("timelineList");
  if (!list) {
    return;
  }

  const commits = timelineState.commits;
  timelineState.selectedSha = "";
  renderCommitDetail(null);

  if (commits.length === 0) {
    setTimelineState(
      "empty",
      timelineState.page === 1 ? "还没有提交记录" : "本页没有提交记录",
      timelineState.page === 1 ? "当前快照文件暂无提交历史。" : "云端历史可能已更新，请返回上一页或刷新记录。"
    );
    return;
  }

  setTimelineState(null);
  list.innerHTML = "";

  for (const commit of commits) {
    const item = document.createElement("li");
    item.className = "commit-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "commit-button";
    button.dataset.sha = commit.sha;
    button.setAttribute("aria-current", "false");

    const dot = document.createElement("span");
    dot.className = "commit-dot";
    dot.textContent = "◷";

    const copy = document.createElement("div");
    copy.className = "commit-copy";

    const title = document.createElement("h4");
    title.textContent = firstLine(commit.message);

    const meta = document.createElement("p");
    meta.textContent = `${formatCommitTime(commit.date)} · ${commit.authorName || commit.authorLogin || "未知作者"}`;

    copy.append(title, meta);

    const sha = document.createElement("span");
    sha.className = "commit-sha";
    sha.textContent = shortSha(commit.sha);

    button.append(dot, copy, sha);
    item.append(button);
    list.append(item);
  }

  const note = document.getElementById("timelineProviderNote");
  if (note) {
    note.textContent = `${getProviderLabel(result.provider || timelineState.provider)} · 共 ${commits.length} 条提交，最新在前。`;
  }
}

function buildDetailRow(label, value) {
  const wrap = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

const CHANGE_KINDS = [
  { key: "added", label: "新增", marker: "+" },
  { key: "removed", label: "删除", marker: "−" },
  { key: "changed", label: "变更", marker: "~" }
];

function buildChangeChip(kind, label, total) {
  const chip = document.createElement("span");
  chip.className = `change-chip ${kind}${total === 0 ? " is-zero" : ""}`;
  chip.textContent = `${label} ${total}`;
  return chip;
}

function buildDiffHunk(label, previous, next) {
  const hunk = document.createElement("div");
  hunk.className = "diff-hunk";

  const name = document.createElement("p");
  name.className = "diff-hunk-label";
  name.textContent = label;

  const minus = document.createElement("p");
  minus.className = "diff-line minus";
  minus.textContent = `- ${previous}`;

  const plus = document.createElement("p");
  plus.className = "diff-line plus";
  plus.textContent = `+ ${next}`;

  hunk.append(name, minus, plus);
  return hunk;
}

function buildDiffBody(entry) {
  const body = document.createElement("div");
  body.className = "diff-body hidden";

  if (entry.previousTitle !== entry.title) {
    body.append(buildDiffHunk("标题", entry.previousTitle || "(未命名书签)", entry.title || "(未命名书签)"));
  }
  if (entry.previousPath !== entry.path) {
    body.append(buildDiffHunk("位置", entry.previousPath || "根目录", entry.path || "根目录"));
  }
  if (entry.previousUrl !== entry.url) {
    body.append(buildDiffHunk("地址", entry.previousUrl, entry.url));
  }

  return body;
}

function buildDiffRow(entry, kind, marker) {
  const item = document.createElement("li");
  item.className = `diff-item ${kind}`;

  const expandable = kind === "changed";
  const row = document.createElement(expandable ? "button" : "div");
  row.className = "diff-row";
  if (expandable) {
    row.type = "button";
    row.setAttribute("aria-expanded", "false");
  }

  const badge = document.createElement("span");
  badge.className = `diff-marker ${kind}`;
  badge.textContent = marker;

  const copy = document.createElement("span");
  copy.className = "diff-copy";

  const title = document.createElement("span");
  title.className = "diff-title";
  title.textContent = `${entry.type === "folder" ? "[文件夹] " : ""}${entry.title || entry.url || "(未命名)"}`;

  const meta = document.createElement("span");
  meta.className = "diff-meta";
  meta.textContent = `${entry.path || "根目录"}${entry.url ? ` · ${entry.url}` : ""}`;

  copy.append(title, meta);
  row.append(badge, copy);

  if (expandable) {
    const caret = document.createElement("span");
    caret.className = "diff-caret";
    caret.textContent = "⌄";
    row.append(caret);
  }

  item.append(row);

  if (expandable) {
    item.append(buildDiffBody(entry));
  }

  return item;
}

function renderCommitChanges(changes) {
  const section = document.createElement("section");
  section.className = "detail-changes";

  const head = document.createElement("div");
  head.className = "detail-changes-head";
  const heading = document.createElement("h4");
  heading.textContent = "书签与文件夹变更";
  head.append(heading);
  section.append(head);

  if (!changes || changes.hasComparison === false) {
    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = changes?.message || "无法对比本次提交的书签变化。";
    section.append(note);
    return section;
  }

  head.append(
    buildChangeChip("added", "新增", changes.added?.total || 0),
    buildChangeChip("removed", "删除", changes.removed?.total || 0),
    buildChangeChip("changed", "变更", changes.changed?.total || 0)
  );

  const list = document.createElement("ul");
  list.className = "diff-list";

  for (const kind of CHANGE_KINDS) {
    const group = changes[kind.key];
    if (!group || !group.total) {
      continue;
    }
    for (const entry of group.items || []) {
      list.append(buildDiffRow(entry, kind.key, kind.marker));
    }
  }

  if (list.childElementCount === 0) {
    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = "本次提交没有书签层面的新增、删除或变更。";
    section.append(note);
    return section;
  }

  section.append(list);

  const truncated = CHANGE_KINDS.filter((kind) => changes[kind.key]?.truncated);
  if (truncated.length > 0) {
    const more = document.createElement("p");
    more.className = "change-more";
    more.textContent = truncated
      .map((kind) => `${kind.label}仅显示前 ${changes[kind.key].items.length} 条，共 ${changes[kind.key].total} 条`)
      .join("；");
    section.append(more);
  }

  return section;
}

function renderCommitDetail(detail, state = "empty") {
  const box = document.getElementById("commitDetail");
  if (!box) {
    return;
  }

  box.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = "提交详情";
  box.append(heading);

  if (!detail && state !== "loading") {
    const hint = document.createElement("p");
    hint.className = "commit-detail-hint";
    hint.textContent = "在左侧选择一条提交记录，这里会显示这次提交新增、删除和修改了哪些书签。";
    box.append(hint);
    return;
  }

  if (state === "loading") {
    const hint = document.createElement("p");
    hint.className = "commit-detail-hint";
    hint.textContent = "正在读取提交详情…";
    box.append(hint);
    return;
  }

  const meta = document.createElement("dl");
  meta.className = "detail-meta";
  meta.append(
    buildDetailRow("提交", shortSha(detail.sha)),
    buildDetailRow("作者", detail.authorName || detail.authorLogin || "未知"),
    buildDetailRow("时间", formatCommitTime(detail.date)),
    buildDetailRow("平台", getProviderLabel(detail.provider || timelineState.provider))
  );
  if (detail.stats) {
    meta.append(buildDetailRow("变更", `+${detail.stats.additions} / -${detail.stats.deletions}`));
  }
  box.append(meta);

  const message = document.createElement("p");
  message.className = "detail-message";
  message.textContent = detail.message || "(无提交信息)";
  box.append(message);

  box.append(renderCommitChanges(detail.changes));

  if (detail.files && detail.files.length > 0) {
    const subheading = document.createElement("h4");
    subheading.className = "detail-subheading";
    subheading.textContent = "文件变更";
    box.append(subheading);

    const files = document.createElement("ul");
    files.className = "detail-files";
    for (const file of detail.files) {
      const row = document.createElement("li");
      row.className = "detail-file";

      const name = document.createElement("span");
      name.textContent = file.filename;

      const diff = document.createElement("span");
      diff.className = "detail-diff";
      const plus = document.createElement("b");
      plus.className = "plus";
      plus.textContent = `+${file.additions ?? 0}`;
      const minus = document.createElement("b");
      minus.className = "minus";
      minus.textContent = `-${file.deletions ?? 0}`;
      diff.append(plus, minus);

      row.append(name, diff);
      files.append(row);
    }
    box.append(files);
  } else {
    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = "该平台没有返回文件级变更，仅展示提交信息。";
    box.append(note);
  }
}

async function selectCommit(sha) {
  if (!sha || timelineState.selectedSha === sha) {
    return;
  }

  timelineState.selectedSha = sha;
  const request = ++detailRequest;
  for (const button of document.querySelectorAll(".commit-button")) {
    button.setAttribute("aria-current", String(button.dataset.sha === sha));
  }

  renderCommitDetail(null, "loading");
  try {
    const detail = await sendMessage("getCommitDetail", { provider: timelineState.provider, sha });
    if (request === detailRequest && timelineState.selectedSha === sha) {
      renderCommitDetail(detail);
    }
  } catch (error) {
    if (request !== detailRequest) return;
    renderCommitDetail(null);
    const box = document.getElementById("commitDetail");
    if (box) {
      const note = document.createElement("p");
      note.className = "detail-note";
      note.textContent = error.message || String(error);
      box.append(note);
    }
  }
}

function resetTimeline() {
  timelineState.page = 1;
  timelineState.hasNext = false;
  timelineRequest += 1;
  detailRequest += 1;
  timelineState.commits = [];
  timelineState.selectedSha = "";
  timelineState.loading = false;
  renderCommitDetail(null);
  renderTimelinePagination();
}

function renderTimelinePagination() {
  document.getElementById("timelinePrev").disabled = timelineState.loading || timelineState.page <= 1;
  document.getElementById("timelineNext").disabled = timelineState.loading || !timelineState.hasNext;
  document.getElementById("timelinePage").textContent = `第 ${timelineState.page} 页 · 每页 10 条`;
}

async function loadTimeline() {
  const request = ++timelineRequest;
  detailRequest += 1;
  timelineState.selectedSha = "";
  renderCommitDetail(null);

  const provider = fields.provider.value || "github";

  timelineState.loading = true;
  timelineState.hasNext = false;
  renderTimelinePagination();
  timelineState.provider = provider;
  setTimelineState("empty", "正在读取提交历史…", "提交列表来自你配置的仓库，按时间倒序排列。");

  try {
    const result = await sendMessage("getCommitHistory", { provider, limit: 10, page: timelineState.page });
    if (request !== timelineRequest) return;
    timelineState.commits = result.commits || [];
    timelineState.hasNext = Boolean(result.hasNext);
    if (result.configured === false) {
      setTimelineState("empty", "尚未配置仓库", "先在基本设置里填写该平台的仓库信息，再回来查看提交历史。");
      return;
    }
    renderTimeline(result);
  } catch (error) {
    if (request !== timelineRequest) return;
    timelineState.commits = [];
    setTimelineState("error", "无法读取提交历史", error.message || String(error));
  } finally {
    if (request === timelineRequest) {
      timelineState.loading = false;
      renderTimelinePagination();
    }
  }
}

function bindTimeline() {
  document.getElementById("timelinePrev").addEventListener("click", () => {
    if (timelineState.loading || timelineState.page <= 1) return;
    timelineState.page -= 1;
    void loadTimeline();
  });
  document.getElementById("timelineNext").addEventListener("click", () => {
    if (timelineState.loading || !timelineState.hasNext) return;
    timelineState.page += 1;
    void loadTimeline();
  });
  document.getElementById("timelineRefreshBtn")?.addEventListener("click", () => {
    resetTimeline();
    void loadTimeline();
  });

  document.getElementById("timelineList")?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".commit-button") : null;
    if (button) {
      void selectCommit(button.dataset.sha);
    }
  });

  document.getElementById("commitDetail")?.addEventListener("click", (event) => {
    const row = event.target instanceof Element ? event.target.closest(".diff-row[aria-expanded]") : null;
    if (!row) {
      return;
    }

    const expanded = row.getAttribute("aria-expanded") === "true";
    row.setAttribute("aria-expanded", String(!expanded));
    row.parentElement?.querySelector(".diff-body")?.classList.toggle("hidden", expanded);
  });
}

function renderVersion() {
  const version = chrome.runtime.getManifest().version || "";
  for (const id of ["extVersion", "extVersionFooter"]) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = `v${version}`;
    }
  }
}

async function init() {
  document.querySelector('[data-page="appearance"]').classList.toggle("hidden", !APPEARANCE_SETTINGS_ENABLED);
  document.getElementById("page-appearance").classList.toggle("hidden", !APPEARANCE_SETTINGS_ENABLED);
  bindEvents();
  bindNavigation();
  bindTimeline();
  renderVersion();
  await run(load);
  showPage(location.hash.slice(1) || "dashboard");
  void loadCounts();
}

init();
