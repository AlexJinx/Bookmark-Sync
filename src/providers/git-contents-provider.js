import { BaseProvider, assertRequiredFields, encodePath, parseError } from "./base-provider.js";
import { toBase64, fromBase64 } from "../core/encoding.js";

// GitHub / Gitee 仓库 Contents API 的共用实现。
// 子类通过构造参数提供差异点：apiBase、authScheme、accept、创建文件的 HTTP 方法。
export class GitContentsProvider extends BaseProvider {
  constructor(id, config, { apiBase, authScheme, accept }) {
    super(id, config);
    assertRequiredFields(config, ["token", "owner", "repo", "branch", "path"], id);
    this.apiBase = apiBase;
    this.authScheme = authScheme;
    this.accept = accept;
  }

  get repoUrl() {
    const { owner, repo } = this.config;
    return `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  get contentUrl() {
    return `${this.repoUrl}/contents/${encodePath(this.config.path)}`;
  }

  get headers() {
    return {
      Authorization: `${this.authScheme} ${this.token}`,
      Accept: this.accept,
      "Content-Type": "application/json"
    };
  }

  async testConnection() {
    const response = await this.request(this.repoUrl, { headers: this.headers });
    if (!response.ok) {
      throw new Error(await parseError(response, this.id));
    }
    const json = await response.json();
    return {
      provider: this.id,
      fullName: json.full_name,
      private: Boolean(json.private),
      defaultBranch: json.default_branch,
      summary: `${json.full_name} (默认分支: ${json.default_branch})`
    };
  }

  async getRemoteFile() {
    const url = `${this.contentUrl}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await this.request(url, { headers: this.headers });
    if (response.status === 404) {
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (!response.ok) {
      throw new Error(await parseError(response, this.id));
    }
    const json = await response.json();
    return {
      exists: true,
      sha: json.sha,
      contentText: fromBase64(json.content || "")
    };
  }

  // 创建文件时使用的 HTTP 方法（GitHub 恒为 PUT，Gitee 创建用 POST）。
  createMethod(hasSha) {
    void hasSha;
    return "PUT";
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

    const response = await this.request(this.contentUrl, {
      method: this.createMethod(Boolean(sha)),
      headers: this.headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await parseError(response, this.id));
    }
    const json = await response.json();
    return {
      commitSha: json.commit?.sha || "",
      fileSha: json.content?.sha || ""
    };
  }
}
