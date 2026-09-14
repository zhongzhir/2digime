/**
 * 网络内容反馈最小事件。
 * AI SHOW/IGNORE 与真人操作必须分 origin；本模块不写 Digital Self / preference。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const NETWORK_CONTENT_FEEDBACK_KIND = 'network_content_feedback' as const;

export type NetworkContentFeedbackOrigin = 'ai_decision' | 'user_action';

export const USER_CONTENT_ACTIONS = [
  'open',
  'keep',
  'interested',
  'later',
  'dismiss',
  'not_interested',
  'boost',
  'reduce',
  'follow',
  'block',
] as const;

export type UserContentAction = (typeof USER_CONTENT_ACTIONS)[number];
export type AiContentAction = 'SHOW' | 'IGNORE';

export interface NetworkContentFeedbackEvent {
  kind: typeof NETWORK_CONTENT_FEEDBACK_KIND;
  origin: NetworkContentFeedbackOrigin;
  subjectId: string;
  contentId: string;
  action: string;
  timestamp: string;
}

const USER_ACTION_SET = new Set<string>(USER_CONTENT_ACTIONS);

function requireId(value: string, name: string): string {
  const id = value.trim();
  if (!id) throw new Error(`${name}_required`);
  return id;
}

export function createAiJudgmentFeedback(input: {
  subjectId: string;
  contentId: string;
  action: AiContentAction;
  timestamp?: string;
}): NetworkContentFeedbackEvent {
  if (input.action !== 'SHOW' && input.action !== 'IGNORE') {
    throw new Error('ai_action_invalid');
  }
  return {
    kind: NETWORK_CONTENT_FEEDBACK_KIND,
    origin: 'ai_decision',
    subjectId: requireId(input.subjectId, 'subjectId'),
    contentId: requireId(input.contentId, 'contentId'),
    action: input.action,
    timestamp: input.timestamp || new Date().toISOString(),
  };
}

export function createUserContentFeedback(input: {
  subjectId: string;
  contentId: string;
  action: UserContentAction;
  timestamp?: string;
}): NetworkContentFeedbackEvent {
  if (!USER_ACTION_SET.has(input.action)) throw new Error('user_action_invalid');
  return {
    kind: NETWORK_CONTENT_FEEDBACK_KIND,
    origin: 'user_action',
    subjectId: requireId(input.subjectId, 'subjectId'),
    contentId: requireId(input.contentId, 'contentId'),
    action: input.action,
    timestamp: input.timestamp || new Date().toISOString(),
  };
}

export async function appendNetworkContentFeedback(
  filePath: string,
  event: NetworkContentFeedbackEvent,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}
