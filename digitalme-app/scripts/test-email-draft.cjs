"use strict";

/**
 * Email drafting contracts for act-behalf:
 * task type detection, email output parsing, email generation prompts,
 * R3 send-confirmation gate (placeholder send).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const {
  TASK_TYPES,
  EMAIL_KEYWORDS,
  detectTaskType,
  normalizeTaskIntent,
  buildDefaultTaskIntent,
} = require("../src/act-behalf/task-intent");
const {
  parseEmailOutput,
  buildEmailMessages,
  composeEmailPlainText,
  emailDraftFromParsed,
} = require("../src/act-behalf/parse-output");
const {
  buildGenerationMessages,
  buildEmailGenerationMessages,
  materializeResultSections,
  materializeEmailSections,
  requestEmailSend,
  EMAIL_SEND_NOT_INTEGRATED_MESSAGE,
} = require("../src/act-behalf/result-generation");
const actStore = require("../src/act-behalf/task-store");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-email-draft-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  // ---------- 1. Task type detection ----------
  await test("detectTaskType recognizes email keywords (zh/en, case-insensitive)", () => {
    assert.equal(detectTaskType("帮我写一封邮件给客户"), TASK_TYPES.email);
    assert.equal(detectTaskType("回复这封电邮"), TASK_TYPES.email);
    assert.equal(detectTaskType("帮我发信给团队"), TASK_TYPES.email);
    assert.equal(detectTaskType("draft an email to the vendor"), TASK_TYPES.email);
    assert.equal(detectTaskType("Send an E-Mail update"), TASK_TYPES.email);
    assert.equal(detectTaskType("整理本周周报"), TASK_TYPES.general);
    assert.equal(detectTaskType(""), TASK_TYPES.general);
    assert.ok(EMAIL_KEYWORDS.includes("邮件"));
  });

  await test("normalizeTaskIntent stamps taskType and preserves explicit value", () => {
    const emailIntent = normalizeTaskIntent({ goal: "写邮件约客户开会" }, "abt_e1");
    assert.equal(emailIntent.taskType, TASK_TYPES.email);
    const generalIntent = normalizeTaskIntent({ goal: "整理调研纪要" }, "abt_g1");
    assert.equal(generalIntent.taskType, TASK_TYPES.general);
    // Explicit value wins over detection
    const forced = normalizeTaskIntent(
      { goal: "写邮件约客户开会", taskType: "general" },
      "abt_e2"
    );
    assert.equal(forced.taskType, TASK_TYPES.general);
    const def = buildDefaultTaskIntent({ goal: "reply to this email" });
    assert.equal(def.taskType, TASK_TYPES.email);
  });

  // ---------- 2. Email output parsing ----------
  await test("parseEmailOutput parses a JSON object draft", () => {
    const raw = JSON.stringify({
      to: "client@example.com",
      subject: "下周会议安排",
      body: "您好，\n\n想约下周三下午沟通。\n\n此致",
      attachments: ["议程.pdf"],
      needsConfirmation: ["会议时间需用户确认"],
    });
    const p = parseEmailOutput(raw);
    assert.equal(p.parseOk, true);
    assert.equal(p.to, "client@example.com");
    assert.equal(p.subject, "下周会议安排");
    assert.ok(p.body.includes("下周三"));
    assert.deepEqual(p.attachments, ["议程.pdf"]);
    assert.ok(p.needsConfirmation.some((n) => n.includes("时间")));
    assert.ok(p.plainText.includes("收件人：client@example.com"));
    assert.ok(p.plainText.includes("主题：下周会议安排"));
  });

  await test("parseEmailOutput parses fenced JSON and Chinese keys", () => {
    const raw =
      "好的，以下是草稿：\n```json\n" +
      JSON.stringify({ 收件人: "team@example.com", 主题: "周报", 正文: "各位好，本周进展如下。" }) +
      "\n```";
    const p = parseEmailOutput(raw);
    assert.equal(p.parseOk, true);
    assert.equal(p.to, "team@example.com");
    assert.equal(p.subject, "周报");
    assert.ok(p.body.includes("本周进展"));
  });

  await test("parseEmailOutput parses Markdown sections as fallback", () => {
    const raw =
      "## 收件人\n\nboss@example.com\n\n" +
      "## 主题\n\n项目里程碑汇报\n\n" +
      "## 正文\n\n领导好，\n\n里程碑已达成。\n\n" +
      "## 附件\n\n报告.docx";
    const p = parseEmailOutput(raw);
    assert.equal(p.parseOk, true);
    assert.equal(p.to, "boss@example.com");
    assert.equal(p.subject, "项目里程碑汇报");
    assert.ok(p.body.includes("里程碑已达成"));
    assert.deepEqual(p.attachments, ["报告.docx"]);
  });

  await test("parseEmailOutput flags missing recipient for confirmation; garbage fails", () => {
    const noTo = parseEmailOutput(JSON.stringify({ subject: "s", body: "b" }));
    assert.equal(noTo.parseOk, true);
    assert.equal(noTo.to, "");
    assert.ok(noTo.needsConfirmation.some((n) => n.includes("收件人")));

    const garbage = parseEmailOutput("完全无法解析的输出");
    assert.equal(garbage.parseOk, false);
    assert.equal(garbage.to, "");
  });

  await test("emailDraftFromParsed + composeEmailPlainText round-trip", () => {
    const draft = emailDraftFromParsed({
      to: "a@b.c",
      subject: "主题",
      body: "正文",
      attachments: "x.pdf, y.pdf",
    });
    assert.ok(draft);
    assert.deepEqual(draft.attachments, ["x.pdf", "y.pdf"]);
    const text = composeEmailPlainText(draft);
    assert.ok(text.includes("收件人：a@b.c"));
    assert.ok(text.includes("附件：x.pdf、y.pdf"));
    assert.equal(emailDraftFromParsed({ hello: "world" }), null);
  });

  // ---------- 3. Email generation prompts ----------
  await test("buildEmailMessages requires structured format, style/boundaries, confirmation marks", () => {
    const msgs = buildEmailMessages({
      title: "客户邮件",
      request: "写邮件约客户下周开会",
      selectedSelfContextText: "### 风格\n表达克制、清楚。",
    });
    assert.equal(msgs.length, 2);
    const sys = msgs[0].content;
    assert.ok(sys.includes('"to"') && sys.includes('"subject"') && sys.includes('"body"'));
    assert.ok(sys.includes("needsConfirmation"));
    assert.ok(sys.includes("表达风格"));
    assert.ok(sys.includes("边界"));
    assert.ok(sys.includes("不会自动发送"));
    assert.ok(msgs[1].content.includes("唯一允许引用"));
    assert.ok(msgs[1].content.includes("表达克制"));
  });

  await test("buildGenerationMessages switches to email prompt for email taskType", () => {
    const intent = normalizeTaskIntent({ goal: "写邮件感谢合作伙伴" }, "abt_e3");
    const claims = [
      {
        claimId: "cl_1",
        kind: "style",
        text: "表达克制、少口号。",
        label: "风格",
        sourceRefs: [],
        confirmationState: "confirmed",
        subjectContextVersion: "v1",
      },
    ];
    const msgs = buildGenerationMessages({ intent, skill: null, claims, externalEvidence: [] });
    assert.equal(msgs.length, 2);
    assert.ok(msgs[0].content.includes("邮件起草助手"));
    assert.ok(msgs[0].content.includes('"needsConfirmation"'));
    assert.ok(msgs[1].content.includes("cl_1"));

    // general tasks keep the research-expression prompt
    const generalIntent = normalizeTaskIntent({ goal: "整理调研纪要" }, "abt_g2");
    const gMsgs = buildGenerationMessages({
      intent: generalIntent,
      skill: null,
      claims,
      externalEvidence: [],
    });
    assert.ok(gMsgs[0].content.includes("finalDraft"));
    assert.ok(!gMsgs[0].content.includes("邮件起草助手"));
  });

  await test("materializeResultSections materializes email drafts for email taskType", () => {
    const claims = [
      {
        claimId: "cl_1",
        kind: "style",
        text: "表达克制。",
        label: "风格",
        sourceRefs: [],
        confirmationState: "confirmed",
        subjectContextVersion: "v1",
      },
    ];
    const parsed = {
      to: "partner@example.com",
      subject: "感谢信",
      body: "感谢您的支持。",
      attachments: [],
      needsConfirmation: [],
      inferences: [
        { text: "对方偏好简短沟通", basedOnSubjectClaimIds: ["cl_1", "cl_forged"], uncertainty: "low" },
        { text: "无依据推断", basedOnSubjectClaimIds: ["cl_forged"] },
      ],
    };
    const sections = materializeResultSections({
      parsed,
      claims,
      externalEvidence: [],
      taskType: TASK_TYPES.email,
    });
    assert.equal(sections.parseOk, true);
    assert.ok(sections.email);
    assert.equal(sections.email.to, "partner@example.com");
    assert.ok(sections.finalDraftText.includes("主题：感谢信"));
    assert.equal(sections.externalEvidence.length, 0);
    // forged claim ids are filtered; groundless inference marked high uncertainty
    assert.deepEqual(sections.inferences[0].basedOnSubjectClaimIds, ["cl_1"]);
    assert.equal(sections.inferences[1].uncertainty, "high");

    const direct = materializeEmailSections({ parsed, claims });
    assert.equal(direct.email.subject, "感谢信");
  });

  // ---------- 4. Send confirmation flow (R3 gate + placeholder) ----------
  await test("requestEmailSend requires complete draft fields", () => {
    const res = requestEmailSend({ to: "", subject: "s", body: "b", confirmed: true });
    assert.equal(res.ok, false);
    assert.equal(res.code, "email_incomplete");
    assert.ok(res.missing.includes("to"));
    assert.equal(res.sent, false);
  });

  await test("requestEmailSend blocks without explicit user confirmation (R3)", () => {
    const res = requestEmailSend({
      to: "a@b.c",
      subject: "s",
      body: "b",
      confirmed: false,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "confirmation_required");
    assert.equal(res.requiresConfirmation, true);
    assert.equal(res.sent, false);
    assert.ok(res.message.includes("确认"));

    const absent = requestEmailSend({ to: "a@b.c", subject: "s", body: "b" });
    assert.equal(absent.code, "confirmation_required");
  });

  await test("requestEmailSend confirmed -> placeholder not-integrated response", () => {
    const res = requestEmailSend({
      taskId: "abt_e9",
      to: "a@b.c",
      subject: "主题",
      body: "正文",
      attachments: ["x.pdf"],
      confirmed: true,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "email_service_not_integrated");
    assert.equal(res.sent, false);
    assert.equal(res.confirmed, true);
    assert.ok(res.message.includes("邮件服务集成"));
    assert.equal(res.message, EMAIL_SEND_NOT_INTEGRATED_MESSAGE);
    assert.equal(res.draft.to, "a@b.c");
    assert.deepEqual(res.draft.attachments, ["x.pdf"]);
  });

  // ---------- 5. Task store persists email draft + taskType ----------
  await test("task store persists emailDraft and taskType across reload", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, {
        title: "客户邮件",
        request: "写邮件约客户开会",
        goal: "写邮件约客户开会",
        status: "completed",
        taskIntent: normalizeTaskIntent({ goal: "写邮件约客户开会" }, undefined),
        result: "收件人：a@b.c\n主题：约见\n\n正文",
        emailDraft: {
          to: "a@b.c",
          subject: "约见",
          body: "正文",
          attachments: ["议程.pdf"],
          needsConfirmation: ["时间需确认"],
        },
      });
      assert.equal(saved.ok, true);
      const got = actStore.getTask(ud, saved.task.taskId);
      assert.equal(got.ok, true);
      assert.equal(got.task.taskIntent.taskType, TASK_TYPES.email);
      assert.ok(got.task.emailDraft);
      assert.equal(got.task.emailDraft.to, "a@b.c");
      assert.deepEqual(got.task.emailDraft.attachments, ["议程.pdf"]);
      assert.deepEqual(got.task.emailDraft.needsConfirmation, ["时间需确认"]);
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nemail-draft contracts:", passed, "passed,", failed, "failed");
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
