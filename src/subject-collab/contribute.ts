import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ProfessionalAgent } from '../intelligence/types';

export async function runOwnContribution(input: {
  agents: ProfessionalAgent[];
  instruction: string;
  workRoot: string;
  now: string;
}): Promise<{ used: boolean; ok?: boolean; summary?: string; evidencePath?: string }> {
  const agent = input.agents[0];
  if (!agent) return { used: false };
  const execId = `peer_${randomUUID()}`;
  const workDir = path.join(input.workRoot, 'intelligence', 'runs', execId);
  await fs.mkdir(workDir, { recursive: true });
  const result = await agent.run({
    instruction: input.instruction,
    workDir,
    signal: new AbortController().signal,
  });
  return {
    used: true,
    ok: result.ok,
    summary: result.summary,
    ...(result.ok && result.outputPath ? { evidencePath: result.outputPath } : {}),
  };
}
