import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';

export type AutomationTriggerType = 'scheduled' | 'file_arrival' | 'institution_event';
export type AutomationLifecycle = 'active' | 'paused' | 'revoked';
export type AutomationHumanInLoop = 'before_execution' | 'none';

export interface AutomationDefinition {
  id: string;
  subjectId: string;
  title: string;
  goalTemplate: string;
  trigger: {
    type: AutomationTriggerType;
    schedule?: string;
    watchedPath?: string;
    institutionEventType?: string;
  };
  allowedCapabilityIds: string[];
  allowedSubjectIds: string[];
  validUntil: string;
  maxCostCny: number;
  humanInLoop: AutomationHumanInLoop;
  risk: 'low';
  lifecycle: AutomationLifecycle;
  createdAt: string;
  updatedAt: string;
}

/**
 * 触发回执只证明“哪个外部事实触发过、Owner 是否确认、进入了哪个 Task”。
 * Job/Artifact 的执行状态仍由既有 WorkRuntime 派生，不在这里镜像。
 */
export interface AutomationTriggerReceipt {
  id: string;
  automationId: string;
  eventKey: string;
  triggeredAt: string;
  confirmedAt?: string;
  threadId?: string;
  executionIds?: string[];
  artifactPaths?: string[];
}

export interface AutomationCreateInput {
  subjectId: string;
  title: string;
  goalTemplate: string;
  trigger: AutomationDefinition['trigger'];
  allowedCapabilityIds: string[];
  allowedSubjectIds?: string[];
  validUntil: string;
  maxCostCny: number;
  humanInLoop: AutomationHumanInLoop;
  risk: 'low';
}

