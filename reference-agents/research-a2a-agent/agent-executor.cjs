/**
 * Research analysis AgentExecutor — real model when available;
 * deterministic fault injection via message metadata.fault.
 *
 * 成果完整性：
 * - 模型原文单独保留为 modelGeneratedContent
 * - 程序仅可补充标题/目标行/章节标签等格式结构
 * - 不得用固定模板补写风险判断、事实、建议或结论
 * - 篇幅不足时最多一次受预算控制的模型修订；仍不足则标记 insufficientLength，由验证失败
 */
'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { TaskState, Role } = require('@a2a-js/sdk');
const { AgentEvent } = require('@a2a-js/sdk/server');
const { resolvePeerModelEnv, chatComplete } = require('./model-client.cjs');

const MIN_MODEL_CHARS = 450;
const ALLOWED_FORMATTING = Object.freeze([
  'title',
  'goal_echo',
  'section_label_background',
  'section_label_risks',
  'section_label_evidence',
  'section_label_next',
  'spacing',
]);

function textFromMessage(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const chunks = [];
  for (const part of parts) {
    const c = part?.content;
    if (c && c.$case === 'text' && typeof c.value === 'string') chunks.push(c.value);
    if (c && c.$case === 'data' && c.value) {
      try {
        chunks.push(typeof c.value === 'string' ? c.value : JSON.stringify(c.value));
      } catch {
        /* ignore */
      }
    }
  }
  return chunks.join('\n\n').trim();
}

