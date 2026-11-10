import { send } from "../shared/messaging.js";
import { validateSnapshot } from "../../core/bookmarks/service.js";
import { countSnapshotBookmarks } from "../../core/snapshot/count.js";
import { getProviderLabel } from "../../providers/registry.js";
import { createMergePlan } from "../../core/snapshot/merge-plan.js";
import { isProviderEnabled } from "../../core/config.js";

const $ = id => document.getElementById(id);
const provider = new URLSearchParams(location.search).get("provider") || "";
const direction = new URLSearchParams(location.search).get("direction") === "pull" ? "pull" : "push";
if (direction === "pull") {
  document.title = "解决拉取冲突";
  document.querySelector("h1").textContent = "解决拉取冲突";
  $("submitNote").textContent = "合并结果仅应用到本地书签，不写入云端。应用前自动备份，导入失败会尝试回滚。";
  $("confirmLabel").textContent = "我已检查合并结果，确认用它更新本地书签";
  $("submit").textContent = "应用到本地书签";
}
let preview = null;
let busy = false;
let dirty = false;
let submitted = false;
let plan = null;
let selections = {};
let complete = false;
let repositoryEnabled = true;
let requiresReload = false;
const json = value => JSON.stringify(value, null, 2);
const reasonLabels = {
  ambiguous_move: "书签位置发生变化且双方都有修改，请确认此目录内容",
  pending_overlap: "上次单向合并后出现重叠修改，请确认当前两侧内容",
  no_base: "缺少共同历史，无法确认这是新增还是删除",
  delete_modify: "一侧删除，另一侧修改",
  both_modified: "两侧修改了同一项",
  both_added: "两侧新增了内容不同的同一项",
  ambiguous_identity_or_order: "同名项目、重命名或排序无法可靠匹配，请确认此目录的内容"
};
function status(message, error = false) { $("status").textContent = message; $("status").dataset.error = String(error); }
function controls() {
  for (const id of ["download", "validate"]) $(id).disabled = busy || !complete;
  for (const input of document.querySelectorAll('#conflicts input, #conflicts button')) input.disabled = busy || submitted || !repositoryEnabled;
  $("reload").disabled = busy || !repositoryEnabled;
  $("submit").disabled = busy || !complete || submitted || !repositoryEnabled || requiresReload || !$("confirm").checked;
}
function tree(nodes, parent) {
  const list = document.createElement("ul");
  for (const node of nodes) {
    const row = document.createElement("li");
    row.className = node.type === "folder" ? "tree-folder" : "tree-bookmark";
    const title = document.createElement("span"); title.className = "node-title";
    title.textContent = node.title || "未命名"; row.append(title);
    if (node.url) {
      const url = document.createElement("span"); url.className = "node-url";
      url.textContent = node.url; row.append(url);
    }
    if (node.children?.length) tree(node.children, row);
    list.append(row);
  }
  parent.append(list);
}
function updateResult() {
  const chosen = plan.conflicts.filter(item => selections[item.id]).length;
  complete = chosen === plan.conflicts.length;
  $("progress").textContent = `${chosen} / ${plan.conflicts.length} 项已确认`;
  $("resultTree").replaceChildren();
  const draft = plan.build(Object.fromEntries(plan.conflicts.map(item => [item.id, selections[item.id] || "none"])));
  $("result").value = json(draft);
  $("resultCount").textContent = `共 ${countSnapshotBookmarks(draft)} 条书签${complete ? "" : " · 未确认项暂不计入"}`;
  {
    for (const root of draft.roots) {
      const title = document.createElement("h3"); title.textContent = root.title || root.key;
      $("resultTree").append(title); tree(root.children, $("resultTree"));
    }
  }
  $("confirm").checked = false; controls();
}
function renderChoices() {
  $("conflicts").replaceChildren();
  for (const item of plan.conflicts) {
    const card = document.createElement("section"); card.className = "conflict-choice";
    const legend = document.createElement("div"); legend.className = "conflict-path"; legend.textContent = `${Number(item.id) + 1}. ${item.path.join(" / ")}`; card.append(legend);
    const reason = document.createElement("p"); reason.className = "conflict-path";
    reason.textContent = reasonLabels[item.reason] || "请选择要保留的内容"; card.append(reason);
    const sides = document.createElement("div"); sides.className = "sources";
    const inputs = {};
    const state = document.createElement("span");
    const refresh = (update = true) => {
      state.textContent = selections[item.id] === "none" ? "已确认：两边都不保留" : selections[item.id] ? "已选择" : "待确认";
      card.dataset.resolved = String(Boolean(selections[item.id]));
      for (const [side, input] of Object.entries(inputs)) {
        input.checked = selections[item.id] === side || selections[item.id] === "both";
      }
      if (update) updateResult();
    };
    for (const [side, label] of [["local", "本地"], ["remote", "云端"]]) {
      const section = document.createElement("section"); section.className = `merge-side ${side}`;
      if (item[side]) {
        const choice = document.createElement("label"), input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("aria-label", `第 ${Number(item.id) + 1} 项：保留${label}`);
        inputs[side] = input;
        input.addEventListener("change", () => {
          const left = inputs.local?.checked, right = inputs.remote?.checked;
          if (left || right) selections[item.id] = left && right ? "both" : left ? "local" : "remote";
          else delete selections[item.id];
          dirty = true; refresh();
        });
        choice.append(input, document.createTextNode(`保留${label}`)); section.append(choice);
        tree([item[side]], section);
      } else { const note = document.createElement("p"); note.className = "missing"; note.textContent = "此侧没有对应书签"; section.append(note); }
      sides.append(section);
    }
    card.append(sides);
    const choices = document.createElement("div"); choices.className = "choices";
    const omit = document.createElement("button"); omit.type = "button"; omit.textContent = "两边都不保留";
    omit.addEventListener("click", () => { selections[item.id] = "none"; dirty = true; refresh(); });
    choices.append(state, omit);
    card.append(choices); $("conflicts").append(card);
    refresh(false);
  }
  updateResult();
}
function parseResult() {
  if (!complete) throw new Error("请先完成所有差异项的选择");
  const snapshot = JSON.parse($("result").value);
  validateSnapshot(snapshot);
  return snapshot;
}
async function run(task) {
  if (busy) return;
  busy = true; controls();
  try { await task(); } catch (error) {
    if (error.code === "PROVIDER_DISABLED") {
      repositoryEnabled = false;
      requiresReload = true;
    }
    status(error.message || String(error), true);
  }
  finally { busy = false; controls(); }
}
async function load() {
  // Reject retired links rather than silently turning a test page into a real operation.
  if (new URLSearchParams(location.search).has("mode")) throw new Error("此测试入口已移除，请从扩展弹窗进入真实冲突解决页。");
  const fresh = await send("getMergePreview", { provider, direction });
  repositoryEnabled = true;
  requiresReload = false;
  validateSnapshot(fresh.local);
  if (fresh.remote) validateSnapshot(fresh.remote);
  preview = fresh;
  if (fresh.base) validateSnapshot(fresh.base);
  plan = createMergePlan(fresh.local, fresh.remote, fresh.base, fresh.pendingMerge);
  const projected = fresh.pendingMerge && !plan.pendingOverlap && fresh.remote;
  $("localDescription").textContent = projected && fresh.pendingMerge.direction === "push"
    ? "本地书签与此前已确认的合并内容" : "当前浏览器中的书签";
  $("remoteDescription").textContent = projected && fresh.pendingMerge.direction === "pull"
    ? "云端书签与此前已确认的合并内容" : "仓库中保存的书签";
  selections = {}; dirty = false;
  $("local").value = json(fresh.local);
  $("remote").value = fresh.remote ? json(fresh.remote) : "远端文件不存在";
  submitted = false;
  $("confirm").checked = false;
  renderChoices();
  const needsReview = plan.conflicts.length > 0;
  const title = needsReview ? (plan.hasBase ? "解决书签冲突" : "确认书签差异") : "检查合并结果";
  document.title = title; document.querySelector("h1").textContent = title;
  $("mergeReason").textContent = !fresh.remote
    ? "云端快照文件不存在。请确认是否保留本地内容；这与云端缺少某一条书签不同。"
    : !needsReview
      ? "重新读取后没有需要手动选择的冲突。可确定的变更已合并到下方预览，检查后即可提交。"
      : plan.pendingOverlap
        ? "上次合并只更新了一侧，尚未同步到另一侧，期间又出现了重叠修改。请确认当前差异，避免恢复已删除的内容。"
      : !plan.hasBase
        ? "尚无完整的共同同步历史（首次同步或旧版升级）。单边存在的项目可能是新增，也可能是另一侧删除，需要本次确认。两端内容一致后会自动建立历史基线。"
        : `${fresh.reason?.summary || `有 ${plan.conflicts.length} 项变更需要确认。`} 已自动处理 ${plan.automatic.length} 组可确定的变更，结果见下方预览。`;
  $("destination").textContent = `${getProviderLabel(provider)} · ${fresh.scope}`;
  status(needsReview ? "请逐项选择要保留的内容，完成后检查合并预览。" : "没有待选择项，请检查合并预览并确认提交。");
}
$("reload").addEventListener("click", () => {
  if (dirty && !window.confirm("重新读取将清除当前选择，请先下载已完成的结果。继续？")) return;
  run(load);
});
$("confirm").addEventListener("change", controls);
$("validate").addEventListener("click", () => run(async () => { status(`校验通过，共 ${countSnapshotBookmarks(parseResult())} 条书签。`); }));
$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([$("result").value], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "bookmark-merge-draft.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("submit").addEventListener("click", () => run(async () => {
  if (!$("confirm").checked || submitted || !repositoryEnabled || requiresReload) return;
  const snapshot = parseResult();
  await send("submitMerge", { provider, direction, snapshot, expected: {
    scope: preview.scope, localHash: preview.localHash, remoteSha: preview.remoteSha, remoteHash: preview.remoteHash
  } });
  submitted = true; dirty = false; $("confirm").checked = false;
  status(direction === "pull" ? "合并结果已应用到本地书签，云端未修改。应用前备份保存在扩展本地存储 lastMergeBackup。" : "合并结果已提交到当前云端。本地书签未修改；其他平台未提交。提交前备份保存在扩展本地存储 lastMergeBackup。");
}));
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.syncConfig?.newValue) return;
  const enabled = isProviderEnabled(changes.syncConfig.newValue, provider);
  if (enabled === repositoryEnabled) return;
  repositoryEnabled = enabled;
  requiresReload = true;
  $("confirm").checked = false;
  status(enabled
    ? "仓库已重新启用，请重新读取两侧数据后再提交。当前草稿仍可下载。"
    : "该仓库已禁用，已停止读取和提交。当前草稿仍可下载；请在基本设置中重新启用仓库后继续。", !enabled);
  controls();
});
run(load);