function cleanList(values: readonly string[] | undefined): string[] {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function receiptId(automationId: string, eventKey: string): string {
  const digest = createHash('sha256').update(`${automationId}\0${eventKey}`).digest('hex').slice(0, 32);
  return `atr_${digest}`;
}

function validateTrigger(trigger: AutomationDefinition['trigger']): void {
  if (trigger.type === 'scheduled' && !String(trigger.schedule || '').trim()) {
    throw new Error('定时自动化需要明确时间规则');
  }
  if (trigger.type === 'file_arrival' && !String(trigger.watchedPath || '').trim()) {
    throw new Error('文件到达自动化需要已授权的观察位置');
  }
  if (trigger.type === 'institution_event' && !String(trigger.institutionEventType || '').trim()) {
    throw new Error('机构事件自动化需要明确事件类型');
  }
}

export class AutomationService {
  private readonly definitions: JsonObjectStore<AutomationDefinition>;
  private readonly receipts: JsonObjectStore<AutomationTriggerReceipt>;
  private readonly confirmationLocks = new Map<string, Promise<{ receipt: AutomationTriggerReceipt; duplicate: boolean }>>();

  private constructor(
    definitions: JsonObjectStore<AutomationDefinition>,
    receipts: JsonObjectStore<AutomationTriggerReceipt>,
  ) {
    this.definitions = definitions;
    this.receipts = receipts;
  }

  static async open(packageRoot: string): Promise<AutomationService> {
    const root = path.join(packageRoot, 'automation');
    const definitionsDir = path.join(root, 'definitions');
    const receiptsDir = path.join(root, 'trigger-receipts');
    await Promise.all([
      fs.mkdir(definitionsDir, { recursive: true }),
      fs.mkdir(receiptsDir, { recursive: true }),
    ]);
    return new AutomationService(
      new JsonObjectStore<AutomationDefinition>({ dir: definitionsDir }),
      new JsonObjectStore<AutomationTriggerReceipt>({ dir: receiptsDir }),
    );
  }

  async create(input: AutomationCreateInput, now = new Date().toISOString()): Promise<AutomationDefinition> {
    const title = String(input.title || '').trim();
    const goalTemplate = String(input.goalTemplate || '').trim();
    const allowedCapabilityIds = cleanList(input.allowedCapabilityIds);
    const validUntilMs = Date.parse(input.validUntil);
    if (!input.subjectId || !title || !goalTemplate) throw new Error('自动化需要主体、名称和目标');
    validateTrigger(input.trigger);
    if (!allowedCapabilityIds.length) throw new Error('自动化需要明确允许使用的能力');
    if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.parse(now)) {
      throw new Error('自动化有效期必须晚于当前时间');
    }
    if (!Number.isFinite(input.maxCostCny) || input.maxCostCny < 0) {
      throw new Error('自动化费用上限无效');
    }
    if (input.humanInLoop === 'none' && input.risk !== 'low') {
      throw new Error('只有明确低风险动作可以完全自动执行');
    }
    const definition: AutomationDefinition = {
      id: `auto_${randomUUID()}`,
      subjectId: input.subjectId,
      title,
      goalTemplate,
      trigger: { ...input.trigger },
      allowedCapabilityIds,
      allowedSubjectIds: cleanList(input.allowedSubjectIds),
      validUntil: new Date(validUntilMs).toISOString(),
      maxCostCny: input.maxCostCny,
      humanInLoop: input.humanInLoop,
      risk: 'low',
      lifecycle: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.definitions.put(definition);
    return definition;
  }

  async get(id: string): Promise<AutomationDefinition> {
    const found = await this.definitions.get(id);
    if (!found) throw new Error('没有找到这项自动化');
    return found;
  }

  async list(subjectId: string): Promise<AutomationDefinition[]> {
    const rows = await this.definitions.list((row) => row.subjectId === subjectId);
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async setLifecycle(
    id: string,
    action: 'pause' | 'resume' | 'revoke',
    now = new Date().toISOString(),
  ): Promise<AutomationDefinition> {
    const current = await this.get(id);
    if (current.lifecycle === 'revoked') throw new Error('已撤销的自动化不能恢复');
    const lifecycle: AutomationLifecycle = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'revoked';
    const next = { ...current, lifecycle, updatedAt: now };
    await this.definitions.put(next);
    return next;
  }

  async recordTrigger(input: {
    automationId: string;
    eventKey: string;
    triggerType: AutomationTriggerType;
    now?: string;
  }): Promise<{ definition: AutomationDefinition; receipt: AutomationTriggerReceipt; duplicate: boolean }> {
    const now = input.now || new Date().toISOString();
    const definition = await this.get(input.automationId);
    if (definition.lifecycle !== 'active') throw new Error('这项自动化当前未运行');
    if (Date.parse(definition.validUntil) <= Date.parse(now)) throw new Error('这项自动化已经过期');
    if (definition.trigger.type !== input.triggerType) throw new Error('触发来源与自动化设置不一致');
    const eventKey = String(input.eventKey || '').trim();
    if (!eventKey) throw new Error('触发事件缺少唯一标识');
    const id = receiptId(definition.id, eventKey);
    const existing = await this.receipts.get(id);
    if (existing) return { definition, receipt: existing, duplicate: true };
    const receipt: AutomationTriggerReceipt = {
      id,
      automationId: definition.id,
      eventKey,
      triggeredAt: now,
    };
    await this.receipts.put(receipt);
    return { definition, receipt, duplicate: false };
  }

  async confirmTrigger(input: {
    automationId: string;
    receiptId: string;
    execute: (request: { goal: string; allowedCapabilityIds: string[] }) => Promise<{
      threadId: string;
      executionIds: string[];
      artifactPaths: string[];
    }>;
    now?: string;
  }): Promise<{ receipt: AutomationTriggerReceipt; duplicate: boolean }> {
    const previous = this.confirmationLocks.get(input.receiptId);
    if (previous) return previous;
    const run = this.confirmTriggerOnce(input);
    this.confirmationLocks.set(input.receiptId, run);
    try {
      return await run;
    } finally {
      if (this.confirmationLocks.get(input.receiptId) === run) {
        this.confirmationLocks.delete(input.receiptId);
      }
    }
  }

  private async confirmTriggerOnce(input: {
    automationId: string;
    receiptId: string;
    execute: (request: { goal: string; allowedCapabilityIds: string[] }) => Promise<{
      threadId: string;
      executionIds: string[];
      artifactPaths: string[];
    }>;
    now?: string;
  }): Promise<{ receipt: AutomationTriggerReceipt; duplicate: boolean }> {
    const now = input.now || new Date().toISOString();
    const definition = await this.get(input.automationId);
    const receipt = await this.receipts.get(input.receiptId);
    if (!receipt || receipt.automationId !== definition.id) throw new Error('没有找到这次触发');
    if (receipt.confirmedAt) return { receipt, duplicate: true };
    if (definition.lifecycle !== 'active') throw new Error('这项自动化当前未运行');
    if (Date.parse(definition.validUntil) <= Date.parse(now)) throw new Error('这项自动化已经过期');
    // 先固化 Owner 决定，进程崩溃或重复点击也不能再次执行同一事件。
    const claimed: AutomationTriggerReceipt = {
      ...receipt,
      confirmedAt: now,
    };
    await this.receipts.put(claimed);
    const completed = await input.execute({
      goal: definition.goalTemplate,
      allowedCapabilityIds: definition.allowedCapabilityIds.slice(),
    });
    const next: AutomationTriggerReceipt = {
      ...claimed,
      threadId: completed.threadId,
      executionIds: cleanList(completed.executionIds),
      artifactPaths: cleanList(completed.artifactPaths),
    };
    await this.receipts.put(next);
    return { receipt: next, duplicate: false };
  }

  async listReceipts(automationId: string): Promise<AutomationTriggerReceipt[]> {
    const rows = await this.receipts.list((row) => row.automationId === automationId);
    return rows.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  }
}
