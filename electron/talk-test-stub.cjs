'use strict';
/**
 * 仅测试注入：让 2digime talk 循环可在无真实模型时走通工具调用。
 * 不是产品路由，不得迁入 runtime。
 */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function systemText(messages) {
  const sys = messages.find((m) => m.role === 'system');
  return String((sys && sys.content) || '');
}

function lastRole(messages) {
  const last = messages[messages.length - 1];
  return last ? last.role : '';
}

async function chat({ messages, tools }) {
  if (lastRole(messages) === 'tool') {
    const toolMsg = messages[messages.length - 1];
    let parsed = {};
    try {
      parsed = JSON.parse(toolMsg.content || '{}');
    } catch {
      parsed = {};
    }
    const summary = String(parsed.summary || '');
    return {
      text: JSON.stringify({
        deliver: true,
        userReply: summary ? `已经完成。\n\n${summary.slice(0, 800)}` : '已经完成你要的这件事。',
        askUser: '',
        openGoal: '',
        revision: '',
      }),
    };
  }

  const text = lastUserText(messages);
  const sys = systemText(messages);
  const hasTools = Array.isArray(tools) && tools.some((t) => t.function && t.function.name === 'delegate');

  if (/了解我|你知道我|我是谁/.test(text)) {
    const start = sys.indexOf('当前对用户的必要理解');
    const endExternal = sys.indexOf('当前已连接的外部能力');
    const endLegacy = sys.indexOf('当前已连接的专业能力');
    const end = endExternal >= 0 ? endExternal : endLegacy;
    const slice = start >= 0 ? sys.slice(start, end >= 0 ? end : undefined) : '';
    const facts = slice
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- ') && !line.startsWith('- id:'))
      .map((line) => line.slice(2));
    const body = facts.length
      ? `我现在这样理解你：\n${facts.map((f) => `· ${f}`).join('\n')}`
      : '我还没有记下关于你的认识。';
    return { text: body };
  }

  if (/改得更简洁|更简洁/.test(text)) {
    return {
      text: '开会讨论了很多，下周再确认方案细节。',
    };
  }

  if (/邮箱|发给|寄给|邮件/.test(text) && !/@/.test(text)) {
    return { text: '把说明发给谁可以，但我还没有对方的邮箱。请告诉我邮箱地址，我继续原来这件事。' };
  }

  if (/@/.test(text) && /继续|邮箱|发给|寄/.test(sys + text)) {
    return { text: '好，我记下这个地址，继续原来要把说明发出去这件事。这一步还缺真正的发信能力，所以先停在这里，不会假装已经发出。' };
  }

  if (hasTools && /(写|备忘|文档|说明|待办|三件)/.test(text)) {
    return {
      text: '',
      toolCalls: [
        {
          id: 'call_delegate_1',
          name: 'delegate',
          arguments: JSON.stringify({
            instruction: text,
          }),
        },
      ],
    };
  }

  return { text: '我在。你可以直接说想了解的事，或想让我做成的事。' };
}

module.exports = { chat };
