"use strict";

/**
 * Video/audio collaboration contracts for act-behalf:
 * task type detection, script output parsing, generation prompts,
 * export formats (Markdown / plain text / JSON), task store persistence.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const {
  TASK_TYPES,
  VIDEO_AUDIO_KEYWORDS,
  detectTaskType,
  normalizeTaskIntent,
  buildDefaultTaskIntent,
} = require("../src/act-behalf/task-intent");
const {
  parseVideoAudioOutput,
  buildVideoAudioMessages,
  composeVideoAudioPlainText,
  composeVideoAudioMarkdown,
  buildVideoAudioExport,
  parseStoryboardScenes,
  videoAudioScriptFromParsed,
} = require("../src/act-behalf/parse-output");
const {
  buildGenerationMessages,
  buildVideoAudioGenerationMessages,
  materializeResultSections,
  materializeVideoAudioSections,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-video-audio-"));
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
  await test("detectTaskType recognizes video/audio keywords (zh/en, case-insensitive)", () => {
    assert.equal(detectTaskType("帮我写一个短视频脚本"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("为播客写一集音频大纲"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("做一个产品宣传视频"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("帮我写分镜脚本"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("draft a video script for the launch"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("record an Audio intro"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("write a storyboard for the ad"), TASK_TYPES.videoAudio);
    assert.equal(detectTaskType("整理本周周报"), TASK_TYPES.general);
    assert.equal(detectTaskType(""), TASK_TYPES.general);
    assert.ok(VIDEO_AUDIO_KEYWORDS.includes("视频"));
    assert.ok(VIDEO_AUDIO_KEYWORDS.includes("分镜"));
    assert.ok(VIDEO_AUDIO_KEYWORDS.includes("audio"));
  });

  await test("detectTaskType keeps email detection for non-video goals", () => {
    assert.equal(detectTaskType("帮我写一封邮件给客户"), TASK_TYPES.email);
    assert.equal(detectTaskType("draft an email to the vendor"), TASK_TYPES.email);
  });

  await test("normalizeTaskIntent stamps video_audio and preserves explicit value", () => {
    const vaIntent = normalizeTaskIntent({ goal: "做一个介绍产品的视频" }, "abt_v1");
    assert.equal(vaIntent.taskType, TASK_TYPES.videoAudio);
    const generalIntent = normalizeTaskIntent({ goal: "整理调研纪要" }, "abt_g1");
    assert.equal(generalIntent.taskType, TASK_TYPES.general);
    // Explicit value wins over detection
    const forced = normalizeTaskIntent(
      { goal: "做一个介绍产品的视频", taskType: "general" },
      "abt_v2"
    );
    assert.equal(forced.taskType, TASK_TYPES.general);
    const def = buildDefaultTaskIntent({ goal: "write a podcast script" });
    assert.equal(def.taskType, TASK_TYPES.videoAudio);
  });

  // ---------- 2. Video/audio output parsing ----------
  await test("parseVideoAudioOutput parses a JSON object script", () => {
    const raw = JSON.stringify({
      title: "产品发布短片",
      duration: "60s",
      scenes: [
        { scene: "场景 1", visuals: "黑屏渐亮，LOGO 出现", narration: "全新产品，正式发布。", duration: "5s" },
        { scene: "场景 2", visuals: "产品特写", narration: "三大核心功能。", duration: "55s" },
      ],
      creativeDirection: "简洁、现代，强调效率感。",
      productionTips: ["使用剪映自动字幕", "配乐选轻电子"],
      needsConfirmation: ["具体产品卖点需用户确认"],
    });
    const p = parseVideoAudioOutput(raw);
    assert.equal(p.parseOk, true);
    assert.equal(p.title, "产品发布短片");
    assert.equal(p.duration, "60s");
    assert.equal(p.scenes.length, 2);
    assert.equal(p.scenes[0].scene, "场景 1");
    assert.ok(p.scenes[0].visuals.includes("LOGO"));
    assert.ok(p.scenes[1].narration.includes("三大核心功能"));
    assert.equal(p.scenes[1].duration, "55s");
    assert.ok(p.creativeDirection.includes("效率感"));
    assert.deepEqual(p.productionTips, ["使用剪映自动字幕", "配乐选轻电子"]);
    assert.ok(p.needsConfirmation.some((n) => n.includes("卖点")));
    assert.ok(p.plainText.includes("标题：产品发布短片"));
    assert.ok(p.plainText.includes("【分镜脚本】"));
    assert.ok(p.plainText.includes("旁白："));
  });

  await test("parseVideoAudioOutput parses fenced JSON and Chinese keys", () => {
    const raw =
      "好的，以下是脚本：\n```json\n" +
      JSON.stringify({
        标题: "播客第 12 期",
        时长: "30min",
        分镜脚本: [{ 场景: "开场", 画面: "封面图", 旁白: "欢迎收听。", 时长: "1min" }],
        创意方向: "对谈式、轻松。",
        制作建议: ["用 Descript 剪辑"],
      }) +
      "\n```";
    const p = parseVideoAudioOutput(raw);
    assert.equal(p.parseOk, true);
    assert.equal(p.title, "播客第 12 期");
    assert.equal(p.duration, "30min");
    assert.equal(p.scenes.length, 1);
    assert.ok(p.scenes[0].narration.includes("欢迎收听"));
    assert.deepEqual(p.productionTips, ["用 Descript 剪辑"]);
  });

  await test("parseVideoAudioOutput parses Markdown sections as fallback", () => {
    const raw =
      "## 标题\n\n城市漫步 Vlog\n\n" +
      "## 时长\n\n90s\n\n" +
      "## 分镜脚本\n\n" +
      "场景 1：老街晨光\n画面：航拍老街，晨光洒落\n旁白：这条街，我从小走到大。\n时长：20s\n\n" +
      "场景 2：咖啡馆\n画面：手冲咖啡特写\n旁白：味道没有变。\n时长：30s\n\n" +
      "## 创意方向\n\n怀旧、慢节奏。\n\n" +
      "## 制作建议\n\n- 手持拍摄增加呼吸感\n- 环境音保留";
    const p = parseVideoAudioOutput(raw);
    assert.equal(p.parseOk, true);
    assert.equal(p.title, "城市漫步 Vlog");
    assert.equal(p.duration, "90s");
    assert.equal(p.scenes.length, 2);
    assert.equal(p.scenes[0].scene, "场景 1");
    assert.ok(p.scenes[0].visuals.includes("航拍老街"));
    assert.ok(p.scenes[0].narration.includes("从小走到大"));
    assert.equal(p.scenes[0].duration, "20s");
    assert.ok(p.scenes[1].visuals.includes("手冲咖啡"));
    assert.ok(p.creativeDirection.includes("怀旧"));
    assert.deepEqual(p.productionTips, ["手持拍摄增加呼吸感", "环境音保留"]);
  });

  await test("parseVideoAudioOutput flags empty storyboard for confirmation; garbage fails", () => {
    const noScenes = parseVideoAudioOutput(
      JSON.stringify({ title: "只有创意", creativeDirection: "实验性短片。" })
    );
    assert.equal(noScenes.parseOk, true);
    assert.equal(noScenes.scenes.length, 0);
    assert.ok(noScenes.needsConfirmation.some((n) => n.includes("分镜")));

    const garbage = parseVideoAudioOutput("完全无法解析的输出");
    assert.equal(garbage.parseOk, false);
    assert.equal(garbage.title, "");
  });

  await test("parseStoryboardScenes + videoAudioScriptFromParsed + composeVideoAudioPlainText round-trip", () => {
    const scenes = parseStoryboardScenes(
      "场景 1：开场\n画面：山景\n旁白：你好。\n时长：10s\n\n场景 2：结尾\n旁白：再见。"
    );
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].duration, "10s");
    assert.ok(scenes[1].visuals.includes("结尾"));
    assert.ok(scenes[1].narration.includes("再见"));

    const script = videoAudioScriptFromParsed({
      title: "t",
      scenes,
      creativeDirection: "c",
      productionTips: "建议一\n建议二",
    });
    assert.ok(script);
    assert.deepEqual(script.productionTips, ["建议一", "建议二"]);
    const text = composeVideoAudioPlainText(script);
    assert.ok(text.includes("标题：t"));
    assert.ok(text.includes("场景 1（时长：10s）"));
    assert.equal(videoAudioScriptFromParsed({ hello: "world" }), null);
  });

  // ---------- 3. Generation prompts ----------
  await test("buildVideoAudioMessages requires structured format, style/boundaries, confirmation marks, external tools", () => {
    const msgs = buildVideoAudioMessages({
      title: "产品视频",
      request: "做一个 60 秒产品介绍视频",
      selectedSelfContextText: "### 风格\n表达克制、清楚。",
    });
    assert.equal(msgs.length, 2);
    const sys = msgs[0].content;
    assert.ok(sys.includes('"title"') && sys.includes('"scenes"') && sys.includes('"duration"'));
    assert.ok(sys.includes("creativeDirection"));
    assert.ok(sys.includes("productionTips"));
    assert.ok(sys.includes("needsConfirmation"));
    assert.ok(sys.includes("表达风格"));
    assert.ok(sys.includes("边界"));
    assert.ok(sys.includes("剪映") && sys.includes("Descript"));
    assert.ok(msgs[1].content.includes("唯一允许引用"));
    assert.ok(msgs[1].content.includes("表达克制"));
  });

  await test("buildGenerationMessages switches to video/audio prompt for video_audio taskType", () => {
    const intent = normalizeTaskIntent({ goal: "做一个团队介绍视频" }, "abt_v3");
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
    assert.ok(msgs[0].content.includes("视频/音频创作助手"));
    assert.ok(msgs[0].content.includes('"needsConfirmation"'));
    assert.ok(msgs[0].content.includes('"scenes"'));
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
    assert.ok(!gMsgs[0].content.includes("视频/音频创作助手"));
  });

  await test("materializeResultSections materializes video/audio scripts for video_audio taskType", () => {
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
      title: "团队介绍短片",
      duration: "45s",
      scenes: [
        { scene: "场景 1", visuals: "办公室全景", narration: "我们是谁。", duration: "15s" },
      ],
      creativeDirection: "克制、真实。",
      productionTips: ["自然光拍摄"],
      needsConfirmation: [],
      inferences: [
        { text: "用户偏好低调叙事", basedOnSubjectClaimIds: ["cl_1", "cl_forged"], uncertainty: "low" },
        { text: "无依据推断", basedOnSubjectClaimIds: ["cl_forged"] },
      ],
    };
    const sections = materializeResultSections({
      parsed,
      claims,
      externalEvidence: [],
      taskType: TASK_TYPES.videoAudio,
    });
    assert.equal(sections.parseOk, true);
    assert.ok(sections.videoAudio);
    assert.equal(sections.videoAudio.title, "团队介绍短片");
    assert.equal(sections.videoAudio.scenes.length, 1);
    assert.ok(sections.finalDraftText.includes("标题：团队介绍短片"));
    assert.ok(sections.finalDraftText.includes("【分镜脚本】"));
    assert.equal(sections.externalEvidence.length, 0);
    // forged claim ids are filtered; groundless inference marked high uncertainty
    assert.deepEqual(sections.inferences[0].basedOnSubjectClaimIds, ["cl_1"]);
    assert.equal(sections.inferences[1].uncertainty, "high");

    const direct = materializeVideoAudioSections({ parsed, claims });
    assert.equal(direct.videoAudio.duration, "45s");
  });

  await test("buildVideoAudioGenerationMessages embeds claim citations and rules", () => {
    const intent = normalizeTaskIntent({ goal: "做一个团队介绍视频" }, "abt_v4");
    const msgs = buildVideoAudioGenerationMessages({
      intent,
      claims: [
        {
          claimId: "cl_9",
          kind: "style",
          text: "少用形容词。",
          label: "风格",
          sourceRefs: [],
          confirmationState: "confirmed",
          subjectContextVersion: "v2",
        },
      ],
    });
    assert.ok(msgs[0].content.includes("claimId"));
    assert.ok(msgs[0].content.includes("外部工具"));
    assert.ok(msgs[1].content.includes("cl_9"));
  });

  // ---------- 4. Export formats ----------
  await test("buildVideoAudioExport produces Markdown / text / JSON artifacts", () => {
    const script = {
      title: "导出测试",
      duration: "30s",
      scenes: [
        { scene: "场景 1", visuals: "画面|含竖线", narration: "旁白\n换行", duration: "30s" },
      ],
      creativeDirection: "方向",
      productionTips: ["建议"],
      needsConfirmation: ["待确认项"],
    };
    const md = buildVideoAudioExport(script, "markdown");
    assert.equal(md.ok, true);
    assert.equal(md.ext, "md");
    assert.ok(md.content.includes("# 导出测试"));
    assert.ok(md.content.includes("| 场景 | 画面 | 旁白 | 时长 |"));
    assert.ok(md.content.includes("画面\\|含竖线"));
    assert.ok(md.content.includes("旁白<br>"));
    assert.ok(md.content.includes("## 创意方向"));
    assert.ok(md.content.includes("## 制作建议"));
    assert.ok(md.content.includes("## 待确认"));

    const txt = buildVideoAudioExport(script, "text");
    assert.equal(txt.ok, true);
    assert.equal(txt.ext, "txt");
    assert.ok(txt.content.includes("标题：导出测试"));
    assert.ok(txt.content.includes("【分镜脚本】"));

    const json = buildVideoAudioExport(script, "json");
    assert.equal(json.ok, true);
    assert.equal(json.ext, "json");
    const parsed = JSON.parse(json.content);
    assert.equal(parsed.title, "导出测试");
    assert.equal(parsed.scenes.length, 1);
    assert.deepEqual(parsed.productionTips, ["建议"]);

    const bad = buildVideoAudioExport(script, "docx");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "unsupported_format");
  });

  await test("composeVideoAudioMarkdown omits optional sections when empty", () => {
    const md = composeVideoAudioMarkdown({ title: "t", duration: "", scenes: [] });
    assert.ok(md.includes("# t"));
    assert.ok(!md.includes("## 创意方向"));
    assert.ok(!md.includes("## 制作建议"));
    assert.ok(md.includes("（暂无分镜，需要补充。）"));
  });

  // ---------- 5. Task store persists video/audio script + taskType ----------
  await test("task store persists videoAudioScript and taskType across reload", async () => {
    const ud = tempUserData();
    try {
      const saved = await actStore.saveTask(ud, {
        title: "产品视频",
        request: "做一个产品介绍视频",
        goal: "做一个产品介绍视频",
        status: "completed",
        taskIntent: normalizeTaskIntent({ goal: "做一个产品介绍视频" }, undefined),
        result: "标题：产品视频\n\n【分镜脚本】\n场景 1（时长：15s）\n画面：全景\n旁白：你好。",
        videoAudioScript: {
          title: "产品视频",
          duration: "60s",
          scenes: [
            { scene: "场景 1", visuals: "全景", narration: "你好。", duration: "15s" },
            { scene: "空场景", visuals: "", narration: "", duration: "" },
          ],
          creativeDirection: "简洁。",
          productionTips: ["剪映字幕"],
          needsConfirmation: ["卖点需确认"],
        },
      });
      assert.equal(saved.ok, true);
      const got = actStore.getTask(ud, saved.task.taskId);
      assert.equal(got.ok, true);
      assert.equal(got.task.taskIntent.taskType, TASK_TYPES.videoAudio);
      assert.ok(got.task.videoAudioScript);
      assert.equal(got.task.videoAudioScript.title, "产品视频");
      // empty scenes are dropped by the store whitelist
      assert.equal(got.task.videoAudioScript.scenes.length, 1);
      assert.equal(got.task.videoAudioScript.scenes[0].visuals, "全景");
      assert.deepEqual(got.task.videoAudioScript.productionTips, ["剪映字幕"]);
      assert.deepEqual(got.task.videoAudioScript.needsConfirmation, ["卖点需确认"]);
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nvideo-audio contracts:", passed, "passed,", failed, "failed");
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
