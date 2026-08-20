/**
 * 试运行探测 — 根据项目事实派生，不持久化第二状态机。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type ProjectRunKind = 'npm_script' | 'html' | 'python' | 'command';

export type ProjectRunInfo = {
  runnable: boolean;
  kind?: ProjectRunKind;
  /** 面向用户的短说明 */
  label?: string;
  command?: string;
  entryPath?: string;
  reason?: string;
  /** 仅当启动检查通过时为 true；探测到命令不等于可以试用 */
  canSuggestTryRun?: boolean;
};

const NPM_RUN_PRIORITY = ['start', 'dev', 'serve', 'preview', 'play'] as const;

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * 探测工作目录是否可被 Digital Me 可靠发起试运行。
 * 不可靠时 runnable=false，不得假报可运行。
 */
export async function detectProjectRunInfo(
  workingDirectory: string,
  hints?: { knownCommands?: string[] },
): Promise<ProjectRunInfo> {
  const root = path.resolve(workingDirectory);
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) {
      return { runnable: false, reason: '项目目录无效' };
    }
  } catch {
    return { runnable: false, reason: '找不到项目目录' };
  }

  const pkg = await readJsonSafe(path.join(root, 'package.json'));
  if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
    const scripts = pkg.scripts as Record<string, unknown>;
    for (const name of NPM_RUN_PRIORITY) {
      if (typeof scripts[name] === 'string' && String(scripts[name]).trim()) {
        return {
          runnable: true,
          kind: 'npm_script',
          label: `可使用 npm run ${name} 试运行`,
          command: `npm run ${name}`,
        };
      }
    }
  }

  for (const hint of hints?.knownCommands || []) {
    const cmd = String(hint || '').trim();
    if (!cmd) continue;
    if (/^(npm|pnpm|yarn|node|python|py)\b/i.test(cmd) && !/\btest\b/i.test(cmd)) {
      return {
        runnable: true,
        kind: 'command',
        label: '已发现可用的运行命令',
        command: cmd,
      };
    }
  }

  for (const htmlName of ['index.html', 'game.html', 'play.html']) {
    const entry = path.join(root, htmlName);
    if (await fileExists(entry)) {
      return {
        runnable: true,
        kind: 'html',
        label: '可用浏览器打开页面试玩',
        entryPath: entry,
      };
    }
  }

  for (const pyName of ['main.py', 'app.py', 'game.py', 'run.py']) {
    const entry = path.join(root, pyName);
    if (await fileExists(entry)) {
      return {
        runnable: true,
        kind: 'python',
        label: '可用 Python 运行入口文件',
        command: `python "${pyName}"`,
        entryPath: entry,
      };
    }
  }

  return {
    runnable: false,
    reason: '还不能可靠自动打开这个程序',
  };
}
