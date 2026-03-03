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

let activeProvider = fields.provider.value || "github";

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  const text = typeof message === "string" ? message.trim() : String(message || "");
  if (!text) {
    status.textContent = "";
    status.classList.add("hidden");
    return;
  }

  status.textContent = text;
  status.style.color = isError ? "#b42318" : "#141a22";
  status.classList.remove("hidden");
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
  fields.tokenVisibilityBtn.textContent = isVisible ? "隐藏" : "显示";
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
}

async function save() {
  const current = await sendMessage("getConfig");
  const nextConfig = buildNextConfig(current);
  await sendMessage("saveConfig", { config: nextConfig });

  scopedDrafts[nextConfig.provider] = null;
  setStatus("设置已保存");
}

async function testConnection() {
  const current = await sendMessage("getConfig");
  const nextConfig = buildNextConfig(current);
  const result = await sendMessage("testConnection", { config: nextConfig });
  setStatus(`连接成功: ${result.fullName} (默认分支: ${result.defaultBranch})`);
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
  fields.provider.addEventListener("change", () => run(switchProvider));
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
