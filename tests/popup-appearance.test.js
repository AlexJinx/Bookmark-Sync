import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, root), "utf8");
}

test("popup applies and styles the saved interface skin", async () => {
  const [script, stylesheet] = await Promise.all([
    readSource("src/ui/popup/popup.js"),
    readSource("src/ui/popup/popup.css")
  ]);

  assert.match(script, /document\.documentElement\.dataset\.skin\s*=/);
  assert.match(script, /chrome\.storage\.onChanged/);
  assert.match(stylesheet, /:root\[data-skin="neon"\]/);
  assert.match(stylesheet, /:root\[data-skin="aurora"\]/);
  assert.match(stylesheet, /:root\[data-skin="brutal"\]/);
});
