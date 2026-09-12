import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeDigitalSelf, readDigitalSelf, digitalSelfFilePath } from '../../subject-core/digital-self/store';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { selectNetworkItems } from '../personal-selection';
import {
  appendNetworkContentFeedback,
  createAiJudgmentFeedback,
  createUserContentFeedback,
} from '../network-content-feedback';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

function selfOf(subjectId: string): DigitalSelf {
  const now = '2026-09-12T00:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我长期关心数字主体如何自己选择信息。',
        facet: 'about_me',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

test('AI judgment and user feedback keep distinct origin', () => {
  const ai = createAiJudgmentFeedback({
    subjectId: 'subj_a',
    contentId: 'ni_real_1',
    action: 'SHOW',
  });
  const user = createUserContentFeedback({
    subjectId: 'subj_a',
    contentId: 'ni_real_1',
    action: 'interested',
  });
  assert.equal(ai.origin, 'ai_decision');
  assert.equal(user.origin, 'user_action');
  assert.notEqual(ai.origin, user.origin);
  assert.throws(() => createUserContentFeedback({ subjectId: 's', contentId: 'c', action: 'SHOW' as never }));
});

test('AI SHOW/IGNORE does not rewrite Digital Self; only user_action is user provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-ncf-'));
  const pkg = path.join(root, 'pkg');
  const digitalSelf = selfOf('subj_ncf');
  await writeDigitalSelf(pkg, digitalSelf);
  const before = await fs.readFile(digitalSelfFilePath(pkg), 'utf8');

  const item = FEED_01_SEED_ITEMS[0]!;
  const selected = await selectNetworkItems({
    digitalSelf,
    items: [item],
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async () => ({
      text: JSON.stringify({
        decisions: [{ itemId: item.itemId, decision: 'show', reason: '用户应该喜欢这类连载。' }],
      }),
    }),
  });
  assert.equal(selected.ok, true);

  const logFile = path.join(root, 'user-feedback.jsonl');
  if (selected.ok) {
    await appendNetworkContentFeedback(
      logFile,
      createAiJudgmentFeedback({
        subjectId: digitalSelf.subjectId,
        contentId: item.itemId,
        action: selected.decisions[0]!.decision === 'show' ? 'SHOW' : 'IGNORE',
      }),
    );
  }
  const after = await fs.readFile(digitalSelfFilePath(pkg), 'utf8');
  const reloaded = await readDigitalSelf(pkg, digitalSelf.subjectId, '2026-09-12T00:01:00.000Z');
  assert.equal(after, before);
  assert.deepEqual(reloaded.understandings, digitalSelf.understandings);

  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
  assert.equal(src.includes('network-content-feedback'), false);
  assert.equal(src.includes('writeDigitalSelf'), false);

  const lines = (await fs.readFile(logFile, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const recorded = JSON.parse(lines[0]!) as { origin: string };
  assert.equal(recorded.origin, 'ai_decision');
});
