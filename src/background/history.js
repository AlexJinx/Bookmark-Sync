import { getConfig } from "../core/storage.js";
import { isProviderConfigured } from "../core/config.js";
import { createProviderClient } from "../providers/registry.js";
import { parseSnapshotText } from "../core/snapshot/hash.js";
import { validateSnapshot } from "../core/bookmarks/service.js";
import { buildHistoryDiff } from "../core/snapshot/history-diff.js";

function normalize(commit) {
  return { sha: commit.sha, message: commit.commit?.message || "", date: commit.commit?.committer?.date || commit.commit?.author?.date,
    authorName: commit.commit?.author?.name || "", authorLogin: commit.author?.login || commit.author?.name || "" };
}
async function context(provider) {
  if (!["github", "gitee"].includes(provider)) throw new Error("当前平台不支持提交历史");
  const config = { ...await getConfig(), provider };
  return { config, configured: isProviderConfigured(config, provider) };
}
export async function getCommitHistory({ provider, limit = 20, page = 1 }) {
  limit = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20));
  page = Math.max(1, Math.floor(Number(page)) || 1);
  const { config, configured } = await context(provider);
  if (!configured) return { provider, configured, commits: [], page, hasNext: false };
  const client = createProviderClient(config);
  const commits = await client.listCommits({ limit, page });
  // Probe only one record beyond this page, including the exact-full-last-page case.
  const hasNext = commits.length === limit && (await client.listCommits({ limit: 1, page: page * limit + 1 })).length > 0;
  return { provider, configured, commits: commits.map(normalize), page, hasNext };
}
export async function getCommitDetail({ provider, sha }) {
  const { config, configured } = await context(provider);
  if (!configured) throw new Error("请先配置仓库");
  const client = createProviderClient(config);
  const commit = await client.getCommit(sha);
  const path = config[provider].path;
  const files = (commit.files || []).filter(file => file.filename === path || file.previous_filename === path);
  const detail = { ...normalize(commit), provider, files };
  try {
    const read = async (ref, filePath) => {
      if (!ref) return { roots: [] };
      const file = await client.getFileAtCommit(ref, filePath);
      if (!file.exists) return { roots: [] };
      const snapshot = parseSnapshotText(file.contentText);
      validateSnapshot(snapshot);
      return snapshot;
    };
    const previousPath = files.find(file => file.filename === path)?.previous_filename || path;
    const before = await read(commit.parents?.[0]?.sha, previousPath);
    const after = await read(commit.sha, path);
    detail.changes = buildHistoryDiff(before, after);
  } catch (error) {
    detail.changes = { hasComparison: false, message: `无法比较快照：${error.message}` };
  }
  return detail;
}
