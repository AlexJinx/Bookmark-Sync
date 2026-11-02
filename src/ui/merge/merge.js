import { send } from "../shared/messaging.js";
import { validateSnapshot } from "../../core/bookmarks/service.js";
import { countSnapshotBookmarks } from "../../core/snapshot/count.js";
import { getProviderLabel } from "../../providers/registry.js";
import { createMergePlan } from "../../core/snapshot/merge-plan.js";

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
const json = value => JSON.stringify(value, null, 2);
function status(message, error = false) { $("status").textContent = message; $("status").dataset.error = String(error); }
function controls() {
  for (const id of ["download", "validate"]) $(id).disabled = busy || !complete;
  for (const input of document.querySelectorAll('#conflicts input, #conflicts button')) input.disabled = busy || submitted;
  $("reload").disabled = busy;
  $("submit").disabled = busy || !complete || submitted || !$("confirm").checked;
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
  try { await task(); } catch (error) { status(error.message || String(error), true); }
  finally { busy = false; controls(); }
}
async function load() {
  // Reject retired links rather than silently turning a test page into a real operation.
  if (new URLSearchParams(location.search).has("mode")) throw new Error("此测试入口已移除，请从扩展弹窗进入真实冲突解决页。");
  const fresh = await send("getMergePreview", { provider });
  validateSnapshot(fresh.local);
  if (fresh.remote) validateSnapshot(fresh.remote);
  preview = fresh;
  plan = createMergePlan(fresh.local, fresh.remote);
  selections = {}; dirty = false;
  $("local").value = json(fresh.local);
  $("remote").value = fresh.remote ? json(fresh.remote) : "远端文件不存在";
  submitted = false;
  $("confirm").checked = false;
  renderChoices();
  $("destination").textContent = `${getProviderLabel(provider)} · ${fresh.scope}`;
  status("请逐项选择要保留的内容，完成后检查合并预览。");
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
  if (!$("confirm").checked || submitted) return;
  const snapshot = parseResult();
  await send("submitMerge", { provider, direction, snapshot, expected: {
    scope: preview.scope, localHash: preview.localHash, remoteSha: preview.remoteSha, remoteHash: preview.remoteHash
  } });
  submitted = true; dirty = false; $("confirm").checked = false;
  status(direction === "pull" ? "合并结果已应用到本地书签，云端未修改。应用前备份保存在扩展本地存储 lastMergeBackup。" : "合并结果已提交到当前云端。本地书签未修改；其他平台未提交。提交前备份保存在扩展本地存储 lastMergeBackup。");
}));
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
run(load);
