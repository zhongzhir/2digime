/**
 * B 侧规则内自动评估：结论必须来自 B 的边界/能力/策略，不是 A 代判。
 * 越界或高风险 → 请求 Owner JIT 确认。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { CollaborationProposalTerms } from './schema';

export type EvaluationDecision =
  | 'accept'
  | 'reject'
  | 'counter_propose'
  | 'request_clarification'
  | 'require_owner_confirmation';

export interface EvaluationResult {
  decision: EvaluationDecision;
  terms?: CollaborationProposalTerms;
  note: string;
  basis: string[];
  requiresOwnerConfirmation: boolean;
}

const HIGH_RISK =
  /支付|转账|对外发布|公开发布|删除全部|不可逆|永久删除|泄露|密钥|凭证|隐私外发/;

function textBlob(terms: CollaborationProposalTerms): string {
  return [
    terms.intent,
    terms.expectedOutcome,
    ...terms.acceptanceCriteria,
    ...terms.offeredMaterials.map((m) => `${m.path} ${m.summary || ''}`),
  ]
    .join('\n')
    .toLowerCase();
}

export async function evaluateProposalForSubject(
  runtime: DigitalMeRuntime,
  terms: CollaborationProposalTerms,
): Promise<EvaluationResult> {
  const basis: string[] = [];
  const blob = textBlob(terms);

  if (!terms.intent.trim()) {
    return {
      decision: 'request_clarification',
      note: '协作意图不明确，需要补充说明。',
      basis: ['missing_intent'],
      requiresOwnerConfirmation: false,
    };
  }
  if (!terms.acceptanceCriteria.length) {
    return {
      decision: 'request_clarification',
      note: '缺少验收条件，请补充怎样算完成。',
      basis: ['missing_acceptance_criteria'],
      requiresOwnerConfirmation: false,
      terms: {
        ...terms,
        acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
      },
    };
  }
  if (!terms.offeredMaterials.length) {
    return {
      decision: 'request_clarification',
      note: '未提供可分析材料，请补充材料后再议。',
      basis: ['missing_materials'],
      requiresOwnerConfirmation: false,
    };
  }

  const events = await runtime.subject.listGrowthEvents();
  const boundaries = events.filter(
    (e) => e.confidence === 'confirmed' && e.type === 'boundary_updated',
  );
  for (const b of boundaries) {
    const detail = `${b.payload.title}\n${b.payload.detail}`.trim();
    const key = detail.toLowerCase();
    // 边界禁词：从「不…X」抽取 X；或边界与提议共享敏感主题词
    const forbidMatch = detail.match(
      /不(?:得|要|可|能|允许)?\s*([\u4e00-\u9fffA-Za-z0-9]{2,16})/,
    );
    if (forbidMatch?.[1]) {
      const token = forbidMatch[1].toLowerCase();
      if (blob.includes(token)) {
        basis.push(`boundary:${b.id}:${forbidMatch[1]}`);
        return {
          decision: 'reject',
          note: `根据我的边界，不能接受该协作：${detail.slice(0, 120)}`,
          basis,
          requiresOwnerConfirmation: false,
        };
      }
    }
    const sensitiveTopics = ['薪酬', '薪资', '工资', '保密', '密钥', '隐私'];
    for (const topic of sensitiveTopics) {
      if (key.includes(topic) && /不|禁止|不得/.test(key) && blob.includes(topic)) {
        basis.push(`boundary:${b.id}:${topic}`);
        return {
          decision: 'reject',
          note: `根据我的边界，不能接受该协作：${detail.slice(0, 120)}`,
          basis,
          requiresOwnerConfirmation: false,
        };
      }
    }
  }

  // 能力可用性：Registry 至少注册一种能力
  const caps = await runtime.listCapabilities({});
  const registered = caps.capabilities || [];
  if (!registered.length) {
    basis.push('no_available_capability');
    return {
      decision: 'reject',
      note: '当前没有可用能力完成该协作。',
      basis,
      requiresOwnerConfirmation: false,
    };
  }
  basis.push(`capability_count:${registered.length}`);

  if (HIGH_RISK.test(blob)) {
    basis.push('high_risk_commitment');
    return {
      decision: 'require_owner_confirmation',
      note: '该协作涉及高风险承诺，需要我的主人确认。',
      basis,
      requiresOwnerConfirmation: true,
    };
  }

  // 轻微还价：无时限时提出默认时限
  if (!terms.deadline) {
    const counter: CollaborationProposalTerms = {
      ...terms,
      deadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };
    basis.push('counter_default_deadline');
    return {
      decision: 'counter_propose',
      terms: counter,
      note: '可以接受，但建议约定 24 小时内完成。',
      basis,
      requiresOwnerConfirmation: false,
    };
  }

  basis.push('within_autonomy');
  return {
    decision: 'accept',
    terms,
    note: '在我的规则与能力范围内，可以接受。',
    basis,
    requiresOwnerConfirmation: false,
  };
}

export function selfCheckDelivery(input: {
  text: string;
  terms: CollaborationProposalTerms;
}): { passed: boolean; notes: string[] } {
  const notes: string[] = [];
  const text = (input.text || '').trim();
  if (text.length < 40) {
    notes.push('成果过短');
  }
  for (const criterion of input.terms.acceptanceCriteria) {
    const key = criterion.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '').slice(0, 8);
    if (key && !text.includes(key) && !text.includes(criterion.slice(0, 6))) {
      notes.push(`自检未直接覆盖验收条件：${criterion.slice(0, 40)}`);
    }
  }
  return { passed: notes.length === 0 && text.length >= 40, notes };
}

export function verifyDeliveryByInitiator(input: {
  text: string;
  terms: CollaborationProposalTerms;
  contentDigestMatches: boolean;
}): { satisfied: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!input.contentDigestMatches) notes.push('内容摘要与对方交付不一致');
  if ((input.text || '').trim().length < 40) notes.push('成果过短，不满足基本完成标准');
  for (const criterion of input.terms.acceptanceCriteria) {
    const probe = criterion.slice(0, 4);
    if (probe && !(input.text || '').includes(probe)) {
      notes.push(`可能未满足：${criterion.slice(0, 60)}`);
    }
  }
  // 发起方最终判断：有明显硬伤则不满足；软提示不自动否决
  const hard = notes.some((n) => n.includes('不一致') || n.includes('过短'));
  return { satisfied: !hard, notes };
}
