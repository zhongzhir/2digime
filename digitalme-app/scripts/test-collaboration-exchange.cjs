"use strict";

/**
 * Collaboration Exchange (src/collaboration/exchange.js) tests.
 *
 * 两个独立的临时 Package 目录（账户 A / 账户 B）通过文件交换完成协作闭环：
 * 邀请 → 接受 → 过程同步 → 反馈同步 → 幂等重复导入。
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  createCollaboration,
  addInteraction,
  addDeliverable,
  addFeedback,
  loadCollaborationStore,
} = require("../src/collaboration");
const {
  exportInvite,
  importInvite,
  exportUpdate,
  importUpdate,
} = require("../src/collaboration/exchange");
const { loadOrCreateIdentity } = require("../src/identity");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

/** 确保连续写入的 timestamp 不同（毫秒级）。 */
function tick() {
  const end = Date.now() + 2;
  while (Date.now() < end) { /* busy wait */ }
}

// 两个独立账户 Package 目录 + 文件交换目录
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-exchange-a-"));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-exchange-b-"));
const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-exchange-io-"));

// ---- Step 1: 账户 A 创建协作 ----
const created = createCollaboration(dirA, {
  title: "跨账户研究协作",
  goal: "共同完成一份行业研究报告",
  role: "founder",
  validDays: 30,
});
assert(created.ok === true && created.collaboration, "A: create collaboration succeeds");
const collabId = created.collaboration.id;
assert(created.collaboration.status === "invited", "A: initial status is invited");

// ---- Step 2: A 导出邀请文件（含 from 的 DID 和公钥）----
const invitePath = path.join(tmpOut, "invite.json");
const exported = exportInvite(dirA, collabId, invitePath);
assert(exported.ok === true && exported.filePath === path.resolve(invitePath), "A: export invite succeeds");
assert(fs.existsSync(invitePath), "A: invite file written to disk");
const inviteData = JSON.parse(fs.readFileSync(invitePath, "utf8"));
const identityA = loadOrCreateIdentity(dirA);
assert(inviteData.type === "collaboration_invite" && inviteData.version === 1, "invite file has type and version");
assert(
  inviteData.from && inviteData.from.did === identityA.did &&
    typeof inviteData.from.publicKey === "string" && inviteData.from.publicKey.length > 0,
  "invite carries from DID and public key"
);
assert(
  inviteData.collaboration && inviteData.collaboration.id === collabId &&
    inviteData.collaboration.title === "跨账户研究协作" &&
    inviteData.collaboration.status === "invited",
  "invite carries collaboration info with invited status"
);

// 导出未知协作被拒绝
const exportMissing = exportInvite(dirA, "collab_nonexistent", path.join(tmpOut, "x.json"));
assert(exportMissing.ok === false && /协作不存在/.test(exportMissing.message), "A: export unknown collaboration rejected");

// ---- Step 3: B 导入邀请并接受 ----
const identityB = loadOrCreateIdentity(dirB);
const accepted = importInvite(dirB, invitePath);
assert(accepted.ok === true && accepted.collaboration, "B: import invite succeeds");
const collabB = accepted.collaboration;
assert(collabB.id === collabId, "B: collaboration id matches invite");
assert(collabB.status === "accepted", "B: status is accepted after import");
assert(collabB.subject.did === identityB.did, "B: subject is account B identity");
assert(
  collabB.collaborator.did === identityA.did &&
    collabB.collaborator.publicKey === identityA.publicKey &&
    collabB.collaborator.type === "digitalme",
  "B: collaborator points to account A with public key"
);
assert(
  collabB.remote && collabB.remote.fromDid === identityA.did &&
    collabB.remote.fromPublicKey === identityA.publicKey && !!collabB.remote.acceptedAt,
  "B: cross-account remote tracking recorded"
);

// 重复导入同一邀请被拒绝
const dupImport = importInvite(dirB, invitePath);
assert(dupImport.ok === false && /已导入/.test(dupImport.message), "B: duplicate invite import rejected");

// 不存在的邀请文件被拒绝
const missingFile = importInvite(dirB, path.join(tmpOut, "no-such-file.json"));
assert(missingFile.ok === false && /不存在/.test(missingFile.message), "B: missing invite file rejected");

// 过期邀请被拒绝
const expiredInvite = JSON.parse(fs.readFileSync(invitePath, "utf8"));
expiredInvite.collaboration.id = "collab_expired_test";
expiredInvite.collaboration.validUntil = new Date(Date.now() - 86400000).toISOString();
const expiredPath = path.join(tmpOut, "expired-invite.json");
fs.writeFileSync(expiredPath, JSON.stringify(expiredInvite, null, 2), "utf8");
const expiredRes = importInvite(dirB, expiredPath);
assert(expiredRes.ok === false && /已过期/.test(expiredRes.message), "B: expired invite rejected");

