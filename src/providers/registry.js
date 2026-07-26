import { GitHubProvider } from "./github.js";
import { GiteeProvider } from "./gitee.js";
import { GistProvider } from "./gist.js";

// Provider 单一事实来源。新增平台 = 一个 Provider 类 + 一条注册项（+ manifest host_permissions）。
//
// 兼容铁律：github / gitee 的 scopeOf 输出必须与旧版 getSyncScope
// （"provider|owner|repo|branch|path"）逐字节一致，否则既有用户的
// 三方同步基线（syncState.scopes 的键）全部失效，集体报首次同步冲突。
export const PROVIDERS = Object.freeze({
  github: Object.freeze({
    id: "github",
    label: "GitHub",
    Provider: GitHubProvider,
    requiredFields: Object.freeze(["token", "owner", "repo", "branch", "path"]),
    defaults: Object.freeze({
      token: "",
      owner: "",
      repo: "",
      branch: "main",
      path: "bookmarks/snapshot.json"
    }),
    scopeOf: (scoped) =>
      ["github", scoped?.owner || "", scoped?.repo || "", scoped?.branch || "", scoped?.path || ""].join("|"),
    historyUrl: (scoped) =>
      scoped?.owner && scoped?.repo && scoped?.branch
        ? `https://github.com/${scoped.owner}/${scoped.repo}/commits/${scoped.branch}`
        : ""
  }),
  gitee: Object.freeze({
    id: "gitee",
    label: "Gitee",
    Provider: GiteeProvider,
    requiredFields: Object.freeze(["token", "owner", "repo", "branch", "path"]),
    defaults: Object.freeze({
      token: "",
      owner: "",
      repo: "",
      branch: "master",
      path: "bookmarks/snapshot.json"
    }),
    scopeOf: (scoped) =>
      ["gitee", scoped?.owner || "", scoped?.repo || "", scoped?.branch || "", scoped?.path || ""].join("|"),
    historyUrl: (scoped) =>
      scoped?.owner && scoped?.repo && scoped?.branch
        ? `https://gitee.com/${scoped.owner}/${scoped.repo}/commits/${scoped.branch}`
        : ""
  }),
  gist: Object.freeze({
    id: "gist",
    label: "Gist",
    Provider: GistProvider,
    requiredFields: Object.freeze(["token", "fileName"]),
    defaults: Object.freeze({
      token: "",
      gistId: "",
      fileName: "bookmarks.json"
    }),
    scopeOf: (scoped) => ["gist", scoped?.gistId || "", scoped?.fileName || ""].join("|"),
    historyUrl: (scoped) => (scoped?.gistId ? `https://gist.github.com/${scoped.gistId}/revisions` : "")
  })
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

export function getProviderMeta(providerId) {
  const meta = PROVIDERS[providerId];
  if (!meta) {
    throw new Error(`未知 provider: ${providerId}`);
  }
  return meta;
}

export function getProviderLabel(providerId) {
  return PROVIDERS[providerId]?.label || providerId;
}

export function createProviderClient(config, providerId = config?.provider) {
  const meta = getProviderMeta(providerId);
  return new meta.Provider(config?.[providerId] || {});
}
