#!/usr/bin/env node
'use strict';
/**
 * 开发启动：独立参考「研究分析能力」服务。
 * 不设置产品环境变量，不修改 Digital Me 配置。
 * 仅在进程存活、端口监听、Agent Card 与执行端点就绪后打印「已启动」。
 */
const {
  startResearchA2AAgent,
} = require('./_research-a2a-agent-lifecycle.cjs');

async function main() {
  const agent = await startResearchA2AAgent({});
  console.log('');
  console.log('参考研究分析能力已启动');
  console.log(`服务地址：${agent.baseUrl}`);
  console.log('请先运行：npm run verify:reference-research-agent');
  console.log('然后在 Digital Me → 协作 → 协作对象 → 外部专业能力 中连接。');
  console.log('按 Ctrl+C 停止本服务。');
  console.log('');
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    try {
      await agent.stop();
    } catch {
      /* ignore */
    }
    process.exit(code);
  };
  agent.child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(
      `参考研究能力进程已退出（code=${code ?? 'null'} signal=${signal || 'none'}）`,
    );
    void stop(code || 1);
  });
  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));
  // 阻塞直至信号或子进程退出，避免 npm/Windows 下父进程提前结束
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
