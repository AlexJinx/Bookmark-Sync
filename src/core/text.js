export function normalizeAuthToken(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:bearer|token)\s+/i, "")
    .replace(/\s+/g, "");
}

export function toTrimmedString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim();
}

export function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1" || value === 1) {
    return true;
  }
  if (value === "false" || value === "0" || value === 0) {
    return false;
  }
  return fallback;
}
