import * as path from 'node:path';
import { extractFile } from '../../infrastructure/extract';
import { contentDigest } from '../../infrastructure/digest';
import { nowIso } from '../../shared/ids';
import {
  applyConfirm,
  applyCorrect,
  applyDelete,
  applyImportProposals,
  applyTellProposals,
} from './apply';
import { interpretWithModel, type DigitalSelfChatFn } from './interpret';
import { readDigitalSelf, writeDigitalSelf, writeSourceCopy } from './store';
import type {
  DigitalSelfCommandInput,
  DigitalSelfCommandOutput,
} from './types';
import { projectDigitalSelfView } from './view';

export const NO_MODEL_NOTICE = '需要先连接 AI 能力，才能理解关于你的话。';
export const NO_PACKAGE_NOTICE = '还没有可用的数字之我。';

export interface DigitalSelfPackageRef {
  rootDir: string;
  subjectId: string;
}

export class DigitalSelfService {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly resolvePackage: () => DigitalSelfPackageRef | null,
    private readonly chat: DigitalSelfChatFn | null,
    private readonly now: () => string = nowIso,
  ) {}

  async invoke(input: DigitalSelfCommandInput): Promise<DigitalSelfCommandOutput> {
    const run = this.writeChain.then(() => this.invokeNow(input));
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async invokeNow(
    input: DigitalSelfCommandInput,
  ): Promise<DigitalSelfCommandOutput> {
    const pkg = this.resolvePackage();
    if (!pkg) {
      return {
        view: projectDigitalSelfView(
          {
            schemaVersion: 1,
            subjectId: '',
            updatedAt: this.now(),
            understandings: [],
          },
          { notice: NO_PACKAGE_NOTICE },
        ),
      };
    }
    const self = await readDigitalSelf(pkg.rootDir, pkg.subjectId, this.now());
    const action = input.action;

    if (action === 'read') {
      return { view: projectDigitalSelfView(self) };
    }

    if (action === 'confirm' && input.understandingId) {
      const result = applyConfirm(self, input.understandingId, this.now());
      await writeDigitalSelf(pkg.rootDir, result.self);
      return { view: projectDigitalSelfView(result.self) };
    }

    if (action === 'delete' && input.understandingId) {
      const result = applyDelete(self, input.understandingId, this.now());
      await writeDigitalSelf(pkg.rootDir, result.self);
      return { view: projectDigitalSelfView(result.self) };
    }

    if (action === 'ignore' && input.understandingId) {
      const result = applyDelete(self, input.understandingId, this.now());
      await writeDigitalSelf(pkg.rootDir, result.self);
      return { view: projectDigitalSelfView(result.self) };
    }

    if (action === 'correct' && input.understandingId && input.text?.trim()) {
      const result = applyCorrect(
        self,
        input.understandingId,
        input.text,
        this.now(),
      );
      await writeDigitalSelf(pkg.rootDir, result.self);
      return { view: projectDigitalSelfView(result.self) };
    }

    if (action === 'tell') {
      const text = (input.text || '').trim();
      if (!text) return { view: projectDigitalSelfView(self) };
      if (!this.chat) {
        return {
          view: projectDigitalSelfView(self, { notice: NO_MODEL_NOTICE }),
        };
      }
      const interpreted = await interpretWithModel({
        chat: this.chat,
        mode: 'tell',
        self,
        text,
      });
      const result = applyTellProposals(self, interpreted.understandings, this.now());
      await writeDigitalSelf(pkg.rootDir, result.self);
      const notice = interpreted.notice || result.notice;
      return {
        view: projectDigitalSelfView(result.self, {
          ...(notice ? { notice } : {}),
          ...(result.asked ? { asked: true } : {}),
        }),
      };
    }

    if (action === 'import') {
      const filePath = (input.filePath || '').trim();
      if (!filePath) return { view: projectDigitalSelfView(self) };
      if (!this.chat) {
        return {
          view: projectDigitalSelfView(self, { notice: NO_MODEL_NOTICE }),
        };
      }
      const extracted = await extractFile(filePath);
      if (extracted.status !== 'ok' || !extracted.text) {
        return {
          view: projectDigitalSelfView(self, {
            notice: extracted.warning || '这份资料没能读出来。',
          }),
        };
      }
      const materialName = path.basename(filePath);
      const digest = extracted.digest || contentDigest(extracted.text);
      await writeSourceCopy(pkg.rootDir, digest, extracted.text);
      const interpreted = await interpretWithModel({
        chat: this.chat,
        mode: 'import',
        self,
        text: extracted.text,
        materialName,
      });
      const result = applyImportProposals(
        self,
        interpreted.understandings,
        this.now(),
        materialName,
      );
      await writeDigitalSelf(pkg.rootDir, result.self);
      const notice =
        interpreted.notice ||
        result.notice ||
        (interpreted.understandings.length === 0
          ? '这份资料里没有发现需要记入数字之我的内容。'
          : undefined);
      return {
        view: projectDigitalSelfView(result.self, {
          ...(notice ? { notice } : {}),
          ...(result.asked ? { asked: true } : {}),
        }),
      };
    }

    return { view: projectDigitalSelfView(self) };
  }
}
