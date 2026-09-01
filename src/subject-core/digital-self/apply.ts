import { randomBytes } from 'node:crypto';
import type {
  DigitalSelf,
  DigitalSelfFacet,
  DigitalSelfOrigin,
  ModelUnderstandingProposal,
  Understanding,
} from './types';

export function newUnderstandingId(): string {
  return `u_${randomBytes(8).toString('hex')}`;
}

export function normalizeUnderstandingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function live(self: DigitalSelf): Understanding[] {
  return self.understandings.filter(
    (item) =>
      item.status === 'current' ||
      item.status === 'candidate' ||
      item.status === 'needs_ask',
  );
}

function findLive(self: DigitalSelf, id: string | undefined): Understanding | undefined {
  if (!id) return undefined;
  return live(self).find((item) => item.id === id);
}

function markSuperseded(
  self: DigitalSelf,
  oldId: string,
  newId: string,
  now: string,
): void {
  const old = self.understandings.find((item) => item.id === oldId);
  if (!old) return;
  old.status = 'superseded';
  old.confirmed = false;
  old.supersededBy = newId;
  old.updatedAt = now;
}

function sameText(a: string, b: string): boolean {
  return normalizeUnderstandingText(a) === normalizeUnderstandingText(b);
}

function inferredMustAsk(proposal: ModelUnderstandingProposal): boolean {
  return (
    proposal.mustAsk === true ||
    proposal.isCoreIdentity === true ||
    proposal.isSensitive === true ||
    proposal.isMajorGoal === true ||
    proposal.isBoundary === true
  );
}

function pushUnderstanding(
  self: DigitalSelf,
  item: Understanding,
): void {
  self.understandings.push(item);
  self.updatedAt = item.updatedAt;
}

function makeItem(input: {
  text: string;
  facet: DigitalSelfFacet;
  status: Understanding['status'];
  confirmed: boolean;
  origin: DigitalSelfOrigin;
  actor: 'owner' | 'model';
  now: string;
  excerpt?: string;
  materialName?: string;
  conflictsWithId?: string;
}): Understanding {
  const item: Understanding = {
    id: newUnderstandingId(),
    text: normalizeUnderstandingText(input.text),
    facet: input.facet,
    status: input.status,
    confirmed: input.confirmed,
    provenance: {
      origin: input.origin,
      actor: input.actor,
      statedAt: input.now,
    },
    updatedAt: input.now,
  };
  if (input.excerpt) item.provenance.excerpt = input.excerpt;
  if (input.materialName) item.provenance.materialName = input.materialName;
  if (input.conflictsWithId) item.conflictsWithId = input.conflictsWithId;
  return item;
}

export interface ApplyResult {
  self: DigitalSelf;
  asked: boolean;
  notice?: string;
}

function duplicateOfCurrent(self: DigitalSelf, text: string): Understanding | undefined {
  return live(self).find(
    (item) => item.status === 'current' && sameText(item.text, text),
  );
}

function applyOneTell(
  self: DigitalSelf,
  proposal: ModelUnderstandingProposal,
  now: string,
): { asked: boolean; conflict: boolean } {
  if (!proposal.aboutUser) return { asked: false, conflict: false };
  const text = normalizeUnderstandingText(proposal.text);
  if (!text) return { asked: false, conflict: false };

  const conflict = findLive(self, proposal.conflictsWithId);
  if (conflict && conflict.status === 'current' && !sameText(conflict.text, text)) {
    const item = makeItem({
      text,
      facet: proposal.facet,
      status: 'needs_ask',
      confirmed: false,
      origin: proposal.origin,
      actor: proposal.origin === 'user_statement' ? 'owner' : 'model',
      now,
      ...(proposal.excerpt ? { excerpt: proposal.excerpt } : {}),
      conflictsWithId: conflict.id,
    });
    pushUnderstanding(self, item);
    return { asked: true, conflict: true };
  }

  const replace = findLive(self, proposal.replacesId);
  if (replace) {
    const item = makeItem({
      text,
      facet: proposal.facet || replace.facet,
      status: proposal.origin === 'user_statement' ? 'current' : 'candidate',
      confirmed: proposal.origin === 'user_statement',
      origin: proposal.origin,
      actor: proposal.origin === 'user_statement' ? 'owner' : 'model',
      now,
      ...(proposal.excerpt ? { excerpt: proposal.excerpt } : {}),
    });
    if (proposal.origin !== 'user_statement') {
      item.status = inferredMustAsk(proposal) ? 'needs_ask' : 'candidate';
      item.confirmed = false;
    }
    markSuperseded(self, replace.id, item.id, now);
    pushUnderstanding(self, item);
    return { asked: item.status === 'needs_ask', conflict: false };
  }

  const merge = findLive(self, proposal.mergeWithId);
  if (merge) {
    if (sameText(merge.text, text)) return { asked: false, conflict: false };
    merge.text = text;
    merge.facet = proposal.facet || merge.facet;
    merge.updatedAt = now;
    self.updatedAt = now;
    return { asked: false, conflict: false };
  }

  const dup = duplicateOfCurrent(self, text);
  if (dup) return { asked: false, conflict: false };

  if (proposal.origin === 'user_statement') {
    if (proposal.isSensitive === true) {
      const item = makeItem({
        text,
        facet: proposal.facet,
        status: 'needs_ask',
        confirmed: false,
        origin: 'user_statement',
        actor: 'owner',
        now,
        ...(proposal.excerpt ? { excerpt: proposal.excerpt } : {}),
      });
      pushUnderstanding(self, item);
      return { asked: true, conflict: false };
    }
    const item = makeItem({
      text,
      facet: proposal.facet,
      status: 'current',
      confirmed: true,
      origin: 'user_statement',
      actor: 'owner',
      now,
      ...(proposal.excerpt ? { excerpt: proposal.excerpt } : {}),
    });
    pushUnderstanding(self, item);
    return { asked: false, conflict: false };
  }

  const item = makeItem({
    text,
    facet: proposal.facet,
    status: inferredMustAsk(proposal) ? 'needs_ask' : 'candidate',
    confirmed: false,
    origin: proposal.origin,
    actor: 'model',
    now,
    ...(proposal.excerpt ? { excerpt: proposal.excerpt } : {}),
  });
  pushUnderstanding(self, item);
  return { asked: item.status === 'needs_ask', conflict: false };
}

