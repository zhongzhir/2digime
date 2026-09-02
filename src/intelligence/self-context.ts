import { liveUnderstandings } from '../subject-core/digital-self/view';
import type { DigitalSelf, Understanding } from '../subject-core/digital-self/types';

/**
 * 为当前交流选择必要 Digital Self。
 * 第一版数据量小时返回全部 current 认识；utterance 留给以后做 relevance，不是第二份 memory。
 */
export function selectSelfContext(self: DigitalSelf, _utterance: string): Understanding[] {
  return liveUnderstandings(self).filter((item) => item.status === 'current');
}

export function formatSelfContext(items: Understanding[]): string {
  if (!items.length) {
    return '当前还没有已写入的数字之我认识。读取失败不得假装了解用户。';
  }
  return items.map((item) => `- ${item.text}`).join('\n');
}
