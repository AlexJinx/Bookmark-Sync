import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAppearance, APPEARANCE_SETTINGS_ENABLED } from "../src/ui/shared/appearance-policy.js";

test("hidden appearance feature uses default light without overwriting saved preferences", () => {
  assert.equal(APPEARANCE_SETTINGS_ENABLED, false);
  for (const skin of ["default", "neon", "aurora", "brutal"]) {
    const saved = { skin, theme: "dark" };
    assert.deepEqual(effectiveAppearance(saved), { skin: "default", theme: "light" });
    assert.deepEqual(saved, { skin, theme: "dark" });
  }
  assert.deepEqual(effectiveAppearance(null), { skin: "default", theme: "light" });
});
