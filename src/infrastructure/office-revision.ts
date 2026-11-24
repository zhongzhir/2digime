import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractFile } from './extract';

export interface DocxTextReplacement {
  from: string;
  to: string;
  expectedCount?: number;
  matchCase?: boolean;
}

export interface DocxRevisionResult {
  outputPath: string;
  sourceSha256: string;
  outputSha256: string;
  replacements: Array<{ from: string; to: string; count: number; verifiedCount: number }>;
  readback: string;
  readbackChars: number;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function bridgeCandidates(): string[] {
  const configured = String(process.env.DIGITALME_OFFICE_REVISION_BRIDGE || '').trim();
  const resources = String(process.resourcesPath || '').trim();
  return [
    configured,
    resources ? path.join(resources, 'office', 'revise-docx.py') : '',
    path.resolve(__dirname, '..', '..', 'electron', 'office', 'revise-docx.py'),
    path.resolve(process.cwd(), 'electron', 'office', 'revise-docx.py'),
  ].filter(Boolean);
}

export function locateOfficeRevisionBridge(): string | undefined {
  return bridgeCandidates().find((candidate) => existsSync(candidate));
}

function libreOfficeCandidates(): Array<{ python: string; soffice: string }> {
  const root = String(process.env.DIGITALME_LIBREOFFICE_HOME || '').trim();
  const roots = [root, 'C:\\Program Files\\LibreOffice\\program', 'C:\\Program Files (x86)\\LibreOffice\\program'].filter(Boolean);
  return roots.map((candidate) => ({ python: path.join(candidate, 'python.exe'), soffice: path.join(candidate, 'soffice.exe') }));
}

function runLibreOffice(scriptPath: string, inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const runtime = libreOfficeCandidates().find((candidate) => existsSync(candidate.python) && existsSync(candidate.soffice));
    if (!runtime) {
      reject(new Error('本机没有可用的 LibreOffice 文档引擎。'));
      return;
    }
    const child = spawn(
      runtime.python,
      [scriptPath, inputPath, runtime.soffice],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('LibreOffice 修改超过 120 秒，已停止。'));
    }, 120_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stdout.trim() || stderr.trim() || `LibreOffice 修改进程退出码 ${code}`));
    });
  });
}

export async function reviseDocxWithInstalledOffice(input: {
  sourcePath: string;
  outputPath: string;
  replacements: readonly DocxTextReplacement[];
  signal?: AbortSignal;
}): Promise<DocxRevisionResult> {
  input.signal?.throwIfAborted();
  if (process.platform !== 'win32') throw new Error('当前系统不是 Windows，尚未连接可用的 DOCX 原格式修改器。');
  if (path.extname(input.sourcePath).toLowerCase() !== '.docx') throw new Error('当前只支持修改 DOCX。');
  if (path.extname(input.outputPath).toLowerCase() !== '.docx') throw new Error('输出文件必须是 DOCX。');
  if (!input.replacements.length || input.replacements.length > 20) throw new Error('一次需要提供 1—20 项精确替换。');
  for (const replacement of input.replacements) {
    if (!replacement.from || replacement.from.length > 2_000 || replacement.to.length > 2_000) {
      throw new Error('每项替换必须有原文，且替换前后文本均不超过 2000 字。');
    }
    if (replacement.expectedCount !== undefined && (!Number.isInteger(replacement.expectedCount) || replacement.expectedCount < 1)) {
      throw new Error('expectedCount 必须是大于 0 的整数。');
    }
  }
  if (path.resolve(input.sourcePath) === path.resolve(input.outputPath)) throw new Error('不能覆盖源 DOCX；请另存新文件。');
  if (await fs.stat(input.outputPath).then(() => true, () => false)) throw new Error('输出文件已存在；为避免覆盖，请换一个新文件名。');
  const scriptPath = locateOfficeRevisionBridge();
  if (!scriptPath) throw new Error('没有找到本机 DOCX 修改桥接组件。');

  const sourceBefore = await fs.readFile(input.sourcePath);
  const sourceSha256 = sha256(sourceBefore);
  const outputDir = path.dirname(input.outputPath);
  await fs.mkdir(outputDir, { recursive: true });
  const tempOutput = path.join(outputDir, `2digime-${randomUUID()}-${path.basename(input.outputPath)}`);
  const requestDir = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-docx-revision-'));
  const requestPath = path.join(requestDir, 'request.json');
  await fs.copyFile(input.sourcePath, tempOutput);
  await fs.writeFile(requestPath, JSON.stringify({
    outputPath: tempOutput,
    replacements: input.replacements,
  }), 'utf8');

  try {
    const raw = await runLibreOffice(scriptPath, requestPath);
    const parsed = JSON.parse(raw) as {
      ok?: boolean;
      error?: string;
      replacements?: Array<{ from: string; to: string; count: number; verifiedCount: number }>;
    };
    if (!parsed.ok) throw new Error(parsed.error || 'LibreOffice 没有完成修改。');
    input.signal?.throwIfAborted();
    const sourceAfter = await fs.readFile(input.sourcePath);
    if (sha256(sourceAfter) !== sourceSha256) throw new Error('源 DOCX 发生了变化，已拒绝交付副本。');
    const candidate = await fs.readFile(tempOutput);
    if (!candidate.length) throw new Error('LibreOffice 生成的副本为空。');
    await fs.rename(tempOutput, input.outputPath);
    const extraction = await extractFile(input.outputPath);
    const extractedText = String(extraction.text || '');
    if (extraction.status !== 'ok' || !extractedText.trim()) throw new Error('修改后的 DOCX 无法回读正文。');
    const verified = parsed.replacements || [];
    if (verified.length !== input.replacements.length || verified.some((item) => item.to && item.verifiedCount < item.count)) {
      throw new Error('修改后的 DOCX 没有通过保存后核对。');
    }
    const output = await fs.readFile(input.outputPath);
    return {
      outputPath: input.outputPath,
      sourceSha256,
      outputSha256: sha256(output),
      replacements: verified,
      readback: extractedText.slice(0, 4_000),
      readbackChars: extractedText.length,
    };
  } catch (error) {
    await fs.rm(tempOutput, { force: true }).catch(() => undefined);
    await fs.rm(input.outputPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(requestDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
