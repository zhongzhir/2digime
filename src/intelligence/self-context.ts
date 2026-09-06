import { liveUnderstandings, sourceLabel, confirmationLabel } from '../subject-core/digital-self/view';
import type { DigitalSelf, Understanding } from '../subject-core/digital-self/types';

/**
 * 把系统已经掌握的主体信息交给模型。
 * status 表示确定程度，不决定模型能不能看见。
 * 不按当前这句话做 relevance 筛选。
 */
export function selectSelfContext(self: DigitalSelf, _utterance: string): Understanding[] {
  return liveUnderstandings(self);
}

export function formatSelfContext(items: Understanding[]): string {
  if (!items.length) {
    return '当前还没有已写入的数字之我认识。读取失败不得假装了解用户。';
  }
  const confirmed = items.filter((item) => item.status === 'current');
  const pending = items.filter((item) => item.status === 'candidate' || item.status === 'needs_ask');
  const lines = [
    '已确认的是本人事实。尚待确认的有来源依据，可以使用，但不得说成已经确认。是否与当前问题有关由你判断。',
  ];
  if (confirmed.length) {
    lines.push('已确认：');
    for (const item of confirmed) {
      lines.push(`- ${item.text}`);
    }
  } else {
    lines.push('已确认：无');
  }
  if (pending.length) {
    lines.push('尚待确认：');
    for (const item of pending) {
      lines.push(`- ${item.text}（${sourceLabel(item)}；${confirmationLabel(item)}）`);
    }
  }
  return lines.join('\n');
}
