/**
 * Playwright Electron 启动：真实窗口 + preload IPC，隔离 userData。
 */
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

export const REPO_ROOT = path.resolve(__dirname, '../../..');

export const DEV_MODEL_CREDENTIAL_FILE = path.join(
  REPO_ROOT,
  'scripts',
  '_mvp-p14-real-capability-evidence',
  '.runtime-model-credential.json',
);

/** 正式安装的 AppData，测试不得写入其 default Thread。 */
export function officialAppUserDataPath(): string {
  const appData = process.env.APPDATA || process.env.HOME || os.homedir();
  return path.join(appData, 'digitalme-v2');
}

export function hasTestModelCredential(): boolean {
  return existsSync(DEV_MODEL_CREDENTIAL_FILE);
}

export async function isolatedUserDataDir(prefix = 'dmv2-electron-ud-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface ElectronHarness {
  app: ElectronApplication;
  page: Page;
  userData: string;
  close: () => Promise<void>;
}

export async function launchDigitalMeElectron(opts?: {
  exportDelayMs?: number;
  extraEnv?: Record<string, string>;
  /** 复用已有隔离 userData（重启验收）。未提供则新建临时目录。不得指向正式 AppData。 */
  userData?: string;
  /** 正式产品闸门：不启用 UX Fake / Electron test harness stub。 */
  realProduct?: boolean;
}): Promise<ElectronHarness> {
  const userData = opts?.userData || (await isolatedUserDataDir());
  const official = path.resolve(officialAppUserDataPath());
  const resolvedUserData = path.resolve(userData);
  if (resolvedUserData === official || resolvedUserData.startsWith(official + path.sep)) {
    throw new Error('tests must not use the official AppData userData / default Thread');
  }
  let electronPath: string;
  try {
    electronPath = require('electron') as string;
  } catch {
    throw new Error('electron 未安装');
  }
  if (typeof electronPath !== 'string') {
    throw new Error('require(electron) 未返回可执行路径');
  }
  const realProduct = opts?.realProduct === true;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...process.env,
    DIGITALME_V2_ROOT: REPO_ROOT,
    ...(realProduct
      ? {
          DIGITALME_V2_ELECTRON_TEST: '0',
          DIGITALME_V2_UX_ACCEPTANCE: '0',
          DIGITALME_V2_DIGITAL_SELF_STUB: '0',
          DIGITALME_V2_TALK_STUB: '0',
        }
      : {
          DIGITALME_V2_ELECTRON_TEST: '1',
          DIGITALME_V2_UX_ACCEPTANCE: '1',
          DIGITALME_V2_SEARCH_ENABLED: '0',
          DIGITALME_V2_EXPORT_DELAY_MS: String(opts?.exportDelayMs ?? 0),
        }),
    DIGITALME_V2_USER_DATA: userData,
    ELECTRON_ENABLE_LOGGING: '1',
    ...(opts?.extraEnv || {}),
  })) {
    if (typeof value === 'string' && value !== '') env[key] = value;
  }
  for (const [key, value] of Object.entries(opts?.extraEnv || {})) {
    if (value === '') delete env[key];
  }
  const playwright = await import('playwright');
  const app = await playwright._electron.launch({
    executablePath: electronPath,
    args: [path.join(REPO_ROOT, 'electron', 'main.cjs')],
    cwd: REPO_ROOT,
    timeout: 60_000,
    env,
  });
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForLoadState('domcontentloaded');
    return {
      app,
      page,
      userData,
      close: async () => {
        try {
          await app.close();
        } catch {
          /* ignore */
        }
      },
    };
  } catch (err) {
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function skipWelcomeAndEnterShell(page: Page): Promise<void> {
  const shellReady = async () => {
    const shell = page.locator('#view-shell');
    const input = page.locator('#chat-input');
    return (await shell.isVisible().catch(() => false)) && (await input.isVisible().catch(() => false));
  };
  if (await shellReady()) return;
  const skipModel = page.locator('#btn-welcome-skip-model');
  if (await skipModel.isVisible().catch(() => false)) {
    await skipModel.click({ force: true });
  }
  const skipIntro = page.locator('#btn-create-skip');
  if (await skipIntro.isVisible().catch(() => false)) {
    await skipIntro.click({ force: true });
  }
  await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 20_000 });
  const chatNav = page.locator('#nav-chat');
  if (await chatNav.isVisible().catch(() => false)) {
    await chatNav.dispatchEvent('click');
  }
  await page.locator('#panel-chat').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 15_000 });
}

export async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.locator('#chat-input');
  await input.waitFor({ state: 'visible' });
  const before = await page.locator('.chat-turn-assistant').count();
  await input.fill(text);
  await page.locator('#btn-chat-send').click();
  await page.locator('.chat-turn-assistant').nth(before).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#btn-chat-send:not([disabled])').waitFor({ state: 'visible', timeout: 30_000 });
}

export async function waitForOverviewName(page: Page, name: string, timeoutMs = 45_000): Promise<void> {
  await page.locator('#nav-subject').click();
  const known = page.locator('#growth-cockpit-known');
  try {
    await known.getByText(name).waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    await page.locator('#btn-growth-understanding').click();
    await page.locator('#growth-understanding-list').getByText(name).waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page.locator('#nav-chat').click();
  await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 10_000 });
}

export async function assistantTurnText(page: Page): Promise<string> {
  return page.locator('#chat-turns').innerText();
}