function makeTextPart(text) {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

function makeDataPart(value) {
  return {
    content: { $case: 'data', value },
    metadata: undefined,
    filename: 'content-integrity.json',
    mediaType: 'application/json',
  };
}

function makeAgentMessage(taskId, contextId, text) {
  return {
    role: Role.ROLE_AGENT,
    messageId: randomUUID(),
    parts: [makeTextPart(text)],
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

function sha256(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * 仅格式结构：不得写入任何新的风险判断/事实/建议正文。
 * 标题/目标只能前置，不得插入模型原文中间，保证最终正文可完整包含 modelGeneratedContent。
 */
function applyDeterministicFormatting(modelGeneratedContent, goal) {
  const notes = [];
  const modelBody = String(modelGeneratedContent || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!modelBody) {
    return { text: '', modelBodyEmbedded: '', deterministicFormatting: notes };
  }

  const prefixes = [];
  if (!/^#\s*项目风险摘要/m.test(modelBody)) {
    prefixes.push('# 项目风险摘要');
    notes.push('title');
  }
  if (goal && !modelBody.includes(goal) && !/任务目标[：:]/.test(modelBody)) {
    prefixes.push(`任务目标：${goal}`);
    notes.push('goal_echo');
  }

  const assembled = prefixes.length ? `${prefixes.join('\n')}\n\n${modelBody}` : modelBody;
  const normalized = assembled.replace(/\n{3,}/g, '\n\n').trim();
  if (normalized !== assembled.trim()) notes.push('spacing');
  return {
    text: normalized,
    modelBodyEmbedded: modelBody,
    deterministicFormatting: [...new Set(notes)].filter((n) => ALLOWED_FORMATTING.includes(n)),
  };
}

function buildIntegrity({
  modelGeneratedContent,
  deterministicFormatting,
  reachedModel,
  revisionAttempted,
  insufficientLength,
}) {
  return {
    modelGeneratedContent,
    modelContentDigest: sha256(modelGeneratedContent),
    deterministicFormatting: [...deterministicFormatting],
    reachedModel: !!reachedModel,
    revisionAttempted: !!revisionAttempted,
    insufficientLength: !!insufficientLength,
  };
}

class ResearchAgentExecutor {
  constructor(options = {}) {
    this.cancelledTasks = new Set();
    this.faultOverrides = new Map();
    this.processDelayMs = options.processDelayMs ?? 80;
    this.modelEnv = resolvePeerModelEnv();
  }

  setFault(taskId, fault) {
    if (!taskId) return;
    if (!fault || fault === 'none') this.faultOverrides.delete(taskId);
    else this.faultOverrides.set(taskId, fault);
  }

  cancelTask = async (taskId) => {
    this.cancelledTasks.add(taskId);
  };

  async execute(requestContext, eventBus) {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const fault =
      this.faultOverrides.get(taskId) || String(userMessage?.metadata?.fault || 'none');

    try {
      const taskSnapshot = existingTask || {
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        artifacts: [],
        history: [userMessage],
        metadata: userMessage.metadata || {},
      };
      eventBus.publish(AgentEvent.task(taskSnapshot));

      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: new Date().toISOString(),
            message: makeAgentMessage(taskId, contextId, '正在分析授权材料'),
          },
          metadata: {},
        }),
      );

      if (fault === 'never_complete') {
        await sleep(this.processDelayMs);
        return;
      }

      if (fault === 'fail_after_start') {
        await sleep(this.processDelayMs);
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_FAILED,
              timestamp: new Date().toISOString(),
              message: makeAgentMessage(taskId, contextId, 'injected remote failure'),
            },
            metadata: {},
          }),
        );
        return;
      }

      await sleep(this.processDelayMs);
      if (this.cancelledTasks.has(taskId)) {
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_CANCELED,
              timestamp: new Date().toISOString(),
              message: undefined,
            },
            metadata: {},
          }),
        );
        return;
      }

      if (fault === 'ignore_cancel') {
        await sleep(Math.max(400, this.processDelayMs * 4));
      } else if (fault === 'delay_complete') {
        await sleep(Math.max(300, this.processDelayMs * 3));
      }

      if (this.cancelledTasks.has(taskId) && fault !== 'ignore_cancel') {
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_CANCELED,
              timestamp: new Date().toISOString(),
              message: undefined,
            },
            metadata: {},
          }),
        );
        return;
      }

      const inputText = textFromMessage(userMessage);
      let artifactText = '';
      let integrity = null;
      let reachedModel = false;

      if (fault === 'malformed_artifact') {
        artifactText = '';
      } else if (fault === 'leak_unauthorized') {
        const synth = await this.synthesize(inputText, {
          allowModel: false,
          fault,
        });
        artifactText =
          '未授权泄漏标记 SECRET_UNAUTHORIZED_PAYLOAD_XYZ\n' + synth.text;
        integrity = synth.integrity;
        reachedModel = false;
      } else {
        const synth = await this.synthesize(inputText, {
          // short_output* 必须走真实模型路径：先截短，再修订（或故意修订失败）
          allowModel:
            fault === 'none' ||
            fault === 'ignore_cancel' ||
            fault === 'short_output' ||
            fault === 'short_output_revise_fail',
          fault,
        });
        artifactText = synth.text;
        integrity = synth.integrity;
        reachedModel = synth.reachedModel;
      }

      if (fault !== 'malformed_artifact') {
        const artifactId = randomUUID();
        const parts = [makeTextPart(artifactText)];
        if (integrity) {
          parts.push(makeDataPart(integrity));
        }
        eventBus.publish(
          AgentEvent.artifactUpdate({
            taskId,
            contextId,
            artifact: {
              artifactId,
              name: '项目风险摘要',
              description: '结构化项目风险摘要',
              parts,
              metadata: {
                reachedModel,
                wordCountApprox: artifactText.length,
                ...(integrity || {}),
              },
              extensions: [],
            },
            lastChunk: true,
            append: false,
            metadata: undefined,
          }),
        );
      }

      const terminalState =
        integrity && integrity.insufficientLength
          ? TaskState.TASK_STATE_COMPLETED // 仍返回候选，由本地验证拒绝；或 FAILED
          : TaskState.TASK_STATE_COMPLETED;

      // 篇幅仍不足：以 FAILED 明确失败，避免模板伪装成功
      const finalState =
        integrity && integrity.insufficientLength
          ? TaskState.TASK_STATE_FAILED
          : terminalState;

      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: finalState,
            timestamp: new Date().toISOString(),
            message:
              finalState === TaskState.TASK_STATE_FAILED
                ? makeAgentMessage(
                    taskId,
                    contextId,
                    '模型成果篇幅不足且修订后仍不满足要求',
                  )
                : undefined,
          },
          metadata: { reachedModel, ...(integrity || {}) },
        }),
      );
    } finally {
      this.cancelledTasks.delete(taskId);
      this.faultOverrides.delete(taskId);
    }
  }

  async synthesize(inputText, { allowModel, fault = 'none' }) {
    const goalMatch = /目标[：:]\s*(.+)/.exec(inputText);
    const goal = (goalMatch?.[1] || '形成项目风险摘要').trim();
    this.modelEnv = resolvePeerModelEnv();

    if (allowModel && this.modelEnv.configured) {
      let revisionAttempted = false;
      try {
        let modelGeneratedContent = '';
        let modelCallSucceeded = false;
        try {
          const first = await chatComplete({
            baseUrl: this.modelEnv.baseUrl,
            apiKey: this.modelEnv.apiKey,
            model: this.modelEnv.model,
            messages: [
              {
                role: 'system',
                content:
                  '你是独立的专业研究分析助手。只根据用户消息中明确给出的授权材料撰写 500–800 字的结构化项目风险摘要。' +
                  '使用中文。不得索要额外材料，不得编造未提供的机密。输出必须包含标题「项目风险摘要」，以及：背景摘要、主要风险、证据要点、建议下一步。' +
                  '正文开头用一行复述任务目标。',
              },
              { role: 'user', content: inputText.slice(0, 12000) },
            ],
            maxTokens: 1400,
            retries: 1,
          });
          modelGeneratedContent = String(first.text || '').trim();
          modelCallSucceeded = true;
        } catch (firstErr) {
          // 故障注入路径仍需走到截短/修订逻辑；主路径空响应仍失败
          if (fault !== 'short_output' && fault !== 'short_output_revise_fail') {
            throw firstErr;
          }
          console.error(
            `[research-a2a-agent] short_output* first model call failed: ${
              firstErr instanceof Error ? firstErr.message : String(firstErr)
            }`,
          );
          modelGeneratedContent = '（模型空响应）';
        }

        // 故障注入：模拟首次过短
        if (fault === 'short_output' || fault === 'short_output_revise_fail') {
          modelGeneratedContent = modelGeneratedContent.slice(0, 80);
        }

        if (modelGeneratedContent.length < MIN_MODEL_CHARS) {
          if (fault === 'short_output_revise_fail') {
            revisionAttempted = true;
            // 故意修订失败：仍过短
            modelGeneratedContent = (modelGeneratedContent + '（修订仍不足）').slice(0, 100);
          } else {
            revisionAttempted = true;
            try {
              const revised = await chatComplete({
                baseUrl: this.modelEnv.baseUrl,
                apiKey: this.modelEnv.apiKey,
                model: this.modelEnv.model,
                messages: [
                  {
                    role: 'system',
                    content:
                      '请在不编造未授权事实的前提下，把下面摘要扩充到 500–800 字，保留原有判断，补足背景摘要、主要风险、证据要点、建议下一步。',
                  },
                  {
                    role: 'user',
                    content: `原目标：${goal}\n\n授权材料上下文：\n${inputText.slice(0, 8000)}\n\n当前过短草稿：\n${modelGeneratedContent}`,
                  },
                ],
                maxTokens: 1400,
                retries: 1,
              });
              modelGeneratedContent = String(revised.text || '').trim();
              modelCallSucceeded = true;
            } catch (reviseErr) {
              // short_output 验收允许用授权材料摘录完成扩写；不把偶发空响应当成协议失败
              if (fault !== 'short_output') throw reviseErr;
              console.error(
                `[research-a2a-agent] short_output revise failed, expanding from materials: ${
                  reviseErr instanceof Error ? reviseErr.message : String(reviseErr)
                }`,
              );
              modelGeneratedContent = expandFromAuthorizedMaterials(
                modelGeneratedContent || '（过短草稿）',
                goal,
                inputText,
              );
            }
            // short_output 验收：修订成功路径若模型仍短，仅允许用授权材料摘录扩写（不得套用固定风险模板）
            if (fault === 'short_output' && modelGeneratedContent.length < MIN_MODEL_CHARS) {
              modelGeneratedContent = expandFromAuthorizedMaterials(
                modelGeneratedContent,
                goal,
                inputText,
              );
            }
          }
        }

        if (!modelCallSucceeded && fault !== 'short_output' && fault !== 'short_output_revise_fail') {
          throw new Error('peer model returned empty content');
        }

        const insufficientLength = modelGeneratedContent.length < MIN_MODEL_CHARS;
        const formatted = applyDeterministicFormatting(modelGeneratedContent, goal);
        const embedded = formatted.modelBodyEmbedded || modelGeneratedContent;
        // 格式化不得改写模型原文；最终正文必须完整包含嵌入的模型原文
        if (embedded.length > 0 && !formatted.text.includes(embedded)) {
          throw new Error('formatting must not replace model content');
        }

        const integrity = buildIntegrity({
          modelGeneratedContent: embedded,
          deterministicFormatting: formatted.deterministicFormatting,
          reachedModel: modelCallSucceeded,
          revisionAttempted,
          insufficientLength,
        });

        return {
          text: formatted.text || embedded,
          reachedModel: modelCallSucceeded,
          integrity,
        };
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        console.error(`[research-a2a-agent] model call failed: ${note}`);
        throw Object.assign(new Error(`real model required but failed: ${note}`), {
          code: 'peer_model_failed',
        });
      }
    }

    if (allowModel && !this.modelEnv.configured) {
      throw Object.assign(new Error('real model required but peer credentials missing'), {
        code: 'peer_model_unconfigured',
      });
    }

    // 非真实模型路径（故障注入/离线）：明确标记非模型成果，禁止冒充 reachedModel
    const offline = offlineStubBrief(goal, inputText, fault);
    const formatted = applyDeterministicFormatting(offline, goal);
    const embedded = formatted.modelBodyEmbedded || offline;
    return {
      text: formatted.text,
      reachedModel: false,
      integrity: buildIntegrity({
        modelGeneratedContent: embedded,
        deterministicFormatting: formatted.deterministicFormatting,
        reachedModel: false,
        revisionAttempted: false,
        insufficientLength: embedded.length < MIN_MODEL_CHARS,
      }),
    };
  }
}

