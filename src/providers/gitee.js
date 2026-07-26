import { GitContentsProvider } from "./git-contents-provider.js";
import { extractErrorDetails, buildRequestErrorMessage } from "./base-provider.js";
import { fromBase64 } from "../core/encoding.js";

function isRemoteFileMissing(details) {
  const text = String(details || "").toLowerCase();
  return text.includes("not found") || text.includes("404") || text.includes("不存在");
}

function isExplicitDirectoryPath(path) {
  return /[\\/]$/.test(String(path || "").trim());
}

export class GiteeProvider extends GitContentsProvider {
  constructor(config) {
    super("gitee", config, {
      apiBase: "https://gitee.com/api/v5",
      authScheme: "token",
      accept: "application/json"
    });
  }

  // Gitee 创建文件必须用 POST，更新才用 PUT。
  createMethod(hasSha) {
    return hasSha ? "PUT" : "POST";
  }

  // Gitee 的返回格式与 GitHub 不同：404 可能带消息体、目录会返回数组、
  // 文件不存在时可能返回 200 + 错误消息，需要单独解析。
  async getRemoteFile() {
    const url = `${this.contentUrl}?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await this.request(url, { headers: this.headers });
    let json = null;
    try {
      json = await response.json();
    } catch {
      if (!response.ok) {
        throw new Error(buildRequestErrorMessage(response.status, response.statusText, "gitee"));
      }
      throw new Error("Gitee 返回的远端文件内容无法解析");
    }

    // 缺文件启发式只允许消费显式的 message/error 字段——绝不能扫描整个文件负载：
    // base64 content、sha、size 里出现 "404" 属正常字节，大快照必然命中，会把
    // 真实存在的远端文件误判为不存在（拉取报错、推送误报删除冲突）。
    const explicitMessage =
      json && !Array.isArray(json)
        ? [json.message, json.error].find((value) => typeof value === "string" && value.trim()) || ""
        : "";
    if (response.status === 404 || isRemoteFileMissing(explicitMessage)) {
      return {
        exists: false,
        sha: null,
        contentText: null
      };
    }
    if (!response.ok) {
      throw new Error(buildRequestErrorMessage(response.status, extractErrorDetails(json, response.statusText), "gitee"));
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
}