// ---- Step 4: A 添加交互与交付物，导出更新 ----
tick();
addInteraction(dirA, collabId, { type: "question", actor: "subject", content: "请先给出报告大纲。" });
tick();
addInteraction(dirA, collabId, { type: "answer", actor: "collaborator", content: "大纲已完成，共三章。" });
tick();
addDeliverable(dirA, collabId, { title: "研究报告初稿", content: "正文……", sources: ["identity.json"] });
const updatePathA = path.join(tmpOut, "update-a.json");
const exportedUpdateA = exportUpdate(dirA, collabId, updatePathA);
assert(exportedUpdateA.ok === true && fs.existsSync(updatePathA), "A: export update succeeds");
const updateDataA = JSON.parse(fs.readFileSync(updatePathA, "utf8"));
assert(
  updateDataA.type === "collaboration_update" && updateDataA.version === 1 &&
    updateDataA.collaborationId === collabId,
  "update file has type, version and collaboration id"
);
assert(updateDataA.interactions.length === 2 && updateDataA.deliverables.length === 1, "update carries interactions and deliverables");
assert(
  updateDataA.from && updateDataA.from.did === identityA.did &&
    typeof updateDataA.from.publicKey === "string" && updateDataA.from.publicKey.length > 0,
  "update carries from DID and public key"
);

// ---- Step 5: B 导入更新，验证合并 ----
const mergedB = importUpdate(dirB, updatePathA);
assert(mergedB.ok === true && mergedB.collaboration, "B: import update succeeds");
assert(mergedB.collaboration.interactions.length === 2, "B: interactions merged");
assert(mergedB.collaboration.deliverables.length === 1, "B: deliverables merged");
assert(mergedB.collaboration.status === "delivered", "B: status moved forward to delivered");
assert(mergedB.collaboration.interactions[0].content.includes("大纲"), "B: interaction content intact");

// 状态只向前流转：导入状态更旧的更新，状态不回退
const staleUpdate = {
  version: 1,
  type: "collaboration_update",
  exportedAt: new Date().toISOString(),
  from: { did: identityA.did, publicKey: identityA.publicKey },
  collaborationId: collabId,
  status: "invited",
  interactions: [],
  deliverables: [],
  feedback: [],
};
const stalePath = path.join(tmpOut, "stale-update.json");
fs.writeFileSync(stalePath, JSON.stringify(staleUpdate, null, 2), "utf8");
const staleRes = importUpdate(dirB, stalePath);
assert(staleRes.ok === true && staleRes.collaboration.status === "delivered", "B: status does not regress on stale update");

// 未知协作的更新被拒绝
const orphanUpdate = Object.assign({}, staleUpdate, { collaborationId: "collab_orphan" });
const orphanPath = path.join(tmpOut, "orphan-update.json");
fs.writeFileSync(orphanPath, JSON.stringify(orphanUpdate, null, 2), "utf8");
const orphanRes = importUpdate(dirB, orphanPath);
assert(orphanRes.ok === false && /协作不存在/.test(orphanRes.message), "B: update for unknown collaboration rejected");

// ---- Step 6: B 添加反馈，导出更新 ----
tick();
addFeedback(dirB, collabId, {
  rating: 5,
  comment: "报告质量符合预期。",
  writeBack: [{ target: "memory", content: "A 的大纲能力很强。" }],
});
const updatePathB = path.join(tmpOut, "update-b.json");
const exportedUpdateB = exportUpdate(dirB, collabId, updatePathB);
assert(exportedUpdateB.ok === true && fs.existsSync(updatePathB), "B: export update succeeds");

// ---- Step 7: A 导入更新，验证反馈合并（且回合同步不产生重复）----
const mergedA = importUpdate(dirA, updatePathB);
assert(mergedA.ok === true && mergedA.collaboration, "A: import update succeeds");
assert(mergedA.collaboration.feedback.length === 1, "A: feedback merged");
assert(
  mergedA.collaboration.feedback[0].rating === 5 &&
    mergedA.collaboration.feedback[0].comment.includes("符合预期"),
  "A: feedback content intact"
);
assert(mergedA.collaboration.interactions.length === 2, "A: interactions not duplicated by round-trip sync");
assert(mergedA.collaboration.deliverables.length === 1, "A: deliverables not duplicated by round-trip sync");
assert(mergedA.collaboration.status === "delivered", "A: status stays delivered");

// ---- Step 8: 重复导入同一更新（幂等，不重复合并）----
const againA = importUpdate(dirA, updatePathB);
assert(againA.ok === true, "A: re-import same update succeeds");
assert(
  againA.collaboration.feedback.length === 1 &&
    againA.collaboration.interactions.length === 2 &&
    againA.collaboration.deliverables.length === 1,
  "A: re-import is idempotent (no duplicates)"
);
const againB = importUpdate(dirB, updatePathA);
assert(
  againB.ok === true &&
    againB.collaboration.interactions.length === 2 &&
    againB.collaboration.deliverables.length === 1 &&
    againB.collaboration.feedback.length === 1,
  "B: re-import is idempotent (no duplicates)"
);

// ---- 持久化：双方 collaborations.json 可从磁盘重载且合并状态一致 ----
const storeA = loadCollaborationStore(dirA);
const storeB = loadCollaborationStore(dirB);
const diskA = storeA.collaborations.find((c) => c.id === collabId);
const diskB = storeB.collaborations.find((c) => c.id === collabId);
assert(
  diskA && diskB &&
    diskA.feedback.length === 1 && diskA.interactions.length === 2 &&
    diskB.deliverables.length === 1 && diskB.interactions.length === 2,
  "both accounts persist merged state to disk"
);

// Cleanup
fs.rmSync(dirA, { recursive: true, force: true });
fs.rmSync(dirB, { recursive: true, force: true });
fs.rmSync(tmpOut, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
