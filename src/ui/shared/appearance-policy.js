// Keep appearance preferences intact while the customization UI is temporarily disabled.
export const APPEARANCE_SETTINGS_ENABLED = false;

export function effectiveAppearance(config = {}) {
  return APPEARANCE_SETTINGS_ENABLED
    ? { skin: config?.skin || "default", theme: config?.theme || "auto" }
    : { skin: "default", theme: "light" };
}
