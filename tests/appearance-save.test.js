import assert from "node:assert/strict";
import test from "node:test";
import { createAppearanceSaver } from "../src/ui/shared/appearance-save.js";

test("appearance saves preserve stored repository settings and selection order", async () => {
  let stored = { skin: "default", theme: "auto", github: { owner: "saved-owner" }, autoSyncEnabled: true };
  const writes = [];
  const saver = createAppearanceSaver(async (action, payload) => {
    if (action === "getConfig") return structuredClone(stored);
    await new Promise(resolve => setTimeout(resolve, 5));
    stored = payload.config;
    writes.push(stored.skin);
    return stored;
  });
  await Promise.all([
    saver.save({ skin: "neon", theme: "auto", github: { owner: "unsaved-owner" } }),
    saver.save({ skin: "brutal", theme: "light" })
  ]);
  assert.deepEqual(writes, ["neon", "brutal"]);
  assert.equal(stored.github.owner, "saved-owner");
  assert.equal(stored.autoSyncEnabled, true);
  assert.equal(stored.theme, "light");
});

test("appearance saves recover after a failed request", async () => {
  let fail = true;
  const saver = createAppearanceSaver(async (action, payload) => {
    if (fail) { fail = false; throw new Error("offline"); }
    return action === "getConfig" ? {} : payload.config;
  });
  await assert.rejects(saver.save({ skin: "neon", theme: "auto" }), /offline/);
  assert.equal((await saver.save({ skin: "aurora", theme: "auto" })).skin, "aurora");
  await saver.flush();
});
