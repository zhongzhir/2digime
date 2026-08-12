import type { SpawnOptions, SpawnSyncOptions } from 'node:child_process';

/**
 * Coding Agent / 本地命令必须静默后台：不弹可见控制台、不用 cmd 包装。
 * windowsHide 对应 CREATE_NO_WINDOW；stdio 全部 pipe，避免继承父控制台。
 */
export function hiddenSpawnOptions(
  extra: SpawnOptions = {},
): SpawnOptions {
  return {
    ...extra,
    shell: false,
    windowsHide: true,
    detached: false,
    stdio: extra.stdio ?? ['pipe', 'pipe', 'pipe'],
  };
}

export function hiddenSpawnSyncOptions(
  extra: SpawnSyncOptions = {},
): SpawnSyncOptions {
  return {
    ...extra,
    shell: false,
    windowsHide: true,
    stdio: extra.stdio ?? ['pipe', 'pipe', 'pipe'],
  };
}

export function assertSilentSpawn(opts: {
  shell?: boolean | string;
  windowsHide?: boolean;
  detached?: boolean;
}): void {
  if (opts.shell) {
    throw new Error('silent spawn must not use shell');
  }
  if (process.platform === 'win32' && opts.windowsHide !== true) {
    throw new Error('silent spawn must set windowsHide on Windows');
  }
  if (opts.detached) {
    throw new Error('silent spawn must not detach');
  }
}
