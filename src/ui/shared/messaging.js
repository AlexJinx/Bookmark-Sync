import { ErrorCodes } from "../../core/actions.js";

export class ActionError extends Error {
  constructor(payload) {
    if (typeof payload === "string") {
      super(payload || "请求失败");
      this.code = "";
      this.details = null;
      return;
    }

    super(payload?.message || "请求失败");
    this.code = payload?.code || "";
    this.details = payload?.details || null;
  }
}

export function isConflictError(error) {
  return error?.code === ErrorCodes.SYNC_CONFLICT;
}

export async function send(action, extra = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.ok) {
    throw new ActionError(response?.error || "请求失败");
  }
  return response.data;
}
