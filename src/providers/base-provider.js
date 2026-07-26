import { normalizeAuthToken } from "../core/text.js";

export function assertRequiredFields(config, fields, prefix) {
  for (const field of fields) {
    const value = config?.[field];
    if (!value || !String(value).trim()) {
      throw new Error(`缺少配置项: ${prefix}.${field}`);
    }
  }
}

export function encodePath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function extractErrorDetails(payload, fallback = "") {
  if (payload && typeof payload === "object") {
    const message = payload.message || payload.error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return fallback;
    }
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  return fallback;
}

const AUTH_HINTS = {
  github:
    "请确认填写的是原始 Token，不要包含 Bearer/token 前缀、引号或换行，并检查该 Token 是否已过期或被撤销。",
  gitee:
    "请确认填写的是原始 Token，不要包含 Bearer/token 前缀、引号或换行，并检查该 Token 是否仍然有效。",
  gist:
    "请确认填写的是 classic Personal Access Token 且勾选了 gist 权限（fine-grained Token 不支持 Gist），并检查是否已过期。"
};

const AUTH_LABELS = {
  github: "GitHub",
  gitee: "Gitee",
  gist: "GitHub Gist"
};

export function buildAuthErrorMessage(providerId, details) {
  const message = details || "Bad credentials";
  const label = AUTH_LABELS[providerId];
  const hint = AUTH_HINTS[providerId];
  if (label && hint) {
    return `${label} 认证失败(401): ${message}。${hint}`;
  }
  return `认证失败(401): ${message}`;
}

export function buildRequestErrorMessage(status, details, providerId = "") {
  if (status === 401) {
    return buildAuthErrorMessage(providerId, details);
  }
  return `请求失败(${status}): ${details}`;
}

export async function parseError(response, providerId = "") {
  let details = "";
  try {
    const json = await response.json();
    details = extractErrorDetails(json, response.statusText);
  } catch {
    details = response.statusText;
  }
  return buildRequestErrorMessage(response.status, details, providerId);
}

// Provider 抽象契约（同步引擎唯一依赖的三个方法）：
//   testConnection() -> { provider, summary, ... }
//   getRemoteFile()  -> { exists, sha, contentText }   sha 是不透明版本令牌
//   updateRemoteFile(contentText, sha) -> { fileSha, commitSha, createdGistId? }
export class BaseProvider {
  constructor(id, config) {
    this.id = id;
    this.config = config || {};
  }

  get token() {
    return normalizeAuthToken(this.config.token);
  }

  async request(url, init = {}) {
    return fetch(url, { cache: "no-store", ...init });
  }

  async testConnection() {
    throw new Error("provider 未实现 testConnection");
  }

  async getRemoteFile() {
    throw new Error("provider 未实现 getRemoteFile");
  }

  async updateRemoteFile() {
    throw new Error("provider 未实现 updateRemoteFile");
  }
}
