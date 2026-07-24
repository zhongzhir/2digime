"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  createCollaboration,
  addInteraction,
  addDeliverable,
  approveDeliverable,
  addFeedback,
  confirmFeedbackWriteBack,
  revokeCollaboration,
  listCollaborations,
  loadCollaborationStore,
} = require("../src/collaboration");
const { loadOrCreateIdentity } = require("../src/identity");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-collab-"));
const storePath = path.join(tmpDir, "collaborations.json");

// Test 1: create fails without title or goal
const noTitle = createCollaboration(tmpDir, { goal: "只有目标" });
assert(noTitle.ok === false && /标题和目标/.test(noTitle.message), "create fails without title");
const noGoal = createCollaboration(tmpDir, { title: "只有标题" });
assert(noGoal.ok === false && /标题和目标/.test(noGoal.message), "create fails without goal");

// Test 2: create collaboration — subject identity, authorization, initial status
const created = createCollaboration(tmpDir, {
  title: "投资备忘录协作",
  goal: "与外部 AI 助手共同完成一份投资备忘录",
  role: "founder",
  collaboratorType: "agent",
  collaboratorName: "外部 AI 助手",
  collaboratorCapabilities: ["research", "drafting"],
  scope: "full",
  validDays: 30,
});
assert(created.ok === true && created.collaboration, "create succeeds");
const collab = created.collaboration;
assert(typeof collab.id === "string" && collab.id.startsWith("collab_"), "collaboration id generated");
assert(collab.status === "invited", "initial status is invited");
const identity = loadOrCreateIdentity(tmpDir);
assert(collab.subject.did === identity.did, "subject DID matches package identity");
assert(collab.subject.role === "founder", "subject role recorded");
assert(collab.collaborator.type === "agent" && collab.collaborator.name === "外部 AI 助手", "collaborator recorded");
assert(
  Array.isArray(collab.collaborator.capabilities) && collab.collaborator.capabilities.length === 2,
  "collaborator capabilities recorded"
);
assert(
  collab.authorization.scope === "full" &&
    collab.authorization.validDays === 30 &&
    collab.authorization.revoked === false &&
    collab.authorization.revokedAt === null,
  "authorization initialized with scope and validity"
);
assert(collab.validUntil && new Date(collab.validUntil) > new Date(), "validUntil is in the future");
assert(
  Array.isArray(collab.interactions) && collab.interactions.length === 0 &&
    Array.isArray(collab.deliverables) && collab.deliverables.length === 0 &&
    Array.isArray(collab.feedback) && collab.feedback.length === 0,
  "process records initialized empty"
);

// Test 3: interactions — 问答分工过程留痕
const q = addInteraction(tmpDir, collab.id, { type: "question", actor: "subject", content: "请先调研目标公司的竞品。" });
assert(q.ok === true && q.collaboration.interactions.length === 1, "question interaction added");
const a = addInteraction(tmpDir, collab.id, { type: "answer", actor: "collaborator", content: "已完成竞品调研，共 5 家。" });
assert(a.ok === true, "answer interaction added");
const inter = a.collaboration.interactions;
assert(inter.length === 2, "both interactions recorded");
assert(
  inter[0].type === "question" && inter[0].actor === "subject" && inter[0].content.includes("竞品") && !!inter[0].timestamp,
  "question interaction carries type/actor/content/timestamp"
);
assert(inter[1].actor === "collaborator", "collaborator answer attributed to collaborator");

// Test 4: deliverable — 交付物带来源，状态流转到 delivered
const delivered = addDeliverable(tmpDir, collab.id, {
  title: "投资备忘录初稿",
  content: "备忘录正文……",
  sources: ["memory/long-term-memory.jsonl", "identity.json"],
});
assert(delivered.ok === true, "deliverable added");
assert(delivered.collaboration.status === "delivered", "status transitions to delivered");
const del = delivered.collaboration.deliverables[0];
assert(
  del.title === "投资备忘录初稿" && del.approvedBy === "pending" && del.approvedAt === null && !!del.timestamp,
  "deliverable pending approval with timestamp"
);
assert(Array.isArray(del.sources) && del.sources.length === 2, "deliverable sources recorded");

// Test 5: approve deliverable — 主体确认交付
const approved = approveDeliverable(tmpDir, collab.id, 0, "subject");
assert(approved.ok === true, "approve succeeds");
const delApproved = approved.collaboration.deliverables[0];
assert(
  delApproved.approvedBy === "subject" && !!delApproved.approvedAt && !Number.isNaN(new Date(delApproved.approvedAt).getTime()),
  "deliverable approved by subject with timestamp"
);
const badApprove = approveDeliverable(tmpDir, collab.id, 99, "subject");
assert(badApprove.ok === false && /交付物不存在/.test(badApprove.message), "approve unknown deliverable rejected");

