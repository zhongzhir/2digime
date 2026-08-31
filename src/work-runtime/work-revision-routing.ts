/**
 * Owner 修订路由判定（FIX-22）。
 * 区分 system_auto_revision / user_directed_revision / consultation / clarify。
 * 不新建第二状态机：仅供 work.converse 效果层与测试使用。
 */

import { isCurrentTaskConsult } from './work-cto-consult';

export type OwnerRevisionRoute =
  | 'system_auto_revision'
  | 'user_directed_revision'
  | 'queue_revision'
  | 'consultation'
  | 'clarify_revision'
  | 'none';

/** 含糊或仅表态、尚未给出可执行修改点。 */
export function isVagueOwnerRevision(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isClearOwnerDirectedRevision(t)) return false;
  if (isConcreteQueuedRevision(t)) return false;
  if (isCurrentTaskConsult(t)) return false;
  if (
    /我在想|要不要把|或许|可能吧|你觉得|怎么样|好不好|再看看|随便改改|弄弄|整体再优化一下|有空再改/.test(
      t,
    )
  ) {
    return true;
  }
  // 纯讨论且无具体改动点
  if (/^(嗯|好的|再说|看看|考虑一下)[.。!！]?$/i.test(t)) return true;
  return false;
}

/**
 * Owner 明确提出的可执行修订（含「按你说的改」+ 具体改成 X）。
 * 咨询类句子不得命中。
 */
export function isClearOwnerDirectedRevision(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isCurrentTaskConsult(t)) return false;
  // 授权继续 + 具体目标
  if (/按你说的改|按这个改|继续改|请改|改一下|改成|改成|改回|改到|改写|改掉|变成|改为|同步测试/.test(t)) {
    return true;
  }
  // 「把 A 改成 B」「返回值…改…」
  if (/把.{1,40}改|改成\s*\S+|返回值.{0,20}(改|变)|改成\s*done\b/i.test(t)) {
    return true;
  }
  // 具体反馈式修改点（非空泛）
  if (
    /(太慢|太快|太大|太小|太密|太稀|看不清|挡住|少了|挪到|改稀|改快|改大|不符合我的要求).{0,40}/.test(
      t,
    )
  ) {
    return true;
  }
  if (/继续修改/.test(t)) return true;
  return false;
}

/**
 * 已有成果上的具体修改要求：足够形成修订，但尚未说「开始做」。
 * 例如设计/排版优化，或额外要一份 Word。不把含糊「整体再优化一下」算进来。
 */
export function isConcreteQueuedRevision(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isCurrentTaskConsult(t)) return false;
  if (isOwnerStartNowPhrase(t)) return false;
  if (isClearOwnerDirectedRevision(t)) return false;
  if (
    /(界面|版式|排版|设计).{0,24}(太简单|单调|不好看|简陋|太素)/.test(t) ||
    /优化.{0,16}(设计|排版|版式|布局)/.test(t) ||
    /再提供一份\s*(Word|PPT|文档|报告)/i.test(t) ||
    /另外再.{0,12}(Word|PPT|文档)/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** 用户授权动手执行最近记下的修订。 */
export function isOwnerStartNowPhrase(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isCurrentTaskConsult(t)) return false;
  return /^(好的?[，, ]*)?(开始做吧|开始吧|动手吧|现在开始|开始做)[。.!！]*$/.test(t);
}

/**
 * 当前已有待接受成果时的显式结束确认。
 * 只在该上下文使用，不是全局关键词路由。
 */
export function isExplicitCurrentResultAcceptance(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isClearOwnerDirectedRevision(t)) return false;
  if (isCurrentTaskConsult(t)) return false;
  return /^(好的?[，, ]*)?(采用|接受(这一?版|这个版本|这份成果)?|就这样|就用这[一份版]|可以了|定稿|不用再改了)[。.!！]*$/.test(
    t,
  );
}

/**
 * 在已有成果上下文下，将用户原文与模型意图映射为路由种类。
 * system_auto_revision 不由本函数从用户原文产生（仅系统环使用）。
 */
export function classifyOwnerRevisionRoute(input: {
  userText: string;
  hasArtifact: boolean;
  intent?: string;
}): OwnerRevisionRoute {
  const text = String(input.userText || '').trim();
  if (!text) return 'none';
  if (isCurrentTaskConsult(text)) return 'consultation';
  if (!input.hasArtifact) return 'none';
  if (isVagueOwnerRevision(text)) return 'clarify_revision';
  if (isExplicitCurrentResultAcceptance(text)) return 'none';
  if (isClearOwnerDirectedRevision(text)) return 'user_directed_revision';
  if (isConcreteQueuedRevision(text)) return 'queue_revision';
  if (input.intent === 'artifact_feedback') {
    // 模型已判为成果反馈但启发式未标明确：保守澄清，避免静默执行
    return 'clarify_revision';
  }
  return 'none';
}
