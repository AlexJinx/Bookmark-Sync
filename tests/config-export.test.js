import assert from "node:assert/strict";
import test from "node:test";
import { createConfigExportPayload } from "../src/config-export.js";

test("config export includes provider tokens by default without mutating config", () => {
  const config = { github: { token: "test-github" }, gitee: { token: "test-gitee" }, gist: { token: "test-gist" } };
  const payload = createConfigExportPayload(config);
  assert.equal(payload.containsTokens, true);
  assert.deepEqual(payload.config, config);
  payload.config.github.token = "changed";
  assert.equal(config.github.token, "test-github");
});

test("explicit token exclusion remains available", () => {
  const payload = createConfigExportPayload({ github: { token: "test-token" } }, { includeTokens: false });
  assert.equal(payload.containsTokens, false);
  assert.ok(!payload.config.github.token);
});