// Test 6: feedback — 反馈与写回内容，未确认前 confirmed=false
const fbAdded = addFeedback(tmpDir, collab.id, {
  rating: 5,
  comment: "交付质量符合预期。",
  writeBack: [{ target: "memory", content: "外部 AI 助手擅长竞品调研。" }],
});
assert(fbAdded.ok === true, "feedback added");
const fb = fbAdded.collaboration.feedback[0];
assert(
  fb.rating === 5 && fb.comment.includes("符合预期") && fb.confirmed === false && !!fb.timestamp,
  "feedback recorded unconfirmed with timestamp"
);
assert(Array.isArray(fb.writeBack) && fb.writeBack.length === 1, "feedback write-back items recorded");
assert(fbAdded.collaboration.status === "delivered", "status stays delivered before write-back confirmation");

// Test 7: confirm feedback write-back — 人工确认后闭环完成
const confirmed = confirmFeedbackWriteBack(tmpDir, collab.id, 0);
assert(confirmed.ok === true, "confirm write-back succeeds");
const fbConfirmed = confirmed.collaboration.feedback[0];
assert(
  fbConfirmed.confirmed === true && !!fbConfirmed.confirmedAt && !Number.isNaN(new Date(fbConfirmed.confirmedAt).getTime()),
  "write-back confirmed with timestamp"
);
assert(confirmed.collaboration.status === "completed", "status transitions to completed after confirmation");
const badConfirm = confirmFeedbackWriteBack(tmpDir, collab.id, 99);
assert(badConfirm.ok === false && /反馈不存在/.test(badConfirm.message), "confirm unknown feedback rejected");

// Test 8: revoke — 撤销后授权失效
const second = createCollaboration(tmpDir, { title: "临时协作", goal: "验证撤销流程" });
assert(second.ok === true, "second collaboration created");
const revoked = revokeCollaboration(tmpDir, second.collaboration.id);
assert(revoked.ok === true, "revoke succeeds");
assert(revoked.collaboration.status === "revoked", "status transitions to revoked");
assert(
  revoked.collaboration.authorization.revoked === true &&
    !!revoked.collaboration.authorization.revokedAt &&
    !Number.isNaN(new Date(revoked.collaboration.authorization.revokedAt).getTime()),
  "authorization revoked with timestamp"
);
const missing = revokeCollaboration(tmpDir, "collab_nonexistent");
assert(missing.ok === false && /不存在/.test(missing.message), "revoke unknown collaboration rejected");

// Test 9: persistence — collaborations.json written and reloadable
assert(fs.existsSync(storePath), "collaborations.json persisted");
const onDisk = JSON.parse(fs.readFileSync(storePath, "utf8"));
assert(Array.isArray(onDisk.collaborations) && onDisk.collaborations.length === 2, "store contains 2 collaborations");
assert(typeof onDisk.updatedAt === "string", "store has updatedAt");
const reloaded = loadCollaborationStore(tmpDir);
assert(reloaded.collaborations.length === 2, "store reloads from disk");
const reloadedFirst = reloaded.collaborations.find((c) => c.id === collab.id);
assert(
  reloadedFirst && reloadedFirst.status === "completed" &&
    reloadedFirst.interactions.length === 2 &&
    reloadedFirst.deliverables[0].approvedBy === "subject" &&
    reloadedFirst.feedback[0].confirmed === true,
  "full loop state persisted and reloadable"
);
const reloadedSecond = reloaded.collaborations.find((c) => c.id === second.collaboration.id);
assert(reloadedSecond && reloadedSecond.authorization.revoked === true, "revocation persisted to disk");

// Test 10: list
const listed = listCollaborations(tmpDir);
assert(listed.ok === true && listed.collaborations.length === 2, "list returns all collaborations");

// Test 11: default role / collaborator / validDays
const defaults = createCollaboration(tmpDir, { title: "默认值协作", goal: "验证默认值" });
assert(defaults.ok === true, "defaults create succeeds");
const dc = defaults.collaboration;
assert(dc.role === "founder" && dc.subject.role === "founder", "default role is founder");
assert(dc.collaborator.type === "agent" && dc.collaborator.name === "外部协作方", "default collaborator recorded");
const dayMs = new Date(dc.validUntil) - new Date(dc.createdAt);
assert(Math.round(dayMs / 86400000) === 30, "default validity is 30 days");

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
