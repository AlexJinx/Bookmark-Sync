import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_IDS, createProviderClient } from "../src/providers/registry.js";
import { migrateConfig, getConfiguredProviders } from "../src/core/config.js";
import { createConfigExportPayload } from "../src/config-export.js";

const repo = { token: "test", owner: "owner", repo: "repo", branch: "main", path: "snapshot.json" };

test("only GitHub and Gitee repositories are registered", () => {
  assert.deepEqual(PROVIDER_IDS, ["github", "gitee"]);
  assert.throws(() => createProviderClient({ provider: "gist", gist: { token: "test" } }), /未知 provider/);
  assert.deepEqual(getConfiguredProviders({ github: repo, gitee: repo, gist: { token: "test", fileName: "bookmarks.json" } }), ["github", "gitee"]);
});

test("retired default platform cannot redirect automatic pushes", () => {
  const original = { provider: "gist", gist: { token: "retired-secret" }, github: repo, autoSyncEnabled: true, syncAllProviders: true, changeSync: { enabled: true, debounceSeconds: 90 } };
  const migrated = migrateConfig(original);
  assert.equal(migrated.provider, "github");
  assert.equal(migrated.autoSyncEnabled, false);
  assert.equal(migrated.changeSync.enabled, false);
  assert.equal(migrated.syncAllProviders, false);
  assert.equal(migrated.changeSync.debounceSeconds, 90);
  assert.equal(migrated.gist, undefined);
  assert.deepEqual(migrated.github, repo);
  assert.equal(original.gist.token, "retired-secret");
  assert.equal(migrateConfig({ provider: "gist", changeSync: null }).changeSync.enabled, false);
});

test("repository preferences survive migration and retired credentials never export", () => {
  const original = { provider: "gitee", gitee: repo, gist: { token: "retired-secret" }, autoSyncEnabled: true, changeSync: { enabled: true }, syncAllProviders: true };
  const migrated = migrateConfig(original);
  assert.equal(migrated.provider, "gitee");
  assert.equal(migrated.autoSyncEnabled, true);
  assert.equal(migrated.changeSync.enabled, true);
  assert.equal(migrated.syncAllProviders, true);
  for (const includeTokens of [true, false]) {
    const payload = createConfigExportPayload(original, { includeTokens });
    assert.equal(payload.config.gist, undefined);
    assert.ok(!JSON.stringify(payload).includes("retired-secret"));
  }
});
