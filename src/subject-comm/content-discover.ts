/**
 * 接收侧 Discover：同一候选池 + 本人 Digital Self → SHOW/IGNORE。
 * 只写 network_content_feedback.origin=ai_decision，不写 Digital Self / 偏好。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { DigitalSelf } from '../subject-core/digital-self/types';
import { digitalSelfFilePath } from '../subject-core/digital-self/store';
import type { NetworkItem } from './network-item';
import { PERSONAL_SELECTION_UNAVAILABLE } from './network-item';
import { selectNetworkItems } from './personal-selection';
import { appendNetworkContentFeedback, createAiJudgmentFeedback } from './network-content-feedback';

export interface DiscoverCard {
  itemId: string;
  title: string;
  text: string;
  url?: string;
  publisherSubjectId?: string;
  publisherDisplayName?: string;
  reason: string;
  source?: 'directory' | 'web';
  contentType?: string;
  thumbnailUrl?: string;
  embedUrl?: string;
  mediaUrl?: string;
  durationSeconds?: number;
  consumption?: string;
  access?: string;
}

export interface DiscoverPreference {
  id: string;
  kind: string;
  text: string;
}

export interface DiscoverView {
  headline: string;
  lead: string;
  cards: DiscoverCard[];
  preferences: DiscoverPreference[];
  notice: string;
}

export function cardFromNetworkItem(
  item: NetworkItem,
  reason: string,
  source: 'directory' | 'web' = 'directory',
): DiscoverCard {
  return {
    itemId: item.itemId,
    title: item.content.title,
    text: item.content.text,
    reason,
    source,
    ...(item.content.url ? { url: item.content.url } : {}),
    ...(item.publisherSubjectId ? { publisherSubjectId: item.publisherSubjectId } : {}),
    ...(item.publisherDisplayName ? { publisherDisplayName: item.publisherDisplayName } : {}),
    ...(item.content.contentType ? { contentType: item.content.contentType } : {}),
    ...(item.content.thumbnailUrl ? { thumbnailUrl: item.content.thumbnailUrl } : {}),
    ...(item.content.embedUrl ? { embedUrl: item.content.embedUrl } : {}),
    ...(item.content.mediaUrl ? { mediaUrl: item.content.mediaUrl } : {}),
    ...(item.content.durationSeconds != null ? { durationSeconds: item.content.durationSeconds } : {}),
    ...(item.content.consumption ? { consumption: item.content.consumption } : {}),
    ...(item.content.access ? { access: item.content.access } : {}),
  };
}

export async function discoverForSubject(input: {
  digitalSelf: DigitalSelf;
  items: NetworkItem[];
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
  feedbackFile: string;
  preferenceDirectives?: string;
  preferences?: DiscoverPreference[];
}): Promise<
  | { ok: true; view: DiscoverView }
  | { ok: false; error: typeof PERSONAL_SELECTION_UNAVAILABLE; detail: string; view: DiscoverView }
> {
  const empty = (notice: string): DiscoverView => ({
    headline: '发现',
    lead: '兔机米根据你的数字之我挑选，不是中心推荐。',
    cards: [],
    preferences: input.preferences || [],
    notice,
  });
  if (!input.items.length) {
    return { ok: true, view: empty('还没有新内容。') };
  }
  const selected = await selectNetworkItems({
    digitalSelf: input.digitalSelf,
    items: input.items,
    chatComplete: input.chatComplete,
    model: input.model,
    ...(input.preferenceDirectives ? { preferenceDirectives: input.preferenceDirectives } : {}),
  });
  if (!selected.ok) {
    return {
      ok: false,
      error: selected.error,
      detail: selected.detail,
      view: empty('这次没能判断哪些内容值得看。'),
    };
  }
  await fs.mkdir(path.dirname(input.feedbackFile), { recursive: true });
  for (const row of selected.decisions) {
    await appendNetworkContentFeedback(
      input.feedbackFile,
      createAiJudgmentFeedback({
        subjectId: input.digitalSelf.subjectId,
        contentId: row.itemId,
        action: row.decision === 'show' ? 'SHOW' : 'IGNORE',
      }),
    );
  }
  const byId = new Map(input.items.map((item) => [item.itemId, item]));
  const cards: DiscoverCard[] = selected.decisions
    .filter((row) => row.decision === 'show')
    .map((row) => {
      const item = byId.get(row.itemId);
      return cardFromNetworkItem(
        item ||
          ({
            itemId: row.itemId,
            content: { title: row.itemId, text: '' },
          } as NetworkItem),
        row.reason,
        'directory',
      );
    });
  return {
    ok: true,
    view: {
      headline: '发现',
      lead: '兔机米根据你的数字之我挑选，不是中心推荐。',
      cards,
      preferences: input.preferences || [],
      notice: cards.length ? '' : '这次没有值得现在看的内容。',
    },
  };
}

export async function digitalSelfBytes(packageRoot: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(digitalSelfFilePath(packageRoot));
  } catch {
    return null;
  }
}
