'use strict';
/**
 * Electron 验收用模型双。只在 DIGITALME_V2_DIGITAL_SELF_STUB=1 时加载。
 * 不是产品语义路由：产品路径始终把原文交给模型。
 */

function section(prompt, name) {
  const token = `===DIGITAL_SELF_${name}===`;
  const start = prompt.indexOf(token);
  if (start < 0) return '';
  const after = start + token.length;
  const next = prompt.indexOf('===DIGITAL_SELF_', after);
  return (next < 0 ? prompt.slice(after) : prompt.slice(after, next)).trim();
}

function parseCurrent(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function live(current) {
  return current.filter(
    (item) => item && (item.status === 'current' || item.status === 'candidate' || item.status === 'needs_ask'),
  );
}

function findByText(current, re) {
  return live(current).find((item) => re.test(String(item.text || '')));
}

function tell(text, current) {
  const t = String(text || '').trim();
  if (t.includes('我以后更喜欢上午处理复杂工作') || (t.includes('上午') && t.includes('复杂工作'))) {
    return {
      understandings: [
        {
          text: '用户更喜欢上午处理复杂工作',
          facet: 'preferences',
          aboutUser: true,
          origin: 'user_statement',
        },
      ],
    };
  }
  if (/今天下午三点开会/.test(t) && !/喜欢|偏好|以后/.test(t)) {
    return { understandings: [] };
  }
  if (/工程安全类外部合作我不参与/.test(t)) {
    return {
      understandings: [
        {
          text: '用户不参与工程安全类外部合作',
          facet: 'boundaries',
          aboutUser: true,
          origin: 'user_statement',
        },
      ],
    };
  }
  if (
    /低风险非最终责任意见可以提供/.test(t) ||
    /愿意参与低风险工艺安全分析/.test(t) ||
    (/低风险/.test(t) && /可以提供/.test(t))
  ) {
    const old = findByText(current, /不参与工程安全|工程安全类外部合作/);
    return {
      understandings: [
        {
          text: '用户可以提供低风险、非最终责任的工艺安全意见，高风险工程决策仍需先问本人',
          facet: 'boundaries',
          aboutUser: true,
          origin: 'user_statement',
          replacesId: old ? old.id : undefined,
        },
      ],
    };
  }
  if (/以后涉及高风险工程决策都先问我/.test(t) || /高风险工程决策仍要问我/.test(t)) {
    const old = findByText(current, /不参与工程安全|工程安全|工艺安全/);
    return {
      understandings: [
        {
          text: '高风险工程决策需要先问用户',
          facet: 'boundaries',
          aboutUser: true,
          origin: 'user_statement',
          replacesId: old ? old.id : undefined,
        },
      ],
    };
  }
  if (t.includes('我喜欢早起')) {
    return {
      understandings: [
        {
          text: '用户喜欢早起处理事情',
          facet: 'preferences',
          aboutUser: true,
          origin: 'user_statement',
        },
      ],
    };
  }
  if (t.includes('我叫张三')) {
    const existing = findByText(current, /张三/);
    if (existing) {
      return {
        understandings: [
          {
            text: '姓名是张三',
            facet: 'about_me',
            aboutUser: true,
            origin: 'user_statement',
            mergeWithId: existing.id,
          },
        ],
      };
    }
    const otherName = findByText(current, /姓名是|叫/);
    if (otherName && !String(otherName.text).includes('张三')) {
      return {
        understandings: [
          {
            text: '姓名是张三',
            facet: 'about_me',
            aboutUser: true,
            origin: 'user_statement',
            isCoreIdentity: true,
            mustAsk: true,
            conflictsWithId: otherName.id,
          },
        ],
      };
    }
    return {
      understandings: [
        {
          text: '姓名是张三',
          facet: 'about_me',
          aboutUser: true,
          origin: 'user_statement',
          isCoreIdentity: true,
        },
      ],
    };
  }
  if (t.includes('我现在主要在做 A 项目') || t.includes('主要在做 A 项目')) {
    return {
      understandings: [
        {
          text: '当前主要在做 A 项目',
          facet: 'context',
          aboutUser: true,
          origin: 'user_statement',
        },
      ],
    };
  }
  if (t.includes('刚才那个不对') || (t.includes('应该是 B') && findByText(current, /A 项目/))) {
    const old = findByText(current, /A 项目/);
    return {
      understandings: [
        {
          text: '当前主要在做 B 项目',
          facet: 'context',
          aboutUser: true,
          origin: 'user_statement',
          replacesId: old ? old.id : undefined,
        },
      ],
    };
  }
  return { understandings: [], notice: '没有从这句话里得到关于你本人的新理解。' };
}

function isUnrelatedDump(text) {
  return /量子物理|薛定谔|波函数|氢原子|泡利/.test(text);
}

function importMaterial(text, current) {
  const understandings = [];
  if (/我叫李四|姓名[是:：]\s*李四/.test(text)) {
    const zhang = findByText(current, /张三/);
    understandings.push({
      text: '姓名是李四',
      facet: 'about_me',
      aboutUser: true,
      origin: 'material',
      isCoreIdentity: true,
      mustAsk: true,
      conflictsWithId: zhang ? zhang.id : undefined,
    });
  }
  if (/张三/.test(text) && /项目/.test(text) && !findByText(current, /张三/)) {
    understandings.push({
      text: '姓名是张三',
      facet: 'about_me',
      aboutUser: true,
      origin: 'material',
      isCoreIdentity: true,
      mustAsk: true,
    });
  }
  if (/我喜欢早起/.test(text) && !findByText(current, /早起/)) {
    understandings.push({
      text: '偏好早起处理事情',
      facet: 'preferences',
      aboutUser: true,
      origin: 'material',
    });
  }
  if (isUnrelatedDump(text)) {
    return {
      understandings,
      notice: understandings.length
        ? '只记下了可能与你有关的部分，其余内容没有写成「我」。'
        : '这份资料里没有发现需要记入数字之我的内容。',
    };
  }
  return { understandings };
}

async function chat(input) {
  const messages = (input && input.messages) || [];
  const user = messages.filter((m) => m && m.role === 'user').pop();
  const prompt = (user && user.content) || '';
  const mode = section(prompt, 'MODE');
  const current = parseCurrent(section(prompt, 'CURRENT'));
  const body = section(prompt, 'INPUT');
  const result = mode === 'import' ? importMaterial(body, current) : tell(body, current);
  return { text: JSON.stringify(result) };
}

module.exports = { chat };