export function applyTellProposals(
  self: DigitalSelf,
  proposals: ModelUnderstandingProposal[],
  now: string,
): ApplyResult {
  let asked = false;
  let conflict = false;
  for (const proposal of proposals) {
    const result = applyOneTell(self, proposal, now);
    if (result.asked) asked = true;
    if (result.conflict) conflict = true;
  }
  return {
    self,
    asked,
    ...(conflict
      ? { notice: '这件事和已有理解不一致，需要你确认。不会静默覆盖。' }
      : {}),
  };
}

export function applyImportProposals(
  self: DigitalSelf,
  proposals: ModelUnderstandingProposal[],
  now: string,
  materialName: string,
): ApplyResult {
  let asked = false;
  for (const proposal of proposals) {
    if (!proposal.aboutUser) continue;
    const text = normalizeUnderstandingText(proposal.text);
    if (!text) continue;
    if (live(self).some((item) => sameText(item.text, text))) continue;

    const conflict = findLive(self, proposal.conflictsWithId);
    const mustAsk =
      inferredMustAsk(proposal) ||
      Boolean(conflict && conflict.status === 'current');
    const item = makeItem({
      text,
      facet: proposal.facet,
      status: mustAsk || Boolean(conflict) ? 'needs_ask' : 'candidate',
      confirmed: false,
      origin: 'material',
      actor: 'model',
      now,
      ...(proposal.excerpt ? { excerpt: proposal.excerpt } : {}),
      materialName,
      ...(conflict && conflict.status === 'current' ? { conflictsWithId: conflict.id } : {}),
    });
    pushUnderstanding(self, item);
    if (item.status === 'needs_ask') asked = true;
  }
  return {
    self,
    asked,
    ...(asked ? { notice: '资料里有需要你确认的理解，不会当作你已经确认的事实。' } : {}),
  };
}

export function applyConfirm(
  self: DigitalSelf,
  understandingId: string,
  now: string,
): ApplyResult {
  const item = findLive(self, understandingId);
  if (!item) return { self, asked: false };
  if (item.conflictsWithId) {
    const old = findLive(self, item.conflictsWithId);
    if (old) markSuperseded(self, old.id, item.id, now);
  }
  item.status = 'current';
  item.confirmed = true;
  item.updatedAt = now;
  self.updatedAt = now;
  return { self, asked: false };
}

export function applyCorrect(
  self: DigitalSelf,
  understandingId: string,
  text: string,
  now: string,
): ApplyResult {
  const old = findLive(self, understandingId);
  if (!old) return { self, asked: false };
  const nextText = normalizeUnderstandingText(text);
  if (!nextText) return { self, asked: false };
  const item = makeItem({
    text: nextText,
    facet: old.facet,
    status: 'current',
    confirmed: true,
    origin: 'user_statement',
    actor: 'owner',
    now,
  });
  markSuperseded(self, old.id, item.id, now);
  pushUnderstanding(self, item);
  return { self, asked: false };
}

export function applyDelete(
  self: DigitalSelf,
  understandingId: string,
  now: string,
): ApplyResult {
  const item = self.understandings.find((row) => row.id === understandingId);
  if (!item) return { self, asked: false };
  item.status = 'deleted';
  item.confirmed = false;
  item.updatedAt = now;
  self.updatedAt = now;
  return { self, asked: false };
}
