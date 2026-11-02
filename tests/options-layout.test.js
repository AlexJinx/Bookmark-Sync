import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings actions are inline and appearance has its own navigation page", async () => {
  const html = await readFile(new URL("../src/ui/options/options.html", import.meta.url), "utf8");
  const settings = html.slice(html.indexOf('id="page-settings"'), html.indexOf('id="page-appearance"'));
  const appearance = html.slice(html.indexOf('id="page-appearance"'));
  assert.ok(settings.includes('class="settings-actions"'));
  assert.ok(settings.includes('id="saveBtn"'));
  assert.ok(!settings.includes('class="card skin-card"'));
  assert.ok(appearance.includes('id="themeSwitch"'));
  assert.ok(appearance.includes('class="header-icon-btn theme-toggle"'));
  assert.ok(!appearance.includes('role="switch"'));
  assert.ok(appearance.includes('id="skin"'));
  assert.ok(html.includes('data-page="appearance"'));
  assert.ok(!html.includes('data-goto='));
  assert.ok(!html.includes('class="savebar"'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});
