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

async function parseError(response) {
  let details = "";
  try {
    const json = await response.json();
    details = json.message || json.error || JSON.stringify(json);
  } catch {
    details = response.statusText;
  }
  return `请求失败(${response.status}): ${details}`;
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
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  async testConnection() {
    const { owner, repo } = this.config;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) {
      throw new Error(await parseError(response));
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
    const response = await fetch(url, { headers: this.headers });
    if (response.status === 404) {
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (!response.ok) {
      throw new Error(await parseError(response));
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
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
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
    return {
      Authorization: `token ${this.config.token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }

  async testConnection() {
    const { owner, repo } = this.config;
    const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) {
      throw new Error(await parseError(response));
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
    const response = await fetch(url, { headers: this.headers });
    if (response.status === 404) {
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    const json = await response.json();
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
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
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
