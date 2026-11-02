import { validateSnapshot } from "../../core/bookmarks/service.js";

const bookmark = (title, url) => ({ type: "bookmark", title, url });
const snapshot = children => ({ version: 1, roots: [{ key: "bookmark_bar", title: "测试收藏夹", children }] });

export function createDemoSession({ direction = "push" } = {}) {
  let revision = 1;
  let local = snapshot([
    bookmark("文档（本地改名）", "https://example.com/docs"),
    bookmark("本地新增", "https://example.com/local")
  ]);
  const remote = snapshot([
    bookmark("文档（云端改名）", "https://example.com/docs"),
    bookmark("云端新增", "https://example.com/remote")
  ]);
  return {
    async load() {
      return { local: structuredClone(local), remote: structuredClone(remote), revision, scope: "模拟仓库（不连接网络）" };
    },
    async submit(snapshot, expected) {
      validateSnapshot(snapshot);
      if (expected.revision !== revision) throw new Error("模拟本地或云端已更新，旧版本提交被阻止。草稿已保留，请重新读取两侧数据再核对提交。");
      if (direction === "pull") {
        local = structuredClone(snapshot);
        revision += 1;
      }
      return { snapshot: structuredClone(snapshot) };
    },
    changeLocal() {
      revision += 1;
      local.roots[0].children.push(bookmark(`本地临时新增 ${revision}`, `https://example.com/new-${revision}`));
    },
    changeRemote() {
      revision += 1;
      remote.roots[0].children[0].title = `文档（云端再次修改 ${revision}）`;
    },
    example() {
      return snapshot([
        bookmark("文档（手动合并标题）", "https://example.com/docs"),
        bookmark("本地新增", "https://example.com/local"),
        bookmark("云端新增", "https://example.com/remote")
      ]);
    }
  };
}

export function createMergeSession({ demo, provider, send, direction = "push" }) {
  // The demo branch never delegates to extension messaging, even for submission.
  if (demo) return createDemoSession({ direction });
  return {
    load: () => send("getMergePreview", { provider }),
    submit: (snapshot, preview) => send("submitMerge", { provider, snapshot, direction, expected: {
      scope: preview.scope, localHash: preview.localHash, remoteSha: preview.remoteSha, remoteHash: preview.remoteHash
    } })
  };
}
