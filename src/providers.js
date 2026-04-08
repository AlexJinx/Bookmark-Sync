function assertRequired(value, field) {
  if (!value || !String(value).trim()) {
    throw new Error(`缺少配置项: ${field}`);
  }
}

function encodePath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeAuthToken(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:bearer|token)\s+/i, "")
    .replace(/\s+/g, "");
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(base64Text) {
  const binary = atob(base64Text.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function buildAuthErrorMessage(provider, details) {
  const message = details || "Bad credentials";
  if (provider === "github") {
    return `GitHub 认证失败(401): ${message}。请确认填写的是原始 Token，不要包含 Bearer/token 前缀、引号或换行，并检查该 Token 是否已过期或被撤销。`;
  }
  if (provider === "gitee") {
    return `Gitee 认证失败(401): ${message}。请确认填写的是原始 Token，不要包含 Bearer/token 前缀、引号或换行，并检查该 Token 是否仍然有效。`;
  }
  return `认证失败(401): ${message}`;
}

function extractErrorDetails(payload, fallback = "") {
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

function buildRequestErrorMessage(status, details, provider = "") {
  if (status === 401) {
    return buildAuthErrorMessage(provider, details);
  }
  return `请求失败(${status}): ${details}`;
}

function isRemoteFileMissing(details) {
  const text = String(details || "").toLowerCase();
  return text.includes("not found") || text.includes("404") || text.includes("不存在");
}

function isExplicitDirectoryPath(path) {
  return /[\\/]$/.test(String(path || "").trim());
}

async function parseError(response, provider = "") {
  let details = "";
  try {
    const json = await response.json();
    details = extractErrorDetails(json, response.statusText);
  } catch {
    details = response.statusText;
  }
  return buildRequestErrorMessage(response.status, details, provider);
}

class GitHubProvider {
  constructor(config) {
    this.config = config;
    assertRequired(config.token, "github.token");
    assertRequired(config.owner, "github.owner");
    assertRequired(config.repo, "github.repo");
    assertRequired(config.branch, "github.branch");
    assertRequired(config.path, "github.path");
  }

  get contentUrl() {
    const { owner, repo, path } = this.config;
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`;
  }

  get headers() {
    const token = normalizeAuthToken(this.config.token);
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  async testConnection() {
    const { owner, repo } = this.config;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await fetch(url, { headers: this.headers, cache: "no-store" });
    if (!response.ok) {
      throw new Error(await parseError(response, "github"));
    }
    const json = await response.json();
    return {
      provider: "github",
      fullName: json.full_name,
      private: Boolean(json.private),
      defaultBranch: json.default_branch
    };
  }

  async getRemoteFile() {
    const url = `${this.contentUrl}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await fetch(url, { headers: this.headers, cache: "no-store" });
    if (response.status === 404) {
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (!response.ok) {
      throw new Error(await parseError(response, "github"));
    }
    const json = await response.json();
    return {
      exists: true,
      sha: json.sha,
      contentText: fromBase64(json.content || "")
    };
  }

  async updateRemoteFile(contentText, sha) {
    const message = `sync bookmarks at ${new Date().toISOString()}`;
    const body = {
      message,
      branch: this.config.branch,
      content: toBase64(contentText)
    };
    if (sha) {
      body.sha = sha;
    }

    const response = await fetch(this.contentUrl, {
      method: "PUT",
      headers: this.headers,
      cache: "no-store",
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "github"));
    }
    const json = await response.json();
    return {
      commitSha: json.commit?.sha || "",
      fileSha: json.content?.sha || ""
    };
  }
}

class GiteeProvider {
  constructor(config) {
    this.config = config;
    assertRequired(config.token, "gitee.token");
    assertRequired(config.owner, "gitee.owner");
    assertRequired(config.repo, "gitee.repo");
    assertRequired(config.branch, "gitee.branch");
    assertRequired(config.path, "gitee.path");
  }

  get contentUrl() {
    const { owner, repo, path } = this.config;
    return `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`;
  }

  get headers() {
    const token = normalizeAuthToken(this.config.token);
    return {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }

  async testConnection() {
    const { owner, repo } = this.config;
    const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await fetch(url, { headers: this.headers, cache: "no-store" });
    if (!response.ok) {
      throw new Error(await parseError(response, "gitee"));
    }
    const json = await response.json();
    return {
      provider: "gitee",
      fullName: json.full_name,
      private: Boolean(json.private),
      defaultBranch: json.default_branch
    };
  }

  async getRemoteFile() {
    const url = `${this.contentUrl}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await fetch(url, { headers: this.headers, cache: "no-store" });
    let json = null;
    try {
      json = await response.json();
    } catch {
      if (!response.ok) {
        throw new Error(buildRequestErrorMessage(response.status, response.statusText, "gitee"));
      }
      throw new Error("Gitee 返回的远端文件内容无法解析");
    }

    const details = extractErrorDetails(json, response.statusText);
    if (response.status === 404 || isRemoteFileMissing(details)) {
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (!response.ok) {
      throw new Error(buildRequestErrorMessage(response.status, details, "gitee"));
    }
    if (Array.isArray(json)) {
      if (isExplicitDirectoryPath(this.config.path)) {
        throw new Error("远端路径指向的是目录，请填写具体文件路径");
      }
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (typeof json.content !== "string") {
      throw new Error("Gitee 返回的远端文件内容格式异常");
    }
    return {
      exists: true,
      sha: json.sha,
      contentText: fromBase64(json.content || "")
    };
  }

  async updateRemoteFile(contentText, sha) {
    const body = {
      message: `sync bookmarks at ${new Date().toISOString()}`,
      branch: this.config.branch,
      content: toBase64(contentText)
    };
    if (sha) {
      body.sha = sha;
    }

    const response = await fetch(this.contentUrl, {
      method: sha ? "PUT" : "POST",
      headers: this.headers,
      cache: "no-store",
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "gitee"));
    }
    const json = await response.json();
    return {
      commitSha: json.commit?.sha || "",
      fileSha: json.content?.sha || ""
    };
  }
}

export function createProviderClient(config) {
  if (config.provider === "github") {
    return new GitHubProvider(config.github);
  }
  if (config.provider === "gitee") {
    return new GiteeProvider(config.gitee);
  }
  throw new Error(`未知 provider: ${config.provider}`);
}
