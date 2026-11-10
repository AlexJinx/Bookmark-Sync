import test from "node:test";
import assert from "node:assert/strict";
import { migrateConfig, isProviderConfigured, getEnabledProviders, getSyncProviders, getDefaultSyncProvider, getSyncTargets } from "../src/core/config.js";
import { createConfigExportPayload } from "../src/config-export.js";
import { applyProviderDrafts } from "../src/config-drafts.js";
import { getVisibleLastSync } from "../src/ui/shared/provider-view.js";
import { getSyncScope } from "../src/background/sync-state.js";

const configured = () => ({ token: "test-token", owner: "owner", repo: "bookmarks", branch: "main", path: "bookmarks.json" });
const both = () => ({ provider: "github", github: configured(), gitee: configured(), syncAllProviders: true });

test("旧配置升级默认启用两个仓库，保留凭据、自动推送和同步 scope", () => {
  const original = both();
  original.autoSyncEnabled = true;
  original.changeSync = { enabled: true, debounceSeconds: 45 };
  const config = migrateConfig(original);
  assert.equal(config.configVersion, 3);
  assert.deepEqual(getEnabledProviders(config), ["github", "gitee"]);
  assert.deepEqual(getSyncTargets(config), ["github", "gitee"]);
  assert.equal(config.autoSyncEnabled, true);
  assert.equal(config.changeSync.enabled, true);
  assert.equal(config.github.token, original.github.token);
  assert.equal(getSyncScope(config), getSyncScope(original));
  assert.equal(original.github.enabled, undefined);
});

test("禁用默认 GitHub 后转向 Gitee，已配置状态与凭据仍保留", () => {
  const original = both();
  original.github.enabled = false;
  const config = migrateConfig(original);
  assert.equal(isProviderConfigured(config, "github"), true);
  assert.deepEqual(getSyncProviders(config), ["gitee"]);
  assert.deepEqual(getSyncTargets(config), ["gitee"]);
  assert.equal(config.provider, "gitee");
  assert.deepEqual(config.github, original.github);
});

test("全部禁用时无默认同步目标，重新启用后恢复原配置", () => {
  const config = migrateConfig(both());
  config.github.enabled = false;
  config.gitee.enabled = false;
  const disabled = migrateConfig(config);
  assert.deepEqual(getEnabledProviders(disabled), []);
  assert.equal(getDefaultSyncProvider(disabled), "");
  assert.deepEqual(getSyncTargets(disabled), []);
  disabled.gitee.enabled = true;
  const enabled = migrateConfig(disabled);
  assert.equal(enabled.provider, "gitee");
  assert.deepEqual(getSyncProviders(enabled), ["gitee"]);
  assert.equal(enabled.gitee.token, config.gitee.token);
});

test("开启但未配置的仓库不会成为默认或全平台推送目标", () => {
  const config = migrateConfig({ github: { enabled: true }, gitee: configured() });
  assert.deepEqual(getEnabledProviders(config), ["github", "gitee"]);
  assert.deepEqual(getSyncTargets(config), ["gitee"]);
  config.gitee.enabled = false;
  assert.deepEqual(getSyncTargets(config), []);
});

test("跨平台编辑草稿保存两个启用开关，不丢失其他平台凭据", () => {
  const current = migrateConfig(both());
  const result = migrateConfig(applyProviderDrafts(current, {
    activeProvider: "gitee",
    activeDraft: { ...current.gitee, enabled: true, repo: "new-gitee" },
    drafts: { github: { ...current.github, enabled: false } },
    providerKeys: ["github", "gitee"],
    settings: { autoSyncEnabled: true }
  }));
  assert.equal(result.github.enabled, false);
  assert.equal(result.github.token, current.github.token);
  assert.equal(result.gitee.enabled, true);
  assert.equal(result.gitee.repo, "new-gitee");
  assert.equal(result.autoSyncEnabled, true);
  assert.equal(result.provider, "gitee");
});

test("配置导出导入保留禁用开关和仓库；去令牌导出仍保留开关", () => {
  const config = migrateConfig(both());
  config.github.enabled = false;
  const exported = createConfigExportPayload(config);
  const imported = migrateConfig(JSON.parse(JSON.stringify(exported)).config);
  assert.equal(imported.github.enabled, false);
  assert.equal(imported.github.token, config.github.token);
  assert.equal(imported.gitee.enabled, true);
  const safeExport = createConfigExportPayload(config, { includeTokens: false }).config;
  assert.equal(safeExport.github.token, undefined);
  assert.equal(safeExport.github.enabled, false);
  assert.equal(safeExport.github.repo, config.github.repo);
});

test("最近同步只展示已启用仓库，保留原始历史记录", () => {
  const config = migrateConfig(both());
  config.github.enabled = false;
  const history = {
    provider: "github,gitee", providers: ["github", "gitee"], noop: false,
    items: [{ provider: "github", noop: false, needsPull: true }, { provider: "gitee", noop: true }],
    failures: [{ provider: "github", message: "failure" }], partial: true
  };
  const visible = getVisibleLastSync(config, history);
  assert.equal(visible.provider, "gitee");
  assert.deepEqual(visible.providers, ["gitee"]);
  assert.equal(visible.noop, true);
  assert.equal(visible.needsPull, false);
  assert.equal(visible.partial, false);
  assert.equal(history.providers.length, 2);
  assert.equal(getVisibleLastSync(config, { provider: "github" }), null);
  config.gitee.enabled = false;
  assert.equal(getVisibleLastSync(config, history), null);
});
