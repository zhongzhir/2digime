/**
 * Talk → Digital Self 真实模型闸门。
 * 正式 Electron + 正式入口 + 真实模型。不使用 talk/digital-self stub。
 * 不把真人原句写入 stub。失败只分层定位，不改 prompt / 不加句式规则。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  REPO_ROOT,
} from '../../runtime/tests/electron-harness';
import { digitalSelfFilePath } from '../../subject-core/digital-self/store';
import type { DigitalSelf, Understanding } from '../../subject-core/digital-self/types';

const EVIDENCE = path.join(REPO_ROOT, 'scripts', '_talk-to-digital-self-05-real');
const SELF_TRACE = path.join(EVIDENCE, 'raw-digital-self');
const TALK_TRACE = path.join(EVIDENCE, 'raw-talk');

const UTTER_BOUNDARY =
  '涉及工程安全判断的外部合作，我目前不参与。';
const UTTER_CORRECT =
  '对低风险、非最终责任性质的工艺安全分析，我愿意提供意见；高风险工程决策仍需要我本人确认。';
const UTTER_MEETING = '今天下午三点开会。';

type Layer = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | null;

type TraceRow = {
  file: string;
  stub: boolean;
  kind: string | null;
  model: string | null;
  host: string | null;
  input: string;
  understandings: Array<{
    text?: string;
    origin?: string;
    facet?: string;
    replacesId?: string | null;
    conflictsWithId?: string | null;
    mustAsk?: boolean;
  }>;
  parseError?: string;
};

async function enterProductShell(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const shell = await page.locator('#view-shell').isVisible().catch(() => false);
    const input = await page.locator('#chat-input').isVisible().catch(() => false);
    if (shell && input) return;
    for (const id of ['btn-welcome-skip-model', 'btn-welcome-skip-model-2', 'btn-create-skip']) {
      const btn = page.locator(`#${id}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(600);
      }
    }
    await page.waitForTimeout(400);
  }
  await skipWelcomeAndEnterShell(page);
}

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string, waitMs = 800_000): Promise<void> {
  await page.locator('#nav-chat').dispatchEvent('click');
  await page.locator('#panel-chat').waitFor({ state: 'visible', timeout: 20_000 });
  const before = await talkTurnCount(page);
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkTurnCount(page)) > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

async function openDigitalSelf(page: Page): Promise<void> {
  await page.locator('#nav-subject').waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-subject').dispatchEvent('click');
    const visible = await page.locator('#panel-subject').isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(400);
  }
  await page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 15_000 });
}

function section(prompt: string, name: string): string {
  const token = `===DIGITAL_SELF_${name}===`;
  const start = prompt.indexOf(token);
  if (start < 0) return '';
  const after = start + token.length;
  const next = prompt.indexOf('===DIGITAL_SELF_', after);
  return (next < 0 ? prompt.slice(after) : prompt.slice(after, next)).trim();
}

function parseJsonObject(text: string): unknown {
  const trimmed = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/u, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no json object');
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function listTraces(): Promise<TraceRow[]> {
  const names = (await fs.readdir(SELF_TRACE).catch(() => [] as string[]))
    .filter((n) => n.endsWith('.json'))
    .sort();
  const out: TraceRow[] = [];
  for (const name of names) {
    const raw = JSON.parse(await fs.readFile(path.join(SELF_TRACE, name), 'utf8')) as {
      stub?: boolean;
      kind?: string;
      model?: string;
      providerHost?: string;
      messages?: Array<{ role?: string; content?: string }>;
      text?: string;
    };
    const user = [...(raw.messages || [])].reverse().find((m) => m.role === 'user');
    const input = section(String(user?.content || ''), 'INPUT');
    let understandings: TraceRow['understandings'] = [];
    let parseError: string | undefined;
    try {
      const parsed = parseJsonObject(String(raw.text || '')) as {
        understandings?: TraceRow['understandings'];
      };
      understandings = Array.isArray(parsed.understandings) ? parsed.understandings : [];
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    out.push({
      file: name,
      stub: raw.stub === true,
      kind: raw.kind || null,
      model: raw.model || null,
      host: raw.providerHost || null,
      input,
      understandings,
      ...(parseError ? { parseError } : {}),
    });
  }
  return out;
}

async function readSelf(pkgDir: string): Promise<DigitalSelf | { missing: true; path: string }> {
  const file = digitalSelfFilePath(pkgDir);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as DigitalSelf;
  } catch {
    return { missing: true, path: file };
  }
}

function items(self: DigitalSelf | { missing: true }): Understanding[] {
  if ('missing' in self) return [];
  return self.understandings || [];
}

function liveOf(self: DigitalSelf | { missing: true }): Understanding[] {
  return items(self).filter(
    (row) => row.status === 'current' || row.status === 'candidate' || row.status === 'needs_ask',
  );
}

function currentOf(self: DigitalSelf | { missing: true }): Understanding[] {
  return items(self).filter((row) => row.status === 'current');
}

function looksLikeSafetyNonParticipation(text: string): boolean {
  return /工程安全|工艺安全|安全判断/.test(text) && /不参与|不介入|不承担/.test(text) && !/低风险/.test(text);
}

function looksLikeCorrectedSafetyBoundary(text: string): boolean {
  const low = /低风险/.test(text) && /意见|提供|分析/.test(text);
  const high = /高风险/.test(text) && /确认|先问|本人/.test(text);
  return low || high;
}

function looksLikeMeeting(text: string): boolean {
  return /三点/.test(text) && /开会/.test(text);
}

function extraAuthorityFiles(pkgDir: string): string[] {
  const names = [
    'memory.json',
    'profile.json',
    'learning-store.json',
    'conversation-memory.json',
    path.join('intelligence', 'memory.json'),
    path.join('digital-self', 'profile.json'),
  ];
  return names.filter((rel) => existsSync(path.join(pkgDir, rel)));
}

async function dumpShot(page: Page, tag: string): Promise<void> {
  await page.screenshot({ path: path.join(EVIDENCE, `${tag}.png`), fullPage: true });
}

async function invokeDigitalSelf(page: Page): Promise<unknown> {
  return page.evaluate(`(async () => {
    return window.digitalMe.invoke('digitalSelf', { action: 'read' });
  })()`);
}

function diagnoseFirstWrite(input: {
  tracesAfter: TraceRow[];
  tracesBeforeCount: number;
  self: DigitalSelf | { missing: true };
  pageText: string;
  view: unknown;
}): Layer {
  const fresh = input.tracesAfter.slice(input.tracesBeforeCount);
  const related = fresh.filter((row) => row.input.includes('工程安全判断的外部合作'));
  if (!related.length) return 'A';
  const row = related[related.length - 1];
  if (!row) return 'A';
  if (row.parseError) return 'B';
  if (!row.understandings.length) return 'B';
  const written = liveOf(input.self).some(
    (item) => looksLikeSafetyNonParticipation(item.text) || looksLikeCorrectedSafetyBoundary(item.text),
  );
  if (!written) return 'C';
  const viewText = JSON.stringify(input.view);
  if (!/工程安全|工艺安全|外部合作|不参与/.test(`${input.pageText}\n${viewText}`)) return 'E';
  return null;
}

function diagnoseCorrection(input: {
  tracesAfter: TraceRow[];
  tracesBeforeCount: number;
  self: DigitalSelf | { missing: true };
}): Layer {
  const fresh = input.tracesAfter.slice(input.tracesBeforeCount);
  const related = fresh.filter((row) => row.input.includes('低风险') && row.input.includes('高风险工程决策'));
  if (!related.length) return 'A';
  const row = related[related.length - 1];
  if (!row) return 'A';
  if (row.parseError || !row.understandings.length) return 'B';
  const current = currentOf(input.self);
  const oldStillCurrent = current.some((item) => looksLikeSafetyNonParticipation(item.text));
  const newCurrent = current.some((item) => looksLikeCorrectedSafetyBoundary(item.text));
  if (!newCurrent || oldStillCurrent) {
    const hasReplace = row.understandings.some((u) => !!u.replacesId);
    if (!hasReplace && oldStillCurrent) return 'D';
    if (!newCurrent) return 'C';
    return 'D';
  }
  return null;
}

test('真实模型：Talk 真人原句回流到唯一 Digital Self', { timeout: 2_400_000 }, async () => {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await fs.mkdir(SELF_TRACE, { recursive: true });
  await fs.mkdir(TALK_TRACE, { recursive: true });

  const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-self-real-pkg-'));
  const verdict: Record<string, unknown> = {
    stubForcedOff: true,
    layer: null as Layer,
    yellow: false,
    red: false,
    acceptedRecommended: false,
  };

  const extraEnv = {
    DIGITALME_V2_DIGITAL_SELF_STUB: '0',
    DIGITALME_V2_TALK_STUB: '0',
    DIGITALME_V2_UX_ACCEPTANCE: '0',
    DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
    DIGITALME_V2_DIGITAL_SELF_TRACE_DIR: SELF_TRACE,
    DIGITALME_V2_TALK_TRACE_DIR: TALK_TRACE,
  };

  let originalDir = '';
  const isolatedUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-self-real-ud-'));
  const first = await launchDigitalMeElectron({
    realProduct: true,
    userData: isolatedUserData,
    extraEnv,
  });

  try {
    await enterProductShell(first.page);
    const status = (await first.page.evaluate(`(async () => {
      return window.digitalMe.getModelStatus();
    })()`)) as {
      modelReady?: boolean;
      electronTest?: boolean;
      modelMeta?: { model?: string; baseUrlHost?: string };
      status?: {
        providerPreset?: string;
        model?: string;
        baseUrl?: string;
        modelMeta?: { model?: string; baseUrlHost?: string };
      };
    };
    verdict.modelStatus = {
      modelReady: status.modelReady === true,
      electronTest: status.electronTest === true,
      model: status.modelMeta?.model || status.status?.model || status.status?.modelMeta?.model || null,
      host: status.modelMeta?.baseUrlHost || status.status?.modelMeta?.baseUrlHost || null,
      baseUrl: status.status?.baseUrl || null,
      providerPreset: status.status?.providerPreset || null,
    };
    await fs.writeFile(
      path.join(EVIDENCE, 'model-status.json'),
      `${JSON.stringify(status, null, 2)}\n`,
      'utf8',
    );
    assert.equal(status.modelReady, true, '真实模型未接通');
    assert.equal(status.electronTest === true, false, '不应走 Electron test harness');
    const modelBlob = [
      status.modelMeta?.model,
      status.modelMeta?.baseUrlHost,
      status.status?.model,
      status.status?.baseUrl,
      status.status?.providerPreset,
      status.status?.modelMeta?.model,
      status.status?.modelMeta?.baseUrlHost,
    ]
      .filter(Boolean)
      .join(' ');
    assert.match(modelBlob, /deepseek/i, '本闸门要求真实 DeepSeek');

    const loc = (await first.page.evaluate(`(async () => {
      return window.digitalMe.getDefaultSubjectDir();
    })()`)) as { dir: string };
    originalDir = loc.dir;
    const created = (await first.page.evaluate(`(async (targetDir) => {
      return window.digitalMe.invoke('subject.createPackage', {
        displayName: 'Talk Self Real Gate',
        targetDir,
      });
    })(${JSON.stringify(pkgDir)})`)) as { subjectId?: string };
    verdict.subjectId = created.subjectId || null;
    verdict.packageDir = pkgDir;
    verdict.originalDir = originalDir;

    let tracesBefore = (await listTraces()).length;
    await sendTalk(first.page, UTTER_BOUNDARY);
    await dumpShot(first.page, '01-talk-boundary');
    const traces1 = await listTraces();
    const self1 = await readSelf(pkgDir);
    await openDigitalSelf(first.page);
    await dumpShot(first.page, '01-digital-self');
    const page1 = await first.page.locator('#digital-self-page').innerText();
    const view1 = await invokeDigitalSelf(first.page);
    await fs.writeFile(
      path.join(EVIDENCE, '01-self.json'),
      `${JSON.stringify({ self: self1, view: view1, pageText: page1 }, null, 2)}\n`,
      'utf8',
    );
    const layer1 = diagnoseFirstWrite({
      tracesAfter: traces1,
      tracesBeforeCount: tracesBefore,
      self: self1,
      pageText: page1,
      view: view1,
    });
    verdict.afterFirst = {
      layer: layer1,
      live: liveOf(self1).map((row) => ({
        text: row.text,
        status: row.status,
        facet: row.facet,
        origin: row.provenance.origin,
      })),
      traces: traces1.slice(tracesBefore),
    };
    if (layer1) {
      verdict.layer = layer1;
      await fs.writeFile(path.join(EVIDENCE, 'gate-verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
      assert.fail(`第一条真人原句未写入 Digital Self，层=${layer1}`);
    }
    const firstLive = liveOf(self1).filter(
      (row) => looksLikeSafetyNonParticipation(row.text) || looksLikeCorrectedSafetyBoundary(row.text),
    );
    assert.ok(firstLive.length > 0, '页面/权威未见语义等价的工程安全边界');
    assert.ok(
      firstLive.some((row) => row.provenance.origin === 'user_statement'),
      'provenance 不是 user_statement',
    );

    tracesBefore = traces1.length;
    await sendTalk(first.page, UTTER_MEETING);
    await dumpShot(first.page, '02-talk-meeting');
    const self2 = await readSelf(pkgDir);
    await openDigitalSelf(first.page);
    const page2 = await first.page.locator('#digital-self-page').innerText();
    await fs.writeFile(
      path.join(EVIDENCE, '02-self.json'),
      `${JSON.stringify({ self: self2, pageText: page2 }, null, 2)}\n`,
      'utf8',
    );
    const meetingPersisted = liveOf(self2).some((row) => looksLikeMeeting(row.text));
    verdict.afterMeeting = {
      persistedAsLongTerm: meetingPersisted,
      live: liveOf(self2).map((row) => ({ text: row.text, status: row.status, facet: row.facet })),
    };
    assert.equal(meetingPersisted, false, '今天下午三点开会 被错误沉淀为长期 Digital Self');

    tracesBefore = (await listTraces()).length;
    await sendTalk(first.page, UTTER_CORRECT);
    await dumpShot(first.page, '03-talk-correct');
    const traces3 = await listTraces();
    const self3 = await readSelf(pkgDir);
    await openDigitalSelf(first.page);
    await dumpShot(first.page, '03-digital-self');
    const page3 = await first.page.locator('#digital-self-page').innerText();
    const view3 = await invokeDigitalSelf(first.page);
    await fs.writeFile(
      path.join(EVIDENCE, '03-self.json'),
      `${JSON.stringify({ self: self3, view: view3, pageText: page3 }, null, 2)}\n`,
      'utf8',
    );
    const layer3 = diagnoseCorrection({
      tracesAfter: traces3,
      tracesBeforeCount: tracesBefore,
      self: self3,
    });
    const current3 = currentOf(self3);
    verdict.afterCorrect = {
      layer: layer3,
      current: current3.map((row) => ({
        text: row.text,
        facet: row.facet,
        origin: row.provenance.origin,
        supersededBy: row.supersededBy,
      })),
      traces: traces3.slice(tracesBefore),
    };
    if (layer3) {
      verdict.layer = layer3;
      await fs.writeFile(path.join(EVIDENCE, 'gate-verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
      assert.fail(`第二条纠正未正确替换旧边界，层=${layer3}`);
    }
    assert.equal(
      current3.some((row) => looksLikeSafetyNonParticipation(row.text)),
      false,
      '旧的完全不参与仍是 current',
    );
    assert.ok(
      current3.some((row) => looksLikeCorrectedSafetyBoundary(row.text)),
      '纠正后的边界未成为 current',
    );
    const currentSafety = current3.filter(
      (row) => looksLikeSafetyNonParticipation(row.text) || looksLikeCorrectedSafetyBoundary(row.text),
    );
    assert.equal(currentSafety.length <= 1, true, '两个冲突 current 边界并列');
    assert.equal(/是否保存到数字之我/.test(page3), false);
    verdict.extraAuthorityFiles = extraAuthorityFiles(pkgDir);
    assert.deepEqual(verdict.extraAuthorityFiles, []);
    const dsFiles = (await fs.readdir(path.join(pkgDir, 'digital-self')).catch(() => [] as string[])).filter(
      (n) => n.endsWith('.json'),
    );
    verdict.digitalSelfJsonFiles = dsFiles;
    assert.deepEqual(dsFiles, ['self.json']);
  } finally {
    if (originalDir) {
      try {
        await first.page.evaluate(`(async (dir) => {
          return window.digitalMe.invoke('subject.openPackage', { dir });
        })(${JSON.stringify(originalDir)})`);
      } catch {
        /* 恢复失败不掩盖闸门结果 */
      }
    }
    await first.close();
  }

  const second = await launchDigitalMeElectron({
    realProduct: true,
    userData: isolatedUserData,
    extraEnv,
  });
  try {
    await enterProductShell(second.page);
    await second.page.evaluate(`(async (dir) => {
      return window.digitalMe.invoke('subject.openPackage', { dir });
    })(${JSON.stringify(pkgDir)})`);
    const self4 = await readSelf(pkgDir);
    await openDigitalSelf(second.page);
    await dumpShot(second.page, '04-restart');
    const page4 = await second.page.locator('#digital-self-page').innerText();
    await fs.writeFile(
      path.join(EVIDENCE, '04-restart.json'),
      `${JSON.stringify({ self: self4, pageText: page4 }, null, 2)}\n`,
      'utf8',
    );
    const current4 = currentOf(self4);
    verdict.afterRestart = {
      current: current4.map((row) => ({ text: row.text, status: row.status, origin: row.provenance.origin })),
    };
    assert.ok(current4.some((row) => looksLikeCorrectedSafetyBoundary(row.text)));
    assert.equal(current4.some((row) => looksLikeSafetyNonParticipation(row.text)), false);
    assert.equal(liveOf(self4).some((row) => looksLikeMeeting(row.text)), false);
  } finally {
    if (originalDir) {
      try {
        await second.page.evaluate(`(async (dir) => {
          return window.digitalMe.invoke('subject.openPackage', { dir });
        })(${JSON.stringify(originalDir)})`);
      } catch {
        /* ignore */
      }
    }
    await second.close();
  }

  const traces = await listTraces();
  verdict.stubInDigitalSelfTraces = traces.some((row) => row.stub);
  verdict.models = [...new Set(traces.map((row) => row.model).filter(Boolean))];
  verdict.hosts = [...new Set(traces.map((row) => row.host).filter(Boolean))];
  assert.equal(verdict.stubInDigitalSelfTraces, false);
  verdict.layer = null;
  verdict.acceptedRecommended = true;
  await fs.writeFile(path.join(EVIDENCE, 'gate-verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
});
