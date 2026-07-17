"use strict";

/**
 * Bootstrap file submission flow (履历类 / 判断类).
 * Pure orchestration for unit tests; renderer wires UI adapters.
 */

const MESSAGES = Object.freeze({
  pickingHeadline: "正在打开文件选择…",
  pickingCurrent: "请在系统对话框中选择文件。",
  cancelHeadline: "未选择文件",
  cancelCurrent: "未选择文件。可再次点击提交。",
  pickFailedHeadline: "无法打开文件选择",
  enqueueFailedHeadline: "材料入库失败",
  selectedHeadline: (n) => `已选择 ${n} 个文件`,
  enrolledHeadline: "已投入材料",
});

function fileDisplayName(file) {
  if (!file || typeof file !== "object") return "";
  if (file.name) return String(file.name);
  const fp = String(file.filePath || file.path || "");
  if (!fp) return "";
  const parts = fp.split(/[/\\]/);
  return parts[parts.length - 1] || fp;
}

/**
 * @param {object} deps
 * @param {() => Promise<Array|object|null>} deps.pickFile
 * @param {(files: Array) => Promise<{ added?: Array }>} deps.enqueueInbox
 * @param {(status: object) => void} deps.notify
 * @param {() => Promise<void>} [deps.refreshInbox]
 * @param {object} [options]
 * @param {string} [options.doneHint]
 */
async function runBootstrapFileSubmit(deps, options = {}) {
  const pickFile = deps && deps.pickFile;
  const enqueueInbox = deps && deps.enqueueInbox;
  const notify = deps && deps.notify;
  const refreshInbox = deps && deps.refreshInbox;
  if (typeof pickFile !== "function" || typeof enqueueInbox !== "function" || typeof notify !== "function") {
    throw new Error("bootstrap file submit requires pickFile, enqueueInbox, and notify");
  }

  notify({
    headline: MESSAGES.pickingHeadline,
    current: MESSAGES.pickingCurrent,
    resetDetail: true,
    appendDetail: MESSAGES.pickingHeadline,
  });

  let files;
  try {
    files = await pickFile();
  } catch (err) {
    const msg = String((err && err.message) || err || "未知错误");
    notify({
      headline: MESSAGES.pickFailedHeadline,
      current: msg,
      appendDetail: `${MESSAGES.pickFailedHeadline}：${msg}`,
    });
    return { ok: false, reason: "pick_failed", error: msg };
  }

  const list = Array.isArray(files) ? files : files ? [files] : [];
  if (!list.length) {
    notify({
      headline: MESSAGES.cancelHeadline,
      current: MESSAGES.cancelCurrent,
      appendDetail: MESSAGES.cancelHeadline,
    });
    return { ok: false, reason: "cancelled" };
  }

  const names = list.map(fileDisplayName).filter(Boolean);
  const namePreview =
    names.slice(0, 5).join("、") + (names.length > 5 ? ` 等 ${names.length} 个` : "");
  notify({
    headline: MESSAGES.selectedHeadline(list.length),
    current: namePreview || `共 ${list.length} 个文件`,
    countsText: String(list.length),
    appendDetail: `${MESSAGES.selectedHeadline(list.length)}：${namePreview || "（无文件名）"}`,
  });

  let result;
  try {
    result = await enqueueInbox(list);
  } catch (err) {
    const msg = String((err && err.message) || err || "未知错误");
    notify({
      headline: MESSAGES.enqueueFailedHeadline,
      current: msg,
      appendDetail: `${MESSAGES.enqueueFailedHeadline}：${msg}`,
    });
    return { ok: false, reason: "enqueue_failed", error: msg, selectedCount: list.length };
  }

  const added = (result && Array.isArray(result.added) && result.added) || list;
  const doneHint =
    options.doneHint || `已投入 ${added.length} 个文件。下一步：点「智能构建」。`;
  notify({
    headline: MESSAGES.enrolledHeadline,
    current: doneHint,
    countsText: `+${added.length}`,
    resetDetail: true,
    appendDetail: `已投入 ${added.length} 个文件。可直接点「智能构建」。`,
  });

  if (typeof refreshInbox === "function") {
    await refreshInbox();
  }

  return {
    ok: true,
    reason: "enrolled",
    selectedCount: list.length,
    addedCount: added.length,
    names,
  };
}

module.exports = {
  MESSAGES,
  fileDisplayName,
  runBootstrapFileSubmit,
};
