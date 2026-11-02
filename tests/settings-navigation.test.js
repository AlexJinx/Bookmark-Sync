import assert from "node:assert/strict";
import test from "node:test";
import { openConnectionSettings } from "../src/ui/shared/settings-navigation.js";

test("connection button opens the repository settings page in an active tab", async () => {
  let opened;
  await openConnectionSettings({
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    tabs: { create: async options => { opened = options; } }
  });
  assert.deepEqual(opened, { url: "chrome-extension://test/src/ui/options/options.html#settings", active: true });
});

test("opening errors propagate so the popup can report them", async () => {
  await assert.rejects(openConnectionSettings({
    runtime: { getURL: path => path },
    tabs: { create: async () => { throw new Error("unavailable"); } }
  }), /unavailable/);
});
