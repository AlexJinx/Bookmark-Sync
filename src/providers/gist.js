import { BaseProvider, assertRequiredFields, parseError } from "./base-provider.js";

const GISTS_API = "https://api.github.com/gists";

// GitHub Gist 后端（BookmarkHub 同款模式）。
// 配置仅需 token（classic PAT，勾选 gist 权限）+ fileName；
// gistId 留空时首次推送自动创建私有 Gist，由同步引擎将返回的 createdGistId 写回配置。
//
// 版本令牌：用 history[0].version（最新修订）充当 sha，接入现有三方冲突检测。
// 注意：Gist 的 PATCH 没有 compare-and-swap（不像 Contents API 会 409），
// 推送前的三方预检可拦截常规冲突，但 GET 与 PATCH 之间落地的并发写入会被覆盖。
export class GistProvider extends BaseProvider {
  constructor(config) {
    super("gist", config);
    assertRequiredFields(config, ["token", "fileName"], "gist");
  }

  get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  gistUrl(gistId) {
    return `${GISTS_API}/${encodeURIComponent(gistId)}`;
  }

  extractRevision(json) {
    return json?.history?.[0]?.version || json?.updated_at || "";
  }

  async testConnection() {
    const { gistId } = this.config;

    if (!gistId) {
      const response = await this.request(`${GISTS_API}?per_page=1`, { headers: this.headers });
      if (!response.ok) {
        throw new Error(await parseError(response, "gist"));
      }
      return {
        provider: "gist",
        gistId: "",
        summary: "Token 有效。未填写 Gist ID，首次推送会自动创建私有 Gist 并回填。"
      };
    }

    const response = await this.request(this.gistUrl(gistId), { headers: this.headers });
    if (response.status === 404) {
      throw new Error("Gist 不存在或无权访问，请检查 Gist ID 与 Token 权限");
    }
    if (!response.ok) {
      throw new Error(await parseError(response, "gist"));
    }
    const json = await response.json();
    const fileNames = Object.keys(json.files || {});
    const visibility = json.public ? "公开" : "私有";
    const publicWarning = json.public ? "；⚠ 该 Gist 是公开的，建议改用私有 Gist" : "";
    return {
      provider: "gist",
      gistId: json.id,
      public: Boolean(json.public),
      summary: `Gist ${json.id} (${visibility}，文件: ${fileNames.join(", ") || "无"})${publicWarning}`
    };
  }

  async getRemoteFile() {
    const { gistId, fileName } = this.config;

    // 尚未创建 Gist：视作远端文件不存在，推送时走创建路径。
    if (!gistId) {
      return { exists: false, sha: null, contentText: null };
    }

    const response = await this.request(this.gistUrl(gistId), { headers: this.headers });
    if (response.status === 404) {
      return { exists: false, sha: null, contentText: null };
    }
    if (!response.ok) {
      throw new Error(await parseError(response, "gist"));
    }

    const json = await response.json();
    const file = json.files?.[fileName];
    if (!file) {
      // Gist 存在但目标文件不存在：推送时 PATCH 会新增该文件。
      return { exists: false, sha: null, contentText: null };
    }

    let contentText = file.content;
    if (file.truncated && file.raw_url) {
      // 单文件超过 ~1MB 时内容被截断，需从 raw_url 拉取完整内容。
      const rawResponse = await this.request(file.raw_url, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      if (!rawResponse.ok) {
        throw new Error(`请求失败(${rawResponse.status}): 无法获取 Gist 完整内容`);
      }
      contentText = await rawResponse.text();
    }

    return {
      exists: true,
      sha: this.extractRevision(json),
      contentText: contentText || ""
    };
  }

  async updateRemoteFile(contentText, sha) {
    void sha; // Gist PATCH 无 CAS，sha 仅用于推送前的三方预检。
    const { gistId, fileName } = this.config;

    if (!gistId) {
      const response = await this.request(GISTS_API, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          description: "Bookmark Sync snapshot",
          public: false,
          files: { [fileName]: { content: contentText } }
        })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "gist"));
      }
      const json = await response.json();
      return {
        commitSha: "",
        fileSha: this.extractRevision(json),
        createdGistId: json.id
      };
    }

    const response = await this.request(this.gistUrl(gistId), {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({
        files: { [fileName]: { content: contentText } }
      })
    });
    if (response.status === 404) {
      throw new Error("Gist 不存在或已被删除，请检查 Gist ID（清空 Gist ID 可在下次推送时重新创建）");
    }
    if (!response.ok) {
      throw new Error(await parseError(response, "gist"));
    }
    const json = await response.json();
    return {
      commitSha: "",
      fileSha: this.extractRevision(json)
    };
  }
}