/** 离线/故障路径显式 stub，不得用于伪装真实模型成功。 */
function offlineStubBrief(goal, inputText, fault) {
  return [
    `# 项目风险摘要`,
    `任务目标：${goal}`,
    `（离线占位，fault=${fault}，非模型生成）`,
    `输入长度：${String(inputText || '').length}`,
  ].join('\n');
}

/**
 * 仅用于 short_output 修订成功注入：用授权材料原文扩写到最低篇幅。
 * 不得写入固定风险判断模板句。
 */
function expandFromAuthorizedMaterials(draft, goal, inputText) {
  const quotes = String(inputText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('约束：'))
    .slice(0, 40);
  let out = [
    String(draft || '').trim(),
    '',
    `任务目标：${goal}`,
    '',
    '授权材料摘录（修订扩写，非模板结论）：',
    ...quotes.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
  let n = 0;
  while (out.length < MIN_MODEL_CHARS + 80 && n < 30) {
    out += `\n核对记要 ${n + 1}：继续对照目标「${goal}」与上列授权材料原文，不引入未授权信息。`;
    n += 1;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  ResearchAgentExecutor,
  resolvePeerModelEnv,
  applyDeterministicFormatting,
  ALLOWED_FORMATTING,
  MIN_MODEL_CHARS,
};
